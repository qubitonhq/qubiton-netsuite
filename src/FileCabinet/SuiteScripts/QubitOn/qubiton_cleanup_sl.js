/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * @description Administrative Suitelet that allows NetSuite administrators to
 *   selectively purge QubitOn data (API logs, validation configs, configuration
 *   records). Intended for use during troubleshooting or full data removal.
 *
 *   Deploy at: /app/site/hosting/scriptlet.nl?script=customscript_qubiton_cleanup&deploy=customdeploy_qubiton_cleanup
 *
 * @copyright 2026 QubitOn
 * @author QubitOn Engineering
 */
define(['N/ui/serverWidget', 'N/record', 'N/search', 'N/log', 'N/runtime', 'N/format'],
    function (serverWidget, record, search, log, runtime, format) {

        /**
         * Custom record type IDs.
         * @enum {string}
         */
        var RECORD_TYPE = {
            CONFIG: 'customrecord_qubiton_config',
            VAL_CFG: 'customrecord_qubiton_val_cfg',
            API_LOG: 'customrecord_qubiton_api_log'
        };

        /**
         * Maximum records to delete per search-and-delete cycle.
         * Keeps governance usage within safe limits for a Suitelet execution.
         * @type {number}
         */
        var BATCH_SIZE = 200;

        /**
         * Governance usage threshold below which we stop deleting records.
         * Leaves headroom for page rendering and logging.
         * @type {number}
         */
        var GOVERNANCE_THRESHOLD = 150;

        /**
         * Default number of days for the "delete logs older than" date field.
         * @type {number}
         */
        var DEFAULT_RETENTION_DAYS = 90;

        // -------------------------------------------------------------------
        // GET — render the cleanup form
        // -------------------------------------------------------------------

        /**
         * Builds and returns the cleanup configuration form.
         *
         * @param {Object} context - Suitelet context.
         * @param {Object} context.response - The HTTP response object.
         */
        function renderForm(context) {
            var form = serverWidget.createForm({
                title: 'QubitOn Data Cleanup'
            });

            form.addFieldGroup({
                id: 'custpage_grp_options',
                label: 'Select Data to Remove'
            });

            // --- Checkbox: API Logs ---
            var fldLogs = form.addField({
                id: 'custpage_delete_logs',
                type: serverWidget.FieldType.CHECKBOX,
                label: 'Delete API Log Records',
                container: 'custpage_grp_options'
            });
            fldLogs.defaultValue = 'T';
            fldLogs.setHelpText({
                help: 'Removes API call log records (customrecord_qubiton_api_log) older than the date specified below.'
            });

            // --- Date field: logs older than ---
            var defaultDate = new Date();
            defaultDate.setDate(defaultDate.getDate() - DEFAULT_RETENTION_DAYS);

            var fldDate = form.addField({
                id: 'custpage_log_cutoff',
                type: serverWidget.FieldType.DATE,
                label: 'Delete Logs Created Before',
                container: 'custpage_grp_options'
            });
            fldDate.defaultValue = format.format({
                value: defaultDate,
                type: format.Type.DATE
            });
            fldDate.setHelpText({
                help: 'Only API log records created before this date will be deleted. ' +
                    'Default is ' + DEFAULT_RETENTION_DAYS + ' days ago.'
            });

            // --- Checkbox: Validation configs ---
            var fldValCfg = form.addField({
                id: 'custpage_delete_val_cfg',
                type: serverWidget.FieldType.CHECKBOX,
                label: 'Delete Validation Config Records',
                container: 'custpage_grp_options'
            });
            fldValCfg.defaultValue = 'F';
            fldValCfg.setHelpText({
                help: 'Removes all QubitOn validation configuration records (customrecord_qubiton_val_cfg). ' +
                    'You will need to reconfigure validation settings if you reinstall.'
            });

            // --- Checkbox: Configuration record ---
            var fldConfig = form.addField({
                id: 'custpage_delete_config',
                type: serverWidget.FieldType.CHECKBOX,
                label: 'Delete Configuration Record',
                container: 'custpage_grp_options'
            });
            fldConfig.defaultValue = 'F';
            fldConfig.setHelpText({
                help: 'Removes the QubitOn configuration record (customrecord_qubiton_config) including ' +
                    'API key and connection settings. This cannot be undone.'
            });

            // --- Warning ---
            form.addFieldGroup({
                id: 'custpage_grp_warning',
                label: 'Important'
            });

            var fldWarning = form.addField({
                id: 'custpage_warning',
                type: serverWidget.FieldType.INLINEHTML,
                label: ' ',
                container: 'custpage_grp_warning'
            });
            fldWarning.defaultValue =
                '<div style="padding:12px;background:#fff3cd;border:1px solid #ffc107;border-radius:4px;margin:8px 0;">' +
                '<strong>Warning:</strong> Deleted records cannot be recovered. ' +
                'If you plan to reinstall the QubitOn SuiteApp, consider keeping the configuration ' +
                'and validation config records.' +
                '</div>';

            form.addSubmitButton({ label: 'Clean Up' });

            context.response.writePage(form);
        }

        // -------------------------------------------------------------------
        // POST — process the cleanup
        // -------------------------------------------------------------------

        /**
         * Processes the cleanup form submission. Deletes selected record types
         * in governance-aware batches and displays a summary.
         *
         * @param {Object} context - Suitelet context.
         * @param {Object} context.request - The HTTP request object.
         * @param {Object} context.response - The HTTP response object.
         */
        function processCleanup(context) {
            var request = context.request;
            var deleteLogs = request.parameters.custpage_delete_logs === 'T';
            var deleteValCfg = request.parameters.custpage_delete_val_cfg === 'T';
            var deleteConfig = request.parameters.custpage_delete_config === 'T';
            var cutoffDateRaw = request.parameters.custpage_log_cutoff;

            var summary = [];
            var errors = [];

            log.audit({
                title: 'QubitOn Cleanup',
                details: 'Cleanup started. Logs=' + deleteLogs +
                    ', ValCfg=' + deleteValCfg + ', Config=' + deleteConfig +
                    ', Cutoff=' + cutoffDateRaw
            });

            // --- Delete API logs ---
            if (deleteLogs) {
                try {
                    var cutoffDate = cutoffDateRaw
                        ? format.parse({ value: cutoffDateRaw, type: format.Type.DATE })
                        : null;

                    var logsDeleted = deleteRecordsByType(
                        RECORD_TYPE.API_LOG,
                        cutoffDate ? [['created', 'before', formatDateForFilter(cutoffDate)]] : []
                    );

                    var msg = 'Deleted ' + logsDeleted + ' API log record(s)';
                    if (cutoffDate) {
                        msg += ' created before ' + cutoffDateRaw;
                    }
                    msg += '.';

                    summary.push(msg);
                    log.audit({ title: 'QubitOn Cleanup', details: msg });
                } catch (e) {
                    var errMsg = 'Error deleting API logs: ' + e.message;
                    errors.push(errMsg);
                    log.error({ title: 'QubitOn Cleanup', details: errMsg });
                }
            }

            // --- Delete validation configs ---
            if (deleteValCfg) {
                try {
                    var valCfgDeleted = deleteRecordsByType(RECORD_TYPE.VAL_CFG, []);
                    var valMsg = 'Deleted ' + valCfgDeleted + ' validation config record(s).';
                    summary.push(valMsg);
                    log.audit({ title: 'QubitOn Cleanup', details: valMsg });
                } catch (e) {
                    var valErr = 'Error deleting validation configs: ' + e.message;
                    errors.push(valErr);
                    log.error({ title: 'QubitOn Cleanup', details: valErr });
                }
            }

            // --- Delete configuration record ---
            if (deleteConfig) {
                try {
                    var configDeleted = deleteRecordsByType(RECORD_TYPE.CONFIG, []);
                    var cfgMsg = 'Deleted ' + configDeleted + ' configuration record(s).';
                    summary.push(cfgMsg);
                    log.audit({ title: 'QubitOn Cleanup', details: cfgMsg });
                } catch (e) {
                    var cfgErr = 'Error deleting configuration record: ' + e.message;
                    errors.push(cfgErr);
                    log.error({ title: 'QubitOn Cleanup', details: cfgErr });
                }
            }

            // --- Nothing selected ---
            if (!deleteLogs && !deleteValCfg && !deleteConfig) {
                summary.push('No cleanup options were selected.');
            }

            log.audit({
                title: 'QubitOn Cleanup',
                details: 'Cleanup complete. Summary: ' + summary.join(' ')
            });

            renderSummaryPage(context, summary, errors);
        }

        // -------------------------------------------------------------------
        // Helpers
        // -------------------------------------------------------------------

        /**
         * Finds and deletes records of a given type matching the provided
         * filters. Processes in batches and checks governance before each batch.
         *
         * @param {string} recordType - Internal ID of the custom record type.
         * @param {Array} filters - SuiteScript search filter expressions.
         * @returns {number} Total number of records deleted.
         */
        function deleteRecordsByType(recordType, filters) {
            var totalDeleted = 0;
            var hasMore = true;

            while (hasMore) {
                var remaining = runtime.getCurrentScript().getRemainingUsage();
                if (remaining < GOVERNANCE_THRESHOLD) {
                    log.audit({
                        title: 'QubitOn Cleanup',
                        details: 'Pausing deletion of ' + recordType +
                            ' — governance remaining: ' + remaining +
                            '. Deleted so far: ' + totalDeleted
                    });
                    break;
                }

                var results;
                try {
                    results = search.create({
                        type: recordType,
                        filters: filters,
                        columns: ['internalid']
                    }).run().getRange({ start: 0, end: BATCH_SIZE });
                } catch (e) {
                    log.error({
                        title: 'QubitOn Cleanup',
                        details: 'Search failed for ' + recordType + ': ' + e.message
                    });
                    break;
                }

                if (results.length === 0) {
                    hasMore = false;
                    break;
                }

                for (var i = 0; i < results.length; i++) {
                    var recId = results[i].id;
                    try {
                        record.delete({ type: recordType, id: recId });
                        totalDeleted++;
                    } catch (e) {
                        log.error({
                            title: 'QubitOn Cleanup',
                            details: 'Failed to delete ' + recordType +
                                ' ID ' + recId + ': ' + e.message
                        });
                    }

                    // Re-check governance after each delete (each costs ~2-4 units)
                    if (runtime.getCurrentScript().getRemainingUsage() < GOVERNANCE_THRESHOLD) {
                        log.audit({
                            title: 'QubitOn Cleanup',
                            details: 'Governance limit approaching during ' + recordType +
                                ' deletion. Deleted so far: ' + totalDeleted
                        });
                        hasMore = false;
                        break;
                    }
                }

                if (results.length < BATCH_SIZE) {
                    hasMore = false;
                }
            }

            return totalDeleted;
        }

        /**
         * Formats a Date object as MM/DD/YYYY for use in search filter
         * expressions.
         *
         * @param {Date} d - The date to format.
         * @returns {string} Formatted date string.
         */
        function formatDateForFilter(d) {
            var month = d.getMonth() + 1;
            var day = d.getDate();
            var year = d.getFullYear();
            return (month < 10 ? '0' : '') + month + '/' +
                   (day < 10 ? '0' : '') + day + '/' + year;
        }

        /**
         * Renders the post-cleanup summary page showing what was deleted and
         * any errors that occurred.
         *
         * @param {Object} context - Suitelet context.
         * @param {string[]} summary - List of summary messages.
         * @param {string[]} errors - List of error messages.
         */
        function renderSummaryPage(context, summary, errors) {
            var form = serverWidget.createForm({
                title: 'QubitOn Cleanup — Results'
            });

            var html = '<div style="padding:16px;max-width:700px;">';

            // Success summary
            if (summary.length > 0) {
                html += '<div style="padding:12px;background:#d4edda;border:1px solid #28a745;' +
                    'border-radius:4px;margin-bottom:12px;">';
                html += '<strong>Cleanup Complete</strong><ul style="margin:8px 0 0 0;padding-left:20px;">';
                for (var i = 0; i < summary.length; i++) {
                    html += '<li>' + escapeHtml(summary[i]) + '</li>';
                }
                html += '</ul></div>';
            }

            // Errors
            if (errors.length > 0) {
                html += '<div style="padding:12px;background:#f8d7da;border:1px solid #dc3545;' +
                    'border-radius:4px;margin-bottom:12px;">';
                html += '<strong>Errors Encountered</strong><ul style="margin:8px 0 0 0;padding-left:20px;">';
                for (var j = 0; j < errors.length; j++) {
                    html += '<li>' + escapeHtml(errors[j]) + '</li>';
                }
                html += '</ul></div>';
            }

            // Governance info
            var remaining = runtime.getCurrentScript().getRemainingUsage();
            html += '<p style="color:#666;font-size:12px;">Governance units remaining: ' +
                remaining + '</p>';

            html += '</div>';

            var fldResult = form.addField({
                id: 'custpage_results',
                type: serverWidget.FieldType.INLINEHTML,
                label: ' '
            });
            fldResult.defaultValue = html;

            context.response.writePage(form);
        }

        /**
         * Escapes HTML special characters to prevent XSS in inline HTML fields.
         *
         * @param {string} str - The string to escape.
         * @returns {string} HTML-escaped string.
         */
        function escapeHtml(str) {
            if (!str) return '';
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        // -------------------------------------------------------------------
        // Entry point
        // -------------------------------------------------------------------

        /**
         * Main Suitelet entry point. Routes GET requests to the form renderer
         * and POST requests to the cleanup processor.
         *
         * @param {Object} context - Suitelet context.
         * @param {Object} context.request - The HTTP request object.
         * @param {Object} context.response - The HTTP response object.
         */
        function onRequest(context) {
            if (context.request.method === 'GET') {
                renderForm(context);
            } else {
                processCleanup(context);
            }
        }

        return {
            onRequest: onRequest
        };
    });
