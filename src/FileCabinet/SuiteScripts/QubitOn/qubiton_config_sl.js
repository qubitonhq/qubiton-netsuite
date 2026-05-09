/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * QubitOn Configuration & Validation Suitelet (Layer 3)
 *
 * Provides:
 *  1. Configuration management UI — view/edit QubitOn API settings
 *  2. Connection test — calls getSupportedTaxFormats() as a health check
 *  3. Validation trigger — runs validation on a specific record (used by
 *     the client script "Validate Now" button)
 */
define([
    'N/ui/serverWidget',
    'N/log',
    'N/record',
    'N/search',
    'N/runtime',
    'N/url',
    'N/redirect',
    'N/error',
    './qubiton_api_client',
    './qubiton_validation'
], function (serverWidget, log, record, search, runtime, url, redirect, error, api, validation) {

    // ---------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------

    var CONFIG_RECORD_TYPE = 'customrecord_qubiton_config';
    var LOG_RECORD_TYPE    = 'customrecord_qubiton_api_log';
    var SCRIPT_ID          = 'customscript_qbn_config_sl';
    var DEPLOY_ID          = 'customdeploy_qbn_config_sl';

    var FIELD = {
        API_KEY:          'custrecord_qbn_api_key',
        API_URL:          'custrecord_qbn_base_url',
        ERROR_MODE:       'custrecord_qbn_error_mode',
        LOG_ENABLED:      'custrecord_qbn_log_enabled'
    };

    var DEFAULT_API_URL = 'https://api.qubiton.com';
    var MAX_LOG_ROWS    = 50;

    // ---------------------------------------------------------------
    // Entry point
    // ---------------------------------------------------------------

    function onRequest(context) {
        var action = context.request.parameters.action || context.request.parameters.custpage_action || '';

        try {
            switch (action) {
                case 'test':
                    handleTestConnection(context);
                    break;
                case 'validate':
                    handleValidateRecord(context);
                    break;
                case 'save':
                    handleSaveConfig(context);
                    break;
                default:
                    handleShowDashboard(context);
                    break;
            }
        } catch (e) {
            log.error({ title: 'QubitOn Config Suitelet Error', details: e.message + '\n' + e.stack });

            if (action === 'test' || action === 'validate') {
                writeJson(context.response, {
                    success: false,
                    error: e.message || 'An unexpected error occurred'
                });
            } else {
                throw e; // re-throw for UI actions so NetSuite shows the error page
            }
        }
    }

    // ---------------------------------------------------------------
    // Action: Show Configuration Dashboard
    // ---------------------------------------------------------------

    function handleShowDashboard(context) {
        var form = serverWidget.createForm({ title: 'QubitOn API Configuration' });

        // ---- Config field group ----
        form.addFieldGroup({ id: 'custgroup_config', label: 'API Settings' });

        var config = loadConfigRecord();

        var fldApiKey = form.addField({
            id: 'custpage_api_key',
            type: serverWidget.FieldType.PASSWORD,
            label: 'API Key',
            container: 'custgroup_config'
        });
        fldApiKey.isMandatory = true;
        if (config.apiKey) {
            fldApiKey.defaultValue = config.apiKey;
        }

        var fldApiUrl = form.addField({
            id: 'custpage_api_url',
            type: serverWidget.FieldType.URL,
            label: 'API Base URL',
            container: 'custgroup_config'
        });
        fldApiUrl.defaultValue = config.apiUrl || DEFAULT_API_URL;

        var fldErrorMode = form.addField({
            id: 'custpage_error_mode',
            type: serverWidget.FieldType.SELECT,
            label: 'Error Mode',
            container: 'custgroup_config'
        });
        fldErrorMode.addSelectOption({ value: 'E', text: 'Error — Block save and show error' });
        fldErrorMode.addSelectOption({ value: 'W', text: 'Warning — Allow save, show warning' });
        fldErrorMode.addSelectOption({ value: 'S', text: 'Silent — Allow save, log only' });
        if (config.errorMode) {
            fldErrorMode.defaultValue = config.errorMode;
        }

        var fldLogEnabled = form.addField({
            id: 'custpage_log_enabled',
            type: serverWidget.FieldType.CHECKBOX,
            label: 'Enable API Logging',
            container: 'custgroup_config'
        });
        fldLogEnabled.defaultValue = config.logEnabled ? 'T' : 'F';

        // ---- Connection status group ----
        form.addFieldGroup({ id: 'custgroup_status', label: 'Connection Status' });

        var fldStatus = form.addField({
            id: 'custpage_conn_status',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' ',
            container: 'custgroup_status'
        });
        fldStatus.defaultValue = buildConnectionStatusHtml(config);

        // ---- Recent API logs group ----
        form.addFieldGroup({ id: 'custgroup_logs', label: 'Recent API Calls' });

        var sublist = form.addSublist({
            id: 'custpage_log_sublist',
            type: serverWidget.SublistType.LIST,
            label: 'API Log (Last ' + MAX_LOG_ROWS + ')'
        });
        sublist.addField({ id: 'custpage_log_date',     type: serverWidget.FieldType.TEXT, label: 'Date' });
        sublist.addField({ id: 'custpage_log_endpoint',  type: serverWidget.FieldType.TEXT, label: 'Endpoint' });
        sublist.addField({ id: 'custpage_log_method',    type: serverWidget.FieldType.TEXT, label: 'Method' });
        sublist.addField({ id: 'custpage_log_status',    type: serverWidget.FieldType.TEXT, label: 'Status' });
        sublist.addField({ id: 'custpage_log_duration',  type: serverWidget.FieldType.TEXT, label: 'Duration (ms)' });
        sublist.addField({ id: 'custpage_log_record',    type: serverWidget.FieldType.TEXT, label: 'Record' });

        populateLogSublist(sublist);

        // ---- Buttons ----
        form.addSubmitButton({ label: 'Save Configuration' });

        form.addField({
            id: 'custpage_action',
            type: serverWidget.FieldType.TEXT,
            label: 'Action'
        }).updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN }).defaultValue = 'save';

        // Test Connection: rendered as a styled link (no script injection).
        // url.resolveScript escapes its result, but we still HTML-escape on render
        // for defence-in-depth.
        var testActionUrl = url.resolveScript({
            scriptId: SCRIPT_ID,
            deploymentId: DEPLOY_ID,
            params: { action: 'test' }
        });

        form.addField({
            id: 'custpage_test_link',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' ',
            container: 'custgroup_status'
        }).defaultValue =
            '<a href="' + escapeHtml(testActionUrl) + '" ' +
            'style="display:inline-block;padding:6px 14px;margin-top:8px;' +
            'background:#1976d2;color:#fff;text-decoration:none;border-radius:4px;' +
            'font-weight:600;font-size:13px;">Test Connection</a>';

        context.response.writePage(form);
    }

    // ---------------------------------------------------------------
    // Action: Save Configuration
    // ---------------------------------------------------------------

    function handleSaveConfig(context) {
        var params = context.request.parameters;

        var apiKey         = params.custpage_api_key       || '';
        var apiUrl         = params.custpage_api_url       || DEFAULT_API_URL;
        var errorMode      = params.custpage_error_mode    || 'E';
        var logEnabled     = params.custpage_log_enabled     === 'T';

        if (!apiKey) {
            throw error.create({
                name: 'QBN_INVALID_CONFIG',
                message: 'API Key is required',
                notifyOff: false
            });
        }
        if (['E', 'W', 'S'].indexOf(errorMode) === -1) {
            throw error.create({
                name: 'QBN_INVALID_CONFIG',
                message: 'Invalid error mode: ' + errorMode,
                notifyOff: false
            });
        }

        var configId = findConfigRecordId();

        if (configId) {
            var rec = record.load({ type: CONFIG_RECORD_TYPE, id: configId });
            rec.setValue({ fieldId: FIELD.API_KEY,          value: apiKey });
            rec.setValue({ fieldId: FIELD.API_URL,          value: apiUrl });
            rec.setValue({ fieldId: FIELD.ERROR_MODE,       value: errorMode });
            rec.setValue({ fieldId: FIELD.LOG_ENABLED,      value: logEnabled });
            rec.save();
            log.audit({ title: 'QubitOn Config Updated', details: 'Config record ' + configId + ' updated by ' + runtime.getCurrentUser().email });
        } else {
            var newRec = record.create({ type: CONFIG_RECORD_TYPE });
            newRec.setValue({ fieldId: FIELD.API_KEY,          value: apiKey });
            newRec.setValue({ fieldId: FIELD.API_URL,          value: apiUrl });
            newRec.setValue({ fieldId: FIELD.ERROR_MODE,       value: errorMode });
            newRec.setValue({ fieldId: FIELD.LOG_ENABLED,      value: logEnabled });
            newRec.save();
            log.audit({ title: 'QubitOn Config Created', details: 'New config record created by ' + runtime.getCurrentUser().email });
        }

        // Redirect back to dashboard
        redirect.toSuitelet({
            scriptId: SCRIPT_ID,
            deploymentId: DEPLOY_ID
        });
    }

    // ---------------------------------------------------------------
    // Action: Test Connection (AJAX — returns JSON)
    // ---------------------------------------------------------------

    function handleTestConnection(context) {
        var startTime = Date.now();

        var config = loadConfigRecord();

        if (!config.apiKey) {
            writeJson(context.response, {
                success: false,
                error: 'No API key configured. Please save your API key first.'
            });
            return;
        }

        // Call getSupportedTaxFormats as a lightweight health check — it requires
        // no parameters and returns quickly.
        var result = api.getSupportedTaxFormats();
        var elapsed = Date.now() - startTime;

        if (result && result.success !== false) {
            var formatCount = 0;
            if (result.data && Array.isArray(result.data)) {
                formatCount = result.data.length;
            } else if (result.formats && Array.isArray(result.formats)) {
                formatCount = result.formats.length;
            }

            writeJson(context.response, {
                success: true,
                message: 'Connection successful',
                responseTimeMs: elapsed,
                taxFormatsReturned: formatCount,
                apiUrl: config.apiUrl || DEFAULT_API_URL,
                timestamp: new Date().toISOString()
            });
        } else {
            writeJson(context.response, {
                success: false,
                error: (result && result.error) || 'API returned an unexpected response',
                responseTimeMs: elapsed,
                apiUrl: config.apiUrl || DEFAULT_API_URL,
                timestamp: new Date().toISOString()
            });
        }
    }

    // ---------------------------------------------------------------
    // Action: Validate Record (AJAX — returns JSON)
    // ---------------------------------------------------------------

    function handleValidateRecord(context) {
        var recordType = context.request.parameters.recordType;
        var recordId   = context.request.parameters.recordId;

        if (!recordType) {
            writeJson(context.response, {
                success: false,
                error: 'Missing required parameter: recordType'
            });
            return;
        }

        var ALLOWED_TYPES = ['vendor', 'customer', 'employee', 'partner', 'contact'];
        if (ALLOWED_TYPES.indexOf(recordType) === -1) {
            writeJson(context.response, {
                success: false,
                error: 'Invalid recordType: ' + recordType + '. Allowed: ' + ALLOWED_TYPES.join(', ')
            });
            return;
        }
        if (!recordId) {
            writeJson(context.response, {
                success: false,
                error: 'Missing required parameter: recordId'
            });
            return;
        }

        // Validate the record ID is a positive integer
        var parsedId = parseInt(recordId, 10);
        if (isNaN(parsedId) || parsedId <= 0) {
            writeJson(context.response, {
                success: false,
                error: 'Invalid recordId: must be a positive integer'
            });
            return;
        }

        var config = loadConfigRecord();
        if (!config.apiKey) {
            writeJson(context.response, {
                success: false,
                error: 'No API key configured. Please configure QubitOn first.'
            });
            return;
        }

        // Load the record
        var rec;
        try {
            rec = record.load({ type: recordType, id: parsedId });
        } catch (e) {
            writeJson(context.response, {
                success: false,
                error: 'Could not load record: ' + recordType + ' #' + parsedId + ' — ' + e.message
            });
            return;
        }

        // Check governance before making API calls
        var remaining = runtime.getCurrentScript().getRemainingUsage();
        if (remaining < 100) {
            writeJson(context.response, {
                success: false,
                error: 'Insufficient governance units for validation (remaining: ' + remaining + ')'
            });
            return;
        }

        // Run all applicable validations via the validation module
        var startTime = Date.now();
        var results = validation.validateRecord(rec, recordType);
        var elapsed = Date.now() - startTime;

        var summary = buildValidationSummary(results.validations);

        writeJson(context.response, {
            success: true,
            recordType: recordType,
            recordId: parsedId,
            durationMs: elapsed,
            summary: summary,
            passed: results.passed,
            validations: results.validations,
            timestamp: new Date().toISOString()
        });
    }

    // ---------------------------------------------------------------
    // Helpers: Config record
    // ---------------------------------------------------------------

    /**
     * Find the internal ID of the singleton config record.
     * @returns {number|null}
     */
    function findConfigRecordId() {
        var results = search.create({
            type: CONFIG_RECORD_TYPE,
            columns: ['internalid'],
            filters: []
        }).run().getRange({ start: 0, end: 1 });

        return results.length > 0 ? results[0].id : null;
    }

    /**
     * Load configuration from the custom record. Returns a plain object
     * with defaults for missing values.
     * @returns {Object}
     */
    function loadConfigRecord() {
        var configId = findConfigRecordId();
        if (!configId) {
            return {
                apiKey: '',
                apiUrl: DEFAULT_API_URL,
                errorMode: 'E',
                logEnabled: true
            };
        }

        var rec = record.load({ type: CONFIG_RECORD_TYPE, id: configId });
        return {
            apiKey:         rec.getValue({ fieldId: FIELD.API_KEY })          || '',
            apiUrl:         rec.getValue({ fieldId: FIELD.API_URL })          || DEFAULT_API_URL,
            errorMode:      rec.getValue({ fieldId: FIELD.ERROR_MODE })       || 'E',
            logEnabled:     !!rec.getValue({ fieldId: FIELD.LOG_ENABLED })
        };
    }

    // ---------------------------------------------------------------
    // Helpers: Log sublist
    // ---------------------------------------------------------------

    function populateLogSublist(sublist) {
        try {
            var logSearch = search.create({
                type: LOG_RECORD_TYPE,
                columns: [
                    search.createColumn({ name: 'created', sort: search.Sort.DESC }),
                    search.createColumn({ name: 'custrecord_qbn_log_endpoint' }),
                    search.createColumn({ name: 'custrecord_qbn_log_method' }),
                    search.createColumn({ name: 'custrecord_qbn_log_status' }),
                    search.createColumn({ name: 'custrecord_qbn_log_duration' }),
                    search.createColumn({ name: 'custrecord_qbn_log_src_type' }),
                    search.createColumn({ name: 'custrecord_qbn_log_src_id' })
                ],
                filters: []
            });

            var results = logSearch.run().getRange({ start: 0, end: MAX_LOG_ROWS });

            for (var i = 0; i < results.length; i++) {
                var row = results[i];
                sublist.setSublistValue({
                    id: 'custpage_log_date',
                    line: i,
                    value: row.getValue('created') || ''
                });
                sublist.setSublistValue({
                    id: 'custpage_log_endpoint',
                    line: i,
                    value: row.getValue('custrecord_qbn_log_endpoint') || ''
                });
                sublist.setSublistValue({
                    id: 'custpage_log_method',
                    line: i,
                    value: row.getValue('custrecord_qbn_log_method') || ''
                });
                sublist.setSublistValue({
                    id: 'custpage_log_status',
                    line: i,
                    value: row.getValue('custrecord_qbn_log_status') || ''
                });
                sublist.setSublistValue({
                    id: 'custpage_log_duration',
                    line: i,
                    value: row.getValue('custrecord_qbn_log_duration') || ''
                });

                var recType = row.getValue('custrecord_qbn_log_src_type') || '';
                var recId   = row.getValue('custrecord_qbn_log_src_id')   || '';
                sublist.setSublistValue({
                    id: 'custpage_log_record',
                    line: i,
                    value: recType ? (recType + ' #' + recId) : ''
                });
            }
        } catch (e) {
            // Log search may fail if the custom record type doesn't exist yet
            log.audit({ title: 'QubitOn Config — Log sublist error', details: e.message });
        }
    }

    // ---------------------------------------------------------------
    // Helpers: UI rendering
    // ---------------------------------------------------------------

    function buildConnectionStatusHtml(config) {
        var suiteletUrl = url.resolveScript({
            scriptId: SCRIPT_ID,
            deploymentId: DEPLOY_ID,
            params: { action: 'test' }
        });

        return '<div id="qubiton-conn-status" style="padding:8px 0;">' +
            '<span id="qubiton-status-text" style="font-size:13px;color:#666;">' +
            (config.apiKey ? 'API key configured. Click "Test Connection" to verify.' : '<span style="color:#c00;">No API key configured.</span>') +
            '</span>' +
            '<div id="qubiton-status-details" style="margin-top:8px;display:none;"></div>' +
            '</div>' +
            '<input type="hidden" id="qubiton-test-url" value="' + escapeHtml(suiteletUrl) + '" />';
    }

    function buildValidationSummary(validations) {
        if (!validations || !Array.isArray(validations)) {
            return { total: 0, passed: 0, failed: 0, warnings: 0, skipped: 0 };
        }
        var summary = { total: validations.length, passed: 0, failed: 0, warnings: 0, skipped: 0 };
        for (var i = 0; i < validations.length; i++) {
            var v = validations[i];
            if (v.skipped) {
                summary.skipped++;
            } else if (v.error) {
                summary.warnings++;
            } else if (v.passed) {
                summary.passed++;
            } else {
                summary.failed++;
            }
        }
        return summary;
    }

    // ---------------------------------------------------------------
    // Helpers: Response utilities
    // ---------------------------------------------------------------

    function writeJson(response, data) {
        response.setHeader({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
        response.write(JSON.stringify(data));
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ---------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------

    return { onRequest: onRequest };
});
