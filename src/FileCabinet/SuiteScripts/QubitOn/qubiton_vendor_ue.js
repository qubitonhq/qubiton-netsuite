/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * QubitOn Vendor Validation (Layer 3)
 * Triggers QubitOn API validation on vendor record create/edit.
 * Equivalent to SAP BAdI ME_PROCESS_PO_CUST / Oracle iSupplier triggers.
 *
 * Custom fields required on Vendor record:
 *   custentity_qbn_validation_status   (List/Record: Pass|Fail|Pending|Error)
 *   custentity_qbn_validation_date     (Date/Time)
 *   custentity_qbn_validation_score    (Integer)
 *   custentity_qbn_validation_details  (Long Text)
 *   custentity_qbn_validation_id       (Free-Form Text)
 *
 * Script parameters:
 *   custscript_qbn_vendor_stop_on_fail (Checkbox) - Block save when validation fails
 *   custscript_qbn_vendor_auto_validate (Checkbox) - Auto-validate on create/edit
 *   custscript_qbn_vendor_client_script (Free-Form Text) - Client script internal ID
 *
 * Deployment: Deploy to Vendor record type.
 */
define(['N/log', 'N/ui/serverWidget', 'N/runtime', 'N/error', 'N/format', './qubiton_validation'],
function(log, serverWidget, runtime, error, format, validation) {

    /**
     * Custom field IDs for validation results on the vendor record.
     * @enum {string}
     */
    const FIELDS = {
        STATUS: 'custentity_qbn_validation_status',
        DATE: 'custentity_qbn_validation_date',
        SCORE: 'custentity_qbn_validation_score',
        DETAILS: 'custentity_qbn_validation_details',
        VALIDATION_ID: 'custentity_qbn_validation_id'
    };

    /**
     * Validation status values (matches custom list custlist_qbn_val_status).
     * @enum {string}
     */
    const STATUS = {
        PASS: '1',
        FAIL: '2',
        PENDING: '3',
        ERROR: '4'
    };

    /**
     * Contexts that should skip validation entirely.
     * CSV import, scheduled scripts, and web services handle validation separately.
     * @type {Set<string>}
     */
    const SKIP_CONTEXTS = new Set([
        runtime.ContextType.CSV_IMPORT,
        runtime.ContextType.MAP_REDUCE,
        runtime.ContextType.SCHEDULED,
        runtime.ContextType.SUITELET
    ]);

    /**
     * beforeLoad - Adds QubitOn validation badge and "Validate Now" button to the form.
     *
     * @param {Object} context
     * @param {Record} context.newRecord - The vendor record being loaded
     * @param {ServerWidget.Form} context.form - The form object
     * @param {string} context.type - The user event type (create, edit, view, etc.)
     */
    function beforeLoad(context) {
        try {
            if (context.type !== context.UserEventType.VIEW &&
                context.type !== context.UserEventType.EDIT) {
                return;
            }

            const form = context.form;
            const rec = context.newRecord;

            // Add "Validate Now" button on view and edit modes
            const clientScriptId = runtime.getCurrentScript()
                .getParameter({ name: 'custscript_qbn_vendor_client_script' });

            if (clientScriptId) {
                form.clientScriptModulePath = '/SuiteScripts/QubitOn/qubiton_client.js';
            }

            form.addButton({
                id: 'custpage_qbn_validate',
                label: 'QubitOn Validate',
                functionName: 'validateNow'
            });

            // Add validation status inline HTML field as a badge
            const statusValue = rec.getValue({ fieldId: FIELDS.STATUS });
            const validationDate = rec.getValue({ fieldId: FIELDS.DATE });
            const score = rec.getValue({ fieldId: FIELDS.SCORE });

            if (statusValue) {
                const badgeHtml = buildStatusBadge(statusValue, validationDate, score);
                const badgeField = form.addField({
                    id: 'custpage_qbn_badge',
                    type: serverWidget.FieldType.INLINEHTML,
                    label: 'QubitOn Status',
                    container: 'main'
                });
                badgeField.defaultValue = badgeHtml;
            }

            log.debug({
                title: 'QubitOn Vendor UE - beforeLoad',
                details: `Record ID: ${rec.id}, Type: ${context.type}`
            });

        } catch (e) {
            // beforeLoad errors should not block the form from loading
            log.error({
                title: 'QubitOn Vendor UE - beforeLoad Error',
                details: `${e.name}: ${e.message}\n${e.stack}`
            });
        }
    }

    /**
     * beforeSubmit - Runs QubitOn validation on vendor create and edit.
     * Optionally blocks save if validation fails and stop_on_fail is enabled.
     *
     * @param {Object} context
     * @param {Record} context.newRecord - The vendor record being saved
     * @param {Record} context.oldRecord - The previous version (edit only)
     * @param {string} context.type - The user event type
     * @throws {error.SuiteScriptError} When stop_on_fail is enabled and validation fails
     */
    function beforeSubmit(context) {
        // Only validate on create and edit, not delete or inline edit
        if (context.type !== context.UserEventType.CREATE &&
            context.type !== context.UserEventType.EDIT) {
            return;
        }

        // Skip validation for certain execution contexts
        const executionContext = runtime.executionContext;
        if (SKIP_CONTEXTS.has(executionContext)) {
            log.audit({
                title: 'QubitOn Vendor UE - Skipping Validation',
                details: `Execution context: ${executionContext}`
            });
            return;
        }

        const currentScript = runtime.getCurrentScript();
        const autoValidate = currentScript.getParameter({
            name: 'custscript_qbn_vendor_auto_validate'
        });

        if (!autoValidate) {
            log.debug({
                title: 'QubitOn Vendor UE - Auto-validate Disabled',
                details: 'Skipping validation per script parameter'
            });
            return;
        }

        // Check remaining governance units before making API call
        const remainingUsage = currentScript.getRemainingUsage();
        if (remainingUsage < 100) {
            log.audit({
                title: 'QubitOn Vendor UE - Governance Limit',
                details: `Only ${remainingUsage} units remaining, skipping validation`
            });
            setValidationStatus(context.newRecord, STATUS.PENDING, null, 0,
                'Validation deferred: insufficient governance units');
            return;
        }

        try {
            const rec = context.newRecord;
            const vendorData = extractVendorData(rec);

            // Skip validation if no meaningful data to validate
            if (!vendorData.companyName && !vendorData.taxId) {
                log.debug({
                    title: 'QubitOn Vendor UE - No Data to Validate',
                    details: 'Vendor has no company name or tax ID'
                });
                setValidationStatus(rec, STATUS.PENDING, null, 0,
                    'Validation skipped: no company name or tax ID provided');
                return;
            }

            // Check if data actually changed (edit only) — avoid unnecessary API calls
            if (context.type === context.UserEventType.EDIT) {
                const oldRecord = context.oldRecord;
                if (!hasValidationFieldsChanged(rec, oldRecord)) {
                    log.debug({
                        title: 'QubitOn Vendor UE - No Changes',
                        details: 'Validation-relevant fields unchanged, skipping'
                    });
                    return;
                }
            }

            log.audit({
                title: 'QubitOn Vendor UE - Running Validation',
                details: `Vendor: ${vendorData.companyName}, Tax ID: ${maskTaxId(vendorData.taxId)}`
            });

            // Call QubitOn validation module
            const result = validation.validateRecord(rec, 'vendor');

            // Store validation results on the record
            var score = Math.round((result.summary.passed / Math.max(result.summary.total, 1)) * 100);
            setValidationStatus(
                rec,
                result.passed ? STATUS.PASS : STATUS.FAIL,
                new Date(),
                score,
                JSON.stringify(result.summary || {}),
                ''
            );

            // If stop_on_fail is enabled and validation failed, block the save
            const stopOnFail = currentScript.getParameter({
                name: 'custscript_qbn_vendor_stop_on_fail'
            });

            if (stopOnFail && !result.passed) {
                const failureReasons = extractFailureReasons(result);
                throw error.create({
                    name: 'QBN_VALIDATION_FAILED',
                    message: `QubitOn validation failed for this vendor. ${failureReasons}`,
                    notifyOff: false
                });
            }

        } catch (e) {
            if (e.name === 'QBN_VALIDATION_FAILED') {
                throw e; // Re-throw intentional validation failures
            }

            // API errors should not block the save — set status to Error
            log.error({
                title: 'QubitOn Vendor UE - Validation Error',
                details: `${e.name}: ${e.message}\n${e.stack}`
            });
            setValidationStatus(context.newRecord, STATUS.ERROR, new Date(), 0,
                `Validation error: ${e.message}`);
        }
    }

    /**
     * afterSubmit - Logs validation results and triggers follow-up actions.
     *
     * @param {Object} context
     * @param {Record} context.newRecord - The saved vendor record
     * @param {Record} context.oldRecord - The previous version (edit only)
     * @param {string} context.type - The user event type
     */
    function afterSubmit(context) {
        if (context.type !== context.UserEventType.CREATE &&
            context.type !== context.UserEventType.EDIT) {
            return;
        }

        try {
            const rec = context.newRecord;
            const status = rec.getValue({ fieldId: FIELDS.STATUS });
            const score = rec.getValue({ fieldId: FIELDS.SCORE });
            const validationId = rec.getValue({ fieldId: FIELDS.VALIDATION_ID });

            log.audit({
                title: 'QubitOn Vendor UE - Validation Complete',
                details: JSON.stringify({
                    recordId: rec.id,
                    recordType: 'vendor',
                    status: getStatusLabel(status),
                    score: score,
                    validationId: validationId,
                    eventType: context.type
                })
            });

        } catch (e) {
            // afterSubmit errors should never block — log and move on
            log.error({
                title: 'QubitOn Vendor UE - afterSubmit Error',
                details: `${e.name}: ${e.message}`
            });
        }
    }

    // ─── Helper Functions ────────────────────────────────────────────────

    /**
     * Extracts vendor data fields for validation.
     *
     * @param {Record} rec - The vendor record
     * @returns {Object} Vendor data object with all validation-relevant fields
     */
    function extractVendorData(rec) {
        const data = {
            companyName: rec.getValue({ fieldId: 'companyname' }) || '',
            taxId: rec.getValue({ fieldId: 'vatregnumber' }) || '',
            legalName: rec.getValue({ fieldId: 'legalname' }) || '',
            email: rec.getValue({ fieldId: 'email' }) || '',
            phone: rec.getValue({ fieldId: 'phone' }) || '',
            url: rec.getValue({ fieldId: 'url' }) || '',
            category: rec.getText({ fieldId: 'category' }) || '',
            subsidiary: rec.getText({ fieldId: 'subsidiary' }) || '',
            is1099Eligible: rec.getValue({ fieldId: 'is1099eligible' }) || false,
            taxIdType: rec.getText({ fieldId: 'taxidnum' }) || '',
            addresses: []
        };

        // Extract address sublist data
        const addressCount = rec.getLineCount({ sublistId: 'addressbook' });
        for (let i = 0; i < addressCount; i++) {
            const addressSubrecord = rec.getSublistSubrecord({
                sublistId: 'addressbook',
                fieldId: 'addressbookaddress',
                line: i
            });

            if (addressSubrecord) {
                data.addresses.push({
                    label: rec.getSublistValue({
                        sublistId: 'addressbook',
                        fieldId: 'label',
                        line: i
                    }),
                    defaultBilling: rec.getSublistValue({
                        sublistId: 'addressbook',
                        fieldId: 'defaultbilling',
                        line: i
                    }),
                    defaultShipping: rec.getSublistValue({
                        sublistId: 'addressbook',
                        fieldId: 'defaultshipping',
                        line: i
                    }),
                    addr1: addressSubrecord.getValue({ fieldId: 'addr1' }) || '',
                    addr2: addressSubrecord.getValue({ fieldId: 'addr2' }) || '',
                    city: addressSubrecord.getValue({ fieldId: 'city' }) || '',
                    state: addressSubrecord.getValue({ fieldId: 'state' }) || '',
                    zip: addressSubrecord.getValue({ fieldId: 'zip' }) || '',
                    country: addressSubrecord.getValue({ fieldId: 'country' }) || '',
                    addressee: addressSubrecord.getValue({ fieldId: 'addressee' }) || '',
                    attention: addressSubrecord.getValue({ fieldId: 'attention' }) || '',
                    phone: addressSubrecord.getValue({ fieldId: 'addrphone' }) || ''
                });
            }
        }

        // Extract banking details if present (custom fields)
        data.bankAccount = rec.getValue({ fieldId: 'custentity_qbn_bank_account' }) || '';
        data.bankRouting = rec.getValue({ fieldId: 'custentity_qbn_bank_routing' }) || '';
        data.bankCountry = rec.getValue({ fieldId: 'custentity_qbn_bank_country' }) || '';

        return data;
    }

    /**
     * Checks whether any validation-relevant fields changed between old and new record.
     *
     * @param {Record} newRec - The new version of the record
     * @param {Record} oldRec - The old version of the record
     * @returns {boolean} True if any relevant field changed
     */
    function hasValidationFieldsChanged(newRec, oldRec) {
        const fieldsToCheck = [
            'companyname', 'vatregnumber', 'legalname', 'email',
            'phone', 'url', 'is1099eligible'
        ];

        for (const fieldId of fieldsToCheck) {
            const newVal = newRec.getValue({ fieldId: fieldId });
            const oldVal = oldRec.getValue({ fieldId: fieldId });
            if (String(newVal || '') !== String(oldVal || '')) {
                return true;
            }
        }

        // Check if address count changed
        const newAddrCount = newRec.getLineCount({ sublistId: 'addressbook' });
        const oldAddrCount = oldRec.getLineCount({ sublistId: 'addressbook' });
        if (newAddrCount !== oldAddrCount) {
            return true;
        }

        return false;
    }

    /**
     * Sets validation result fields on the record.
     *
     * @param {Record} rec - The vendor record
     * @param {string} status - Status list value (STATUS enum)
     * @param {Date|null} date - Validation date/time
     * @param {number} score - Validation score (0-100)
     * @param {string} details - JSON string of validation details
     * @param {string} [validationId] - QubitOn validation reference ID
     */
    function setValidationStatus(rec, status, date, score, details, validationId) {
        rec.setValue({ fieldId: FIELDS.STATUS, value: status });

        if (date) {
            rec.setValue({ fieldId: FIELDS.DATE, value: date });
        }

        rec.setValue({ fieldId: FIELDS.SCORE, value: score });

        // Truncate details to 100,000 chars (NetSuite Long Text limit)
        const truncatedDetails = details && details.length > 100000
            ? details.substring(0, 99990) + '...[truncated]'
            : details;
        rec.setValue({ fieldId: FIELDS.DETAILS, value: truncatedDetails || '' });

        if (validationId) {
            rec.setValue({ fieldId: FIELDS.VALIDATION_ID, value: validationId });
        }
    }

    /**
     * Extracts human-readable failure reasons from a validation result.
     *
     * @param {Object} result - Validation result from qubiton_validation
     * @returns {string} Formatted failure reasons
     */
    function extractFailureReasons(result) {
        var reasons = [];
        if (result && result.validations) {
            for (var i = 0; i < result.validations.length; i++) {
                var v = result.validations[i];
                if (!v.passed && !v.skipped) {
                    reasons.push(v.type + ': ' + (v.reason || v.error || 'failed'));
                }
            }
        }
        if (reasons.length === 0) {
            return 'Please review the vendor data and try again.';
        }
        var display = reasons.slice(0, 5);
        return 'Reasons: ' + display.join('; ') +
            (reasons.length > 5
                ? ` (+${reasons.length - 5} more)`
                : '');
    }

    /**
     * Builds an inline HTML badge for the validation status.
     *
     * @param {string} statusValue - The status list internal ID
     * @param {Date|string} validationDate - The date of last validation
     * @param {number} score - The validation score
     * @returns {string} HTML string for the inline badge
     */
    function buildStatusBadge(statusValue, validationDate, score) {
        const colors = {
            [STATUS.PASS]: { bg: '#e6f4ea', text: '#1e7e34', label: 'Passed' },
            [STATUS.FAIL]: { bg: '#fce8e6', text: '#c5221f', label: 'Failed' },
            [STATUS.PENDING]: { bg: '#fef7e0', text: '#f9a825', label: 'Pending' },
            [STATUS.ERROR]: { bg: '#fce8e6', text: '#c5221f', label: 'Error' }
        };

        const style = colors[statusValue] || colors[STATUS.PENDING];
        const dateStr = validationDate
            ? format.format({ value: validationDate, type: format.Type.DATETIME })
            : 'N/A';
        const scoreStr = score != null ? score : 'N/A';

        return `<div style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;
            border-radius:4px;background:${style.bg};color:${style.text};
            font-weight:600;font-size:13px;margin:4px 0;">
            <span>QubitOn: ${style.label}</span>
            <span style="font-weight:400;opacity:0.8;">Score: ${scoreStr} | ${dateStr}</span>
        </div>`;
    }

    /**
     * Returns a human-readable label for a status value.
     *
     * @param {string} statusValue - The status list internal ID
     * @returns {string} Human-readable status label
     */
    function getStatusLabel(statusValue) {
        const labels = {
            [STATUS.PASS]: 'Pass',
            [STATUS.FAIL]: 'Fail',
            [STATUS.PENDING]: 'Pending',
            [STATUS.ERROR]: 'Error'
        };
        return labels[statusValue] || 'Unknown';
    }

    /**
     * Masks a tax ID for logging (shows first 2 and last 2 characters).
     *
     * @param {string} taxId - The tax ID to mask
     * @returns {string} Masked tax ID
     */
    function maskTaxId(taxId) {
        if (!taxId || taxId.length < 5) {
            return '***';
        }
        return taxId.substring(0, 2) + '***' + taxId.substring(taxId.length - 2);
    }

    return {
        beforeLoad: beforeLoad,
        beforeSubmit: beforeSubmit,
        afterSubmit: afterSubmit
    };
});
