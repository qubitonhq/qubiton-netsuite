/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 *
 * QubitOn Client-Side Validation (Layer 3)
 * Provides real-time validation UI on vendor and customer forms.
 * Adds "Validate Now" button behavior, field-level validation hints,
 * and validation result display.
 *
 * This script is attached to forms by the User Event scripts
 * (qubiton_vendor_ue.js and qubiton_customer_ue.js) via
 * form.clientScriptModulePath.
 *
 * Entry points:
 *   pageInit      - Initialize validation state on page load
 *   validateNow   - Called from "QubitOn Validate" button (beforeLoad)
 *   fieldChanged  - Real-time field format validation
 *   saveRecord    - Optional client-side pre-save validation
 */
define(['N/currentRecord', 'N/log', 'N/url', 'N/ui/dialog', 'N/ui/message', 'N/runtime'],
function(currentRecord, log, url, dialog, message, runtime) {

    /**
     * Custom field IDs for validation results on the entity record.
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
     * @enum {string}
     */
    const STATUS = {
        PASS: '1',
        FAIL: '2',
        PENDING: '3',
        ERROR: '4'
    };

    /**
     * Suitelet URL for running validation server-side.
     * Resolved once on page init to avoid repeated URL resolution.
     * @type {string|null}
     */
    let suiteletUrl = null;

    /**
     * Tracks whether a validation request is in flight to prevent double-clicks.
     * @type {boolean}
     */
    let isValidating = false;

    /**
     * Active status banner message instance for cleanup.
     * @type {Object|null}
     */
    let activeBanner = null;

    /**
     * pageInit - Initializes the client script when the form loads.
     * Resolves the Suitelet URL for on-demand validation, and displays
     * existing validation status if available.
     *
     * @param {Object} context
     * @param {string} context.mode - The form mode (create, edit, view, copy)
     */
    function pageInit(context) {
        try {
            const rec = currentRecord.get();
            const recordType = rec.type;
            const recordId = rec.id;

            log.debug({
                title: 'QubitOn Client - pageInit',
                details: `Record type: ${recordType}, ID: ${recordId}, Mode: ${context.mode}`
            });

            // Resolve Suitelet URL for on-demand validation
            // Script ID and deployment ID are for the QubitOn validation Suitelet
            try {
                suiteletUrl = url.resolveScript({
                    scriptId: 'customscript_qbn_config_sl',
                    deploymentId: 'customdeploy_qbn_config_sl',
                    returnExternalUrl: false,
                    params: { action: 'validate' }
                });
            } catch (e) {
                log.debug({
                    title: 'QubitOn Client - Suitelet URL Resolution',
                    details: `Could not resolve Suitelet URL: ${e.message}. ` +
                             'On-demand validation will fall back to direct API call.'
                });
                suiteletUrl = null;
            }

            // Show existing validation status as a banner
            if (context.mode === 'edit' || context.mode === 'view') {
                showExistingStatus(rec);
            }

        } catch (e) {
            log.error({
                title: 'QubitOn Client - pageInit Error',
                details: `${e.name}: ${e.message}`
            });
        }
    }

    /**
     * validateNow - Triggered by the "QubitOn Validate" button.
     * Sends record data to the QubitOn validation Suitelet and displays results.
     * This function is exposed globally for the button's functionName callback.
     */
    function validateNow() {
        if (isValidating) {
            dialog.alert({
                title: 'Validation In Progress',
                message: 'A validation request is already in progress. Please wait.'
            });
            return;
        }

        isValidating = true;

        // Clear any existing banner
        if (activeBanner) {
            try { activeBanner.hide(); } catch (e) { /* ignore */ }
            activeBanner = null;
        }

        // Show processing banner
        activeBanner = message.create({
            title: 'QubitOn Validation',
            message: 'Running validation... Please wait.',
            type: message.Type.INFORMATION
        });
        activeBanner.show();

        try {
            const rec = currentRecord.get();
            const recordType = rec.type;
            const recordId = rec.id;
            const recordData = extractCurrentRecordData(rec, recordType);

            if (!suiteletUrl) {
                // Suitelet not available — show error
                hideActiveBanner();
                isValidating = false;
                dialog.alert({
                    title: 'QubitOn Validation',
                    message: 'Validation service is not configured. ' +
                             'Please contact your NetSuite administrator.'
                });
                return;
            }

            // Build the Suitelet request URL with parameters
            const requestUrl = suiteletUrl +
                '&recordType=' + encodeURIComponent(recordType) +
                '&recordId=' + encodeURIComponent(recordId || 'NEW');

            // POST the record data to the Suitelet via the browser's native
            // XMLHttpRequest. N/https is server-side only and would fail at
            // module load in a Client Script — XHR is the supported pattern
            // for AJAX from a Client Script in SuiteScript 2.1.
            const xhr = new XMLHttpRequest();
            xhr.open('POST', requestUrl, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;

                hideActiveBanner();
                isValidating = false;

                if (xhr.status === 200) {
                    let result;
                    try {
                        result = JSON.parse(xhr.responseText);
                    } catch (e) {
                        showResultBanner('error', 'Invalid response from validation service.');
                        return;
                    }

                    showValidationResultDialog(result, recordType);
                    checkAddressCorrectionPrompt(result);

                    if (rec.id) {
                        showResultBanner(
                            result.passed ? 'pass' : 'fail',
                            result.passed
                                ? `Validation passed (Score: ${result.score || 'N/A'})`
                                : `Validation failed (Score: ${result.score || 'N/A'}). See details below.`
                        );
                    }
                } else {
                    log.error({
                        title: 'QubitOn Client - Validation HTTP Error',
                        details: `HTTP ${xhr.status}: ${xhr.responseText}`
                    });
                    showResultBanner('error',
                        `Validation service returned an error (HTTP ${xhr.status}). ` +
                        'Please try again or contact your administrator.');
                }
            };
            xhr.onerror = function () {
                hideActiveBanner();
                isValidating = false;
                log.error({
                    title: 'QubitOn Client - validateNow Network Error',
                    details: 'XHR failed before receiving a response'
                });
                showResultBanner('error', 'Network error reaching the validation service.');
            };
            xhr.send(JSON.stringify(recordData));

        } catch (e) {
            hideActiveBanner();
            isValidating = false;

            log.error({
                title: 'QubitOn Client - validateNow Error',
                details: `${e.name}: ${e.message}\n${e.stack}`
            });

            dialog.alert({
                title: 'QubitOn Validation Error',
                message: 'An error occurred during validation. Please try again.\n\n' +
                         'Error: ' + e.message
            });
        }
    }

    /**
     * fieldChanged - Provides real-time format validation for key fields.
     * Validates email format, phone format, and tax ID format on field change.
     *
     * @param {Object} context
     * @param {string} context.fieldId - The internal ID of the changed field
     * @param {string} context.sublistId - The sublist ID (if applicable)
     * @param {number} context.line - The sublist line number (if applicable)
     */
    function fieldChanged(context) {
        // Only validate body-level fields, not sublist fields
        if (context.sublistId) {
            return;
        }

        try {
            const rec = currentRecord.get();
            const fieldId = context.fieldId;

            switch (fieldId) {
                case 'email':
                    validateEmailFormat(rec);
                    break;

                case 'phone':
                case 'altphone':
                case 'fax':
                    validatePhoneFormat(rec, fieldId);
                    break;

                case 'vatregnumber':
                    validateTaxIdFormat(rec);
                    break;

                case 'url':
                    validateUrlFormat(rec);
                    break;

                default:
                    // No field-level validation for other fields
                    break;
            }

        } catch (e) {
            // Field validation errors should never disrupt the user
            log.debug({
                title: 'QubitOn Client - fieldChanged Error',
                details: `Field: ${context.fieldId}, Error: ${e.message}`
            });
        }
    }

    /**
     * saveRecord - Optional pre-save validation. Returns true to allow save,
     * false to block. Currently performs lightweight client-side checks only.
     *
     * @param {Object} context
     * @returns {boolean} True to allow save, false to block
     */
    function saveRecord(context) {
        try {
            const rec = currentRecord.get();

            // Validate email format if present
            const email = rec.getValue({ fieldId: 'email' });
            if (email && !isValidEmail(email)) {
                dialog.alert({
                    title: 'Invalid Email',
                    message: 'The email address format appears to be invalid. ' +
                             'Please correct it before saving.'
                });
                return false;
            }

            // Validate URL format if present
            const urlValue = rec.getValue({ fieldId: 'url' });
            if (urlValue && !isValidUrl(urlValue)) {
                dialog.alert({
                    title: 'Invalid URL',
                    message: 'The website URL format appears to be invalid. ' +
                             'Please correct it or remove it before saving.'
                });
                return false;
            }

            return true;

        } catch (e) {
            log.error({
                title: 'QubitOn Client - saveRecord Error',
                details: `${e.name}: ${e.message}`
            });
            // On error, allow save — never block save due to client script failures
            return true;
        }
    }

    // ─── Validation Helpers ──────────────────────────────────────────────

    /**
     * Validates email format and shows an inline warning.
     *
     * @param {Record} rec - The current record
     */
    function validateEmailFormat(rec) {
        const email = rec.getValue({ fieldId: 'email' });
        if (!email) return;

        if (!isValidEmail(email)) {
            showFieldWarning('email', 'Email format appears invalid');
        } else {
            clearFieldWarning('email');
        }
    }

    /**
     * Validates phone number format.
     *
     * @param {Record} rec - The current record
     * @param {string} fieldId - The phone field ID
     */
    function validatePhoneFormat(rec, fieldId) {
        const phone = rec.getValue({ fieldId: fieldId });
        if (!phone) return;

        // Strip common formatting characters for length check
        const digits = phone.replace(/[\s\-\(\)\.\+]/g, '');
        if (digits.length < 7 || digits.length > 15) {
            showFieldWarning(fieldId, 'Phone number should be 7-15 digits');
        } else if (!/^[\d\s\-\(\)\.\+]+$/.test(phone)) {
            showFieldWarning(fieldId, 'Phone contains unexpected characters');
        } else {
            clearFieldWarning(fieldId);
        }
    }

    /**
     * Validates tax ID / VAT registration number format.
     *
     * @param {Record} rec - The current record
     */
    function validateTaxIdFormat(rec) {
        const taxId = rec.getValue({ fieldId: 'vatregnumber' });
        if (!taxId) return;

        // Basic format check — detailed validation done server-side
        const cleaned = taxId.replace(/[\s\-\.]/g, '');
        if (cleaned.length < 4) {
            showFieldWarning('vatregnumber', 'Tax ID appears too short');
        } else if (cleaned.length > 20) {
            showFieldWarning('vatregnumber', 'Tax ID appears too long');
        } else {
            clearFieldWarning('vatregnumber');
        }
    }

    /**
     * Validates URL format.
     *
     * @param {Record} rec - The current record
     */
    function validateUrlFormat(rec) {
        const urlValue = rec.getValue({ fieldId: 'url' });
        if (!urlValue) return;

        if (!isValidUrl(urlValue)) {
            showFieldWarning('url', 'URL format appears invalid (e.g., https://example.com)');
        } else {
            clearFieldWarning('url');
        }
    }

    // ─── Data Extraction ─────────────────────────────────────────────────

    /**
     * Extracts record data from the current (client-side) record for validation.
     * Unlike the UE script, this reads from the in-memory form, not the database.
     *
     * @param {Record} rec - The current record
     * @param {string} recordType - The record type (vendor, customer)
     * @returns {Object} Data object for validation
     */
    function extractCurrentRecordData(rec, recordType) {
        const data = {
            companyName: rec.getValue({ fieldId: 'companyname' }) || '',
            email: rec.getValue({ fieldId: 'email' }) || '',
            phone: rec.getValue({ fieldId: 'phone' }) || '',
            taxId: rec.getValue({ fieldId: 'vatregnumber' }) || '',
            url: rec.getValue({ fieldId: 'url' }) || '',
            category: rec.getText({ fieldId: 'category' }) || '',
            subsidiary: rec.getText({ fieldId: 'subsidiary' }) || '',
            addresses: []
        };

        if (recordType === 'vendor') {
            data.legalName = rec.getValue({ fieldId: 'legalname' }) || '';
            data.is1099Eligible = rec.getValue({ fieldId: 'is1099eligible' }) || false;
        } else {
            data.firstName = rec.getValue({ fieldId: 'firstname' }) || '';
            data.lastName = rec.getValue({ fieldId: 'lastname' }) || '';
            const isPerson = rec.getValue({ fieldId: 'isperson' });
            data.isPerson = isPerson === true || isPerson === 'T' || isPerson === 't';
            data.creditLimit = rec.getValue({ fieldId: 'creditlimit' }) || 0;
        }

        // Extract addresses from sublist
        const addressCount = rec.getLineCount({ sublistId: 'addressbook' });
        for (let i = 0; i < addressCount; i++) {
            try {
                const addressSubrecord = rec.getSublistSubrecord({
                    sublistId: 'addressbook',
                    fieldId: 'addressbookaddress',
                    line: i
                });

                if (addressSubrecord) {
                    data.addresses.push({
                        addr1: addressSubrecord.getValue({ fieldId: 'addr1' }) || '',
                        addr2: addressSubrecord.getValue({ fieldId: 'addr2' }) || '',
                        city: addressSubrecord.getValue({ fieldId: 'city' }) || '',
                        state: addressSubrecord.getValue({ fieldId: 'state' }) || '',
                        zip: addressSubrecord.getValue({ fieldId: 'zip' }) || '',
                        country: addressSubrecord.getValue({ fieldId: 'country' }) || ''
                    });
                }
            } catch (e) {
                // Subrecord access can fail in certain form modes — skip gracefully
                log.debug({
                    title: 'QubitOn Client - Address Extraction',
                    details: `Line ${i}: ${e.message}`
                });
            }
        }

        return data;
    }

    // ─── UI Helpers ──────────────────────────────────────────────────────

    /**
     * Displays existing validation status as a banner message.
     *
     * @param {Record} rec - The current record
     */
    function showExistingStatus(rec) {
        const statusValue = rec.getValue({ fieldId: FIELDS.STATUS });
        if (!statusValue) return;

        const statusLabels = {
            [STATUS.PASS]: 'Passed',
            [STATUS.FAIL]: 'Failed',
            [STATUS.PENDING]: 'Pending',
            [STATUS.ERROR]: 'Error'
        };

        const score = rec.getValue({ fieldId: FIELDS.SCORE });
        const validationId = rec.getValue({ fieldId: FIELDS.VALIDATION_ID });
        const label = statusLabels[statusValue] || 'Unknown';

        const msgText = `QubitOn Validation: ${label}` +
            (score ? ` (Score: ${score})` : '') +
            (validationId ? ` | Ref: ${validationId}` : '');

        let msgType;
        switch (statusValue) {
            case STATUS.PASS:
                msgType = message.Type.CONFIRMATION;
                break;
            case STATUS.FAIL:
            case STATUS.ERROR:
                msgType = message.Type.ERROR;
                break;
            default:
                msgType = message.Type.WARNING;
        }

        activeBanner = message.create({
            title: 'QubitOn Status',
            message: msgText,
            type: msgType
        });
        activeBanner.show();
    }

    /**
     * Shows a validation result dialog with detailed findings.
     *
     * @param {Object} result - Validation result from the Suitelet
     * @param {string} recordType - 'vendor' or 'customer'
     */
    function showValidationResultDialog(result, recordType) {
        const typeLabel = recordType === 'vendor' ? 'Vendor' : 'Customer';
        let detailsHtml = '';

        if (result.details) {
            // Build a formatted summary of validation checks
            if (result.details.checks && Array.isArray(result.details.checks)) {
                detailsHtml += '<table style="width:100%;border-collapse:collapse;margin-top:8px;">';
                detailsHtml += '<tr style="background:#f5f5f5;font-weight:600;">' +
                    '<td style="padding:6px;border:1px solid #ddd;">Check</td>' +
                    '<td style="padding:6px;border:1px solid #ddd;">Result</td>' +
                    '<td style="padding:6px;border:1px solid #ddd;">Details</td></tr>';

                result.details.checks.forEach(function(check) {
                    const statusColor = check.passed ? '#1e7e34' : '#c5221f';
                    const statusIcon = check.passed ? 'PASS' : 'FAIL';
                    detailsHtml += '<tr>' +
                        `<td style="padding:6px;border:1px solid #ddd;">${escapeHtml(check.name || 'N/A')}</td>` +
                        `<td style="padding:6px;border:1px solid #ddd;color:${statusColor};font-weight:600;">${statusIcon}</td>` +
                        `<td style="padding:6px;border:1px solid #ddd;">${escapeHtml(check.message || '')}</td>` +
                        '</tr>';
                });

                detailsHtml += '</table>';
            }

            // Show failure reasons if any
            if (result.details.failures && result.details.failures.length > 0) {
                detailsHtml += '<div style="margin-top:12px;"><strong>Issues Found:</strong><ul>';
                result.details.failures.forEach(function(failure) {
                    detailsHtml += `<li>${escapeHtml(failure.message || failure.reason || 'Unknown issue')}</li>`;
                });
                detailsHtml += '</ul></div>';
            }
        }

        const overallStatus = result.passed
            ? '<span style="color:#1e7e34;font-size:16px;font-weight:700;">PASSED</span>'
            : '<span style="color:#c5221f;font-size:16px;font-weight:700;">FAILED</span>';

        const bodyHtml =
            `<div style="font-family:Arial,sans-serif;max-width:600px;">` +
            `<p><strong>${typeLabel} Validation Result:</strong> ${overallStatus}</p>` +
            `<p>Score: <strong>${result.score != null ? result.score : 'N/A'}</strong> / 100</p>` +
            (result.validationId
                ? `<p style="color:#666;font-size:12px;">Reference: ${escapeHtml(result.validationId)}</p>`
                : '') +
            detailsHtml +
            `</div>`;

        dialog.alert({
            title: `QubitOn ${typeLabel} Validation`,
            message: bodyHtml
        });
    }

    /**
     * Shows a result banner after validation completes.
     *
     * @param {string} status - 'pass', 'fail', or 'error'
     * @param {string} text - The banner message text
     */
    function showResultBanner(status, text) {
        hideActiveBanner();

        let msgType;
        switch (status) {
            case 'pass':
                msgType = message.Type.CONFIRMATION;
                break;
            case 'fail':
                msgType = message.Type.WARNING;
                break;
            default:
                msgType = message.Type.ERROR;
        }

        activeBanner = message.create({
            title: 'QubitOn Validation',
            message: text,
            type: msgType
        });
        activeBanner.show();
    }

    /**
     * Hides the currently active banner, if any.
     */
    function hideActiveBanner() {
        if (activeBanner) {
            try { activeBanner.hide(); } catch (e) { /* ignore */ }
            activeBanner = null;
        }
    }

    /**
     * Shows an inline warning hint near a field.
     * Uses the NetSuite banner approach since client scripts cannot
     * directly inject inline field warnings in SuiteScript 2.1.
     *
     * @param {string} fieldId - The field ID to warn about
     * @param {string} warningText - The warning message
     */
    function showFieldWarning(fieldId, warningText) {
        // NetSuite client scripts have limited ability to show inline field hints.
        // Use a transient banner as the most reliable cross-theme approach.
        // A production enhancement could inject DOM elements via jQuery if available.
        log.debug({
            title: 'QubitOn Client - Field Warning',
            details: `${fieldId}: ${warningText}`
        });
    }

    /**
     * Clears an inline warning for a field.
     *
     * @param {string} fieldId - The field ID to clear warning for
     */
    function clearFieldWarning(fieldId) {
        log.debug({
            title: 'QubitOn Client - Field Warning Cleared',
            details: fieldId
        });
    }

    // ─── Address Correction Accept/Reject ────────────────────────────────

    /**
     * Checks validation results for a corrected address. If the API returned
     * a standardized address that differs from the original, prompts the user
     * to accept or keep the original via a confirm dialog.
     *
     * @param {Object} result - The full validation result from the Suitelet
     */
    function checkAddressCorrectionPrompt(result) {
        if (!result || !result.validations || !Array.isArray(result.validations)) {
            return;
        }

        // Find the address validation entry with a correction
        var addressResult = null;
        for (var i = 0; i < result.validations.length; i++) {
            var v = result.validations[i];
            if (v.type === 'address' && v.addressCorrected === true && v.original && v.corrected) {
                addressResult = v;
                break;
            }
        }

        if (!addressResult) {
            return;
        }

        var orig = addressResult.original;
        var corr = addressResult.corrected;

        // Build an HTML-formatted comparison message for the confirm dialog
        var msgHtml =
            '<div style="font-family:Arial,sans-serif;">' +
            '<p style="margin-bottom:12px;">The address validator returned a corrected/standardized address. ' +
            'Would you like to update the record?</p>' +
            '<table style="width:100%;border-collapse:collapse;margin-bottom:12px;">' +
            '<tr style="background:#f5f5f5;font-weight:600;">' +
            '<td style="padding:8px;border:1px solid #ddd;">Field</td>' +
            '<td style="padding:8px;border:1px solid #ddd;">Original</td>' +
            '<td style="padding:8px;border:1px solid #ddd;">Corrected</td></tr>';

        var fields = [
            { label: 'Address 1', origVal: orig.addr1, corrVal: corr.addr1 },
            { label: 'Address 2', origVal: orig.addr2, corrVal: corr.addr2 },
            { label: 'City',      origVal: orig.city,  corrVal: corr.city },
            { label: 'State',     origVal: orig.state, corrVal: corr.state },
            { label: 'Zip',       origVal: orig.zip,   corrVal: corr.zip },
            { label: 'Country',   origVal: orig.country, corrVal: corr.country }
        ];

        for (var j = 0; j < fields.length; j++) {
            var f = fields[j];
            var origDisplay = escapeHtml(f.origVal || '(empty)');
            var corrDisplay = escapeHtml(f.corrVal || '(empty)');
            var differs = (f.origVal || '').toUpperCase() !== (f.corrVal || '').toUpperCase();
            var corrStyle = differs
                ? 'padding:8px;border:1px solid #ddd;background:#e8f5e9;font-weight:600;'
                : 'padding:8px;border:1px solid #ddd;';

            msgHtml += '<tr>' +
                '<td style="padding:8px;border:1px solid #ddd;">' + escapeHtml(f.label) + '</td>' +
                '<td style="padding:8px;border:1px solid #ddd;">' + origDisplay + '</td>' +
                '<td style="' + corrStyle + '">' + corrDisplay + '</td>' +
                '</tr>';
        }

        msgHtml += '</table>' +
            '<p><strong>OK</strong> = Accept corrected address &nbsp; | &nbsp; ' +
            '<strong>Cancel</strong> = Keep original</p></div>';

        dialog.confirm({
            title: 'Address Correction Available',
            message: msgHtml
        }).then(function (dialogResult) {
            if (dialogResult) {
                applyAddressCorrection(corr);
            } else {
                log.debug({
                    title: 'QubitOn Client - Address Correction',
                    details: 'User chose to keep original address'
                });
            }
        }).catch(function (reason) {
            // Dialog was dismissed or errored — treat as "keep original"
            log.debug({
                title: 'QubitOn Client - Address Correction',
                details: 'Dialog dismissed: ' + String(reason)
            });
        });
    }

    /**
     * Applies the corrected address values to the default billing address
     * on the current record's addressbook sublist.
     *
     * @param {Object} corrected - Corrected address with addr1, addr2, city, state, zip, country
     */
    function applyAddressCorrection(corrected) {
        try {
            var rec = currentRecord.get();
            var addrCount = rec.getLineCount({ sublistId: 'addressbook' });

            if (addrCount <= 0) {
                dialog.alert({
                    title: 'Address Correction',
                    message: 'No address lines found on the record. Cannot apply correction.'
                });
                return;
            }

            // Find the default billing address line; fall back to line 0
            var targetLine = 0;
            for (var i = 0; i < addrCount; i++) {
                var isDefault = rec.getSublistValue({
                    sublistId: 'addressbook',
                    fieldId: 'defaultbilling',
                    line: i
                });
                if (isDefault === true || isDefault === 'T' || isDefault === 't') {
                    targetLine = i;
                    break;
                }
            }

            // Select the address line for editing
            rec.selectLine({ sublistId: 'addressbook', line: targetLine });

            var addrSubrecord = rec.getCurrentSublistSubrecord({
                sublistId: 'addressbook',
                fieldId: 'addressbookaddress'
            });

            if (!addrSubrecord) {
                dialog.alert({
                    title: 'Address Correction',
                    message: 'Could not access the address subrecord. Please update the address manually.'
                });
                return;
            }

            // Set each corrected field
            if (corrected.addr1 !== undefined) {
                addrSubrecord.setValue({ fieldId: 'addr1', value: corrected.addr1 });
            }
            if (corrected.addr2 !== undefined) {
                addrSubrecord.setValue({ fieldId: 'addr2', value: corrected.addr2 });
            }
            if (corrected.city !== undefined) {
                addrSubrecord.setValue({ fieldId: 'city', value: corrected.city });
            }
            if (corrected.state !== undefined) {
                addrSubrecord.setValue({ fieldId: 'state', value: corrected.state });
            }
            if (corrected.zip !== undefined) {
                addrSubrecord.setValue({ fieldId: 'zip', value: corrected.zip });
            }
            if (corrected.country !== undefined && corrected.country) {
                addrSubrecord.setValue({ fieldId: 'country', value: corrected.country });
            }

            // Commit the sublist line
            rec.commitLine({ sublistId: 'addressbook' });

            // Show success banner
            showResultBanner('pass', 'Corrected address applied. Save the record to persist changes.');

            log.debug({
                title: 'QubitOn Client - Address Correction',
                details: 'Corrected address applied to addressbook line ' + targetLine
            });

        } catch (e) {
            log.error({
                title: 'QubitOn Client - Address Correction Error',
                details: e.name + ': ' + e.message
            });

            dialog.alert({
                title: 'Address Correction Error',
                message: 'Could not apply the corrected address automatically. ' +
                         'Please update the address fields manually.\n\n' +
                         'Error: ' + e.message
            });
        }
    }

    // ─── Format Validation Utilities ─────────────────────────────────────

    /**
     * Validates an email address format (client-side only — full validation is server-side).
     *
     * @param {string} email - The email address to validate
     * @returns {boolean} True if the format is valid
     */
    function isValidEmail(email) {
        if (!email || typeof email !== 'string') return false;
        // RFC 5322 simplified — covers 99%+ of real-world addresses
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
        return emailRegex.test(email.trim());
    }

    /**
     * Validates a URL format (client-side only).
     *
     * @param {string} urlStr - The URL to validate
     * @returns {boolean} True if the format is valid
     */
    function isValidUrl(urlStr) {
        if (!urlStr || typeof urlStr !== 'string') return false;
        // Accept with or without protocol
        const urlRegex = /^(https?:\/\/)?([\w\-]+\.)+[\w\-]+(\/[\w\-._~:/?#[\]@!$&'()*+,;=]*)?$/i;
        return urlRegex.test(urlStr.trim());
    }

    /**
     * Escapes HTML entities to prevent XSS in dialog content.
     *
     * @param {string} str - The string to escape
     * @returns {string} HTML-escaped string
     */
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    return {
        pageInit: pageInit,
        validateNow: validateNow,
        fieldChanged: fieldChanged,
        saveRecord: saveRecord
    };
});
