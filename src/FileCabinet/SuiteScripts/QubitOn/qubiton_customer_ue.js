/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * QubitOn Customer Validation (Layer 3)
 * Triggers QubitOn API validation on customer record create/edit.
 * Mirrors the vendor UE pattern for customer-specific fields.
 *
 * Custom fields required on Customer record:
 *   custentity_qbn_validation_status   (List/Record: Pass|Fail|Pending|Error)
 *   custentity_qbn_validation_date     (Date/Time)
 *   custentity_qbn_validation_score    (Integer)
 *   custentity_qbn_validation_details  (Long Text)
 *   custentity_qbn_validation_id       (Free-Form Text)
 *
 * Script parameters:
 *   custscript_qbn_cust_stop_on_fail  (Checkbox) - Block save when validation fails
 *   custscript_qbn_cust_auto_validate (Checkbox) - Auto-validate on create/edit
 *   custscript_qbn_cust_client_script (Free-Form Text) - Client script internal ID
 *
 * Deployment: Deploy to Customer record type.
 */
define(['N/log', 'N/ui/serverWidget', 'N/runtime', 'N/error', 'N/format', './qubiton_validation'],
function(log, serverWidget, runtime, error, format, validation) {

    /**
     * Custom field IDs for validation results on the customer record.
     * Shared with vendor — same custom fields applied at entity level.
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
     * @param {Record} context.newRecord - The customer record being loaded
     * @param {ServerWidget.Form} context.form - The form object
     * @param {string} context.type - The user event type
     */
    function beforeLoad(context) {
        try {
            if (context.type !== context.UserEventType.VIEW &&
                context.type !== context.UserEventType.EDIT) {
                return;
            }

            const form = context.form;
            const rec = context.newRecord;

            // Attach client script for the "Validate Now" button
            const clientScriptId = runtime.getCurrentScript()
                .getParameter({ name: 'custscript_qbn_cust_client_script' });

            if (clientScriptId) {
                form.clientScriptModulePath = '/SuiteScripts/QubitOn/qubiton_client.js';
            }

            form.addButton({
                id: 'custpage_qbn_validate',
                label: 'QubitOn Validate',
                functionName: 'validateNow'
            });

            // Display validation status badge if results exist
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
                title: 'QubitOn Customer UE - beforeLoad',
                details: `Record ID: ${rec.id}, Type: ${context.type}`
            });

        } catch (e) {
            log.error({
                title: 'QubitOn Customer UE - beforeLoad Error',
                details: `${e.name}: ${e.message}\n${e.stack}`
            });
        }
    }

    /**
     * beforeSubmit - Runs QubitOn validation on customer create and edit.
     *
     * @param {Object} context
     * @param {Record} context.newRecord - The customer record being saved
     * @param {Record} context.oldRecord - The previous version (edit only)
     * @param {string} context.type - The user event type
     * @throws {error.SuiteScriptError} When stop_on_fail is enabled and validation fails
     */
    function beforeSubmit(context) {
        if (context.type !== context.UserEventType.CREATE &&
            context.type !== context.UserEventType.EDIT) {
            return;
        }

        const executionContext = runtime.executionContext;
        if (SKIP_CONTEXTS.has(executionContext)) {
            log.audit({
                title: 'QubitOn Customer UE - Skipping Validation',
                details: `Execution context: ${executionContext}`
            });
            return;
        }

        const currentScript = runtime.getCurrentScript();
        const autoValidate = currentScript.getParameter({
            name: 'custscript_qbn_cust_auto_validate'
        });

        if (!autoValidate) {
            log.debug({
                title: 'QubitOn Customer UE - Auto-validate Disabled',
                details: 'Skipping validation per script parameter'
            });
            return;
        }

        // Check governance budget
        const remainingUsage = currentScript.getRemainingUsage();
        if (remainingUsage < 100) {
            log.audit({
                title: 'QubitOn Customer UE - Governance Limit',
                details: `Only ${remainingUsage} units remaining, skipping validation`
            });
            setValidationStatus(context.newRecord, STATUS.PENDING, null, 0,
                'Validation deferred: insufficient governance units');
            return;
        }

        try {
            const rec = context.newRecord;
            const customerData = extractCustomerData(rec);

            // Skip if no meaningful data
            if (!customerData.companyName && !customerData.firstName && !customerData.taxId) {
                log.debug({
                    title: 'QubitOn Customer UE - No Data to Validate',
                    details: 'Customer has no name or tax ID'
                });
                setValidationStatus(rec, STATUS.PENDING, null, 0,
                    'Validation skipped: no identifiable data provided');
                return;
            }

            // Skip if no relevant fields changed (edit only)
            if (context.type === context.UserEventType.EDIT) {
                if (!hasValidationFieldsChanged(rec, context.oldRecord)) {
                    log.debug({
                        title: 'QubitOn Customer UE - No Changes',
                        details: 'Validation-relevant fields unchanged, skipping'
                    });
                    return;
                }
            }

            log.audit({
                title: 'QubitOn Customer UE - Running Validation',
                details: `Customer: ${customerData.companyName || customerData.firstName + ' ' + customerData.lastName}`
            });

            const result = validation.validateRecord(rec, 'customer');

            var score = Math.round((result.summary.passed / Math.max(result.summary.total, 1)) * 100);
            setValidationStatus(
                rec,
                result.passed ? STATUS.PASS : STATUS.FAIL,
                new Date(),
                score,
                JSON.stringify(result.summary || {}),
                ''
            );

            const stopOnFail = currentScript.getParameter({
                name: 'custscript_qbn_cust_stop_on_fail'
            });

            if (stopOnFail && !result.passed) {
                const failureReasons = extractFailureReasons(result);
                throw error.create({
                    name: 'QBN_VALIDATION_FAILED',
                    message: `QubitOn validation failed for this customer. ${failureReasons}`,
                    notifyOff: false
                });
            }

        } catch (e) {
            if (e.name === 'QBN_VALIDATION_FAILED') {
                throw e;
            }

            log.error({
                title: 'QubitOn Customer UE - Validation Error',
                details: `${e.name}: ${e.message}\n${e.stack}`
            });
            setValidationStatus(context.newRecord, STATUS.ERROR, new Date(), 0,
                `Validation error: ${e.message}`);
        }
    }

    /**
     * afterSubmit - Logs validation results for audit trail.
     *
     * @param {Object} context
     * @param {Record} context.newRecord - The saved customer record
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
                title: 'QubitOn Customer UE - Validation Complete',
                details: JSON.stringify({
                    recordId: rec.id,
                    recordType: 'customer',
                    status: getStatusLabel(status),
                    score: score,
                    validationId: validationId,
                    eventType: context.type
                })
            });

        } catch (e) {
            log.error({
                title: 'QubitOn Customer UE - afterSubmit Error',
                details: `${e.name}: ${e.message}`
            });
        }
    }

    // ─── Helper Functions ────────────────────────────────────────────────

    /**
     * Extracts customer data fields for validation.
     * Handles both company (B2B) and individual (B2C) customer types.
     *
     * @param {Record} rec - The customer record
     * @returns {Object} Customer data object with all validation-relevant fields
     */
    function extractCustomerData(rec) {
        const isPersonVal = rec.getValue({ fieldId: 'isperson' });
        const isPerson = isPersonVal === true || isPersonVal === 'T' || isPersonVal === 't';

        const data = {
            isPerson: isPerson,
            companyName: rec.getValue({ fieldId: 'companyname' }) || '',
            firstName: rec.getValue({ fieldId: 'firstname' }) || '',
            lastName: rec.getValue({ fieldId: 'lastname' }) || '',
            email: rec.getValue({ fieldId: 'email' }) || '',
            phone: rec.getValue({ fieldId: 'phone' }) || '',
            altPhone: rec.getValue({ fieldId: 'altphone' }) || '',
            fax: rec.getValue({ fieldId: 'fax' }) || '',
            url: rec.getValue({ fieldId: 'url' }) || '',
            taxId: rec.getValue({ fieldId: 'vatregnumber' }) || '',
            category: rec.getText({ fieldId: 'category' }) || '',
            subsidiary: rec.getText({ fieldId: 'subsidiary' }) || '',
            stage: rec.getText({ fieldId: 'stage' }) || '',
            salesRep: rec.getText({ fieldId: 'salesrep' }) || '',
            territory: rec.getText({ fieldId: 'territory' }) || '',
            creditLimit: rec.getValue({ fieldId: 'creditlimit' }) || 0,
            terms: rec.getText({ fieldId: 'terms' }) || '',
            taxable: rec.getValue({ fieldId: 'taxable' }) || false,
            addresses: []
        };

        // Extract address sublist
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

        // Extract contact sublist (primary contacts)
        const contactCount = rec.getLineCount({ sublistId: 'contactroles' });
        data.contacts = [];
        for (let i = 0; i < Math.min(contactCount, 10); i++) {
            data.contacts.push({
                contact: rec.getSublistText({
                    sublistId: 'contactroles',
                    fieldId: 'contact',
                    line: i
                }),
                email: rec.getSublistValue({
                    sublistId: 'contactroles',
                    fieldId: 'email',
                    line: i
                }),
                role: rec.getSublistText({
                    sublistId: 'contactroles',
                    fieldId: 'role',
                    line: i
                })
            });
        }

        return data;
    }

    /**
     * Checks whether any validation-relevant fields changed.
     *
     * @param {Record} newRec - The new version of the record
     * @param {Record} oldRec - The old version of the record
     * @returns {boolean} True if any relevant field changed
     */
    function hasValidationFieldsChanged(newRec, oldRec) {
        const fieldsToCheck = [
            'companyname', 'firstname', 'lastname', 'vatregnumber',
            'email', 'phone', 'altphone', 'url', 'taxable'
        ];

        for (const fieldId of fieldsToCheck) {
            const newVal = newRec.getValue({ fieldId: fieldId });
            const oldVal = oldRec.getValue({ fieldId: fieldId });
            if (String(newVal || '') !== String(oldVal || '')) {
                return true;
            }
        }

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
     * @param {Record} rec - The customer record
     * @param {string} status - Status list value
     * @param {Date|null} date - Validation timestamp
     * @param {number} score - Validation score (0-100)
     * @param {string} details - JSON details string
     * @param {string} [validationId] - QubitOn validation reference ID
     */
    function setValidationStatus(rec, status, date, score, details, validationId) {
        rec.setValue({ fieldId: FIELDS.STATUS, value: status });

        if (date) {
            rec.setValue({ fieldId: FIELDS.DATE, value: date });
        }

        rec.setValue({ fieldId: FIELDS.SCORE, value: score });

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
     * @param {Object} result - Validation result
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
            return 'Please review the customer data and try again.';
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

    return {
        beforeLoad: beforeLoad,
        beforeSubmit: beforeSubmit,
        afterSubmit: afterSubmit
    };
});
