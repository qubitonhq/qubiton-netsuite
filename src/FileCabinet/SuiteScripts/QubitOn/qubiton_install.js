/**
 * @NApiVersion 2.1
 * @NScriptType BundleInstallationScript
 * @NModuleScope SameAccount
 *
 * @description Bundle installation script for the QubitOn SuiteApp.
 *   Handles first-time installation, upgrades, and pre-uninstall cleanup.
 *   Creates default configuration and sample validation config records.
 *
 * @copyright 2026 QubitOn
 * @author QubitOn Engineering
 */
define(['N/record', 'N/search', 'N/log', 'N/runtime'],
    function (record, search, log, runtime) {

        /**
         * Custom record type IDs
         * @enum {string}
         */
        var RECORD_TYPE = {
            CONFIG: 'customrecord_qubiton_config',
            VAL_CFG: 'customrecord_qubiton_val_cfg',
            API_LOG: 'customrecord_qubiton_api_log'
        };

        /**
         * Default configuration values applied on first install.
         * @type {Object}
         */
        var DEFAULT_CONFIG = {
            custrecord_qbn_base_url: 'https://api.qubiton.com',
            custrecord_qbn_timeout: 30000,
            custrecord_qbn_error_mode: 'E',
            custrecord_qbn_log_enabled: true
            // custrecord_qbn_api_key intentionally left blank
        };

        /**
         * Sample validation configuration for vendor records.
         * @type {Object}
         */
        var VENDOR_VAL_CFG = {
            name: 'QubitOn Vendor Validation',
            custrecord_qbn_vc_record_type: 'vendor',
            custrecord_qbn_vc_active: true,
            custrecord_qbn_vc_tax: true,
            custrecord_qbn_vc_address: true,
            custrecord_qbn_vc_sanctions: true,
            custrecord_qbn_vc_email: false,
            custrecord_qbn_vc_phone: false,
            custrecord_qbn_vc_bank: false,
            custrecord_qbn_vc_stop_on_fail: false
        };

        /**
         * Sample validation configuration for customer records.
         * @type {Object}
         */
        var CUSTOMER_VAL_CFG = {
            name: 'QubitOn Customer Validation',
            custrecord_qbn_vc_record_type: 'customer',
            custrecord_qbn_vc_active: true,
            custrecord_qbn_vc_tax: false,
            custrecord_qbn_vc_address: true,
            custrecord_qbn_vc_sanctions: false,
            custrecord_qbn_vc_email: true,
            custrecord_qbn_vc_phone: true,
            custrecord_qbn_vc_bank: false,
            custrecord_qbn_vc_stop_on_fail: false
        };

        /**
         * Maximum number of API log records to delete per batch during cleanup.
         * Keeps governance usage predictable.
         * @type {number}
         */
        var LOG_DELETE_BATCH_SIZE = 500;

        /**
         * Default number of days after which API logs are eligible for cleanup.
         * @type {number}
         */
        var DEFAULT_LOG_RETENTION_DAYS = 90;

        // -------------------------------------------------------------------
        // Helper functions
        // -------------------------------------------------------------------

        /**
         * Checks whether at least one record of the given custom record type exists.
         *
         * @param {string} recordType - Internal ID of the custom record type.
         * @returns {boolean} true if one or more records exist.
         */
        function recordExists(recordType) {
            var results = search.create({
                type: recordType,
                filters: [],
                columns: ['internalid']
            }).run().getRange({ start: 0, end: 1 });

            return results.length > 0;
        }

        /**
         * Checks whether a validation config record already exists for a given
         * entity type.
         *
         * @param {string} entityType - 'vendor' or 'customer'.
         * @returns {boolean} true if a matching record exists.
         */
        function valCfgExistsForType(entityType) {
            var results = search.create({
                type: RECORD_TYPE.VAL_CFG,
                filters: [
                    ['custrecord_qbn_vc_record_type', 'is', entityType]
                ],
                columns: ['internalid']
            }).run().getRange({ start: 0, end: 1 });

            return results.length > 0;
        }

        /**
         * Creates a custom record from a field-value map.
         *
         * @param {string} recordType - Internal ID of the custom record type.
         * @param {string} recordName - Value for the 'name' field.
         * @param {Object} fieldValues - Map of field ID to value.
         * @returns {number} Internal ID of the created record.
         */
        function createCustomRecord(recordType, recordName, fieldValues) {
            var rec = record.create({ type: recordType, isDynamic: false });

            if (recordName) {
                rec.setValue({ fieldId: 'name', value: recordName });
            }

            var fieldIds = Object.keys(fieldValues);
            for (var i = 0; i < fieldIds.length; i++) {
                var fieldId = fieldIds[i];
                rec.setValue({ fieldId: fieldId, value: fieldValues[fieldId] });
            }

            return rec.save({ enableSourcing: false, ignoreMandatoryFields: false });
        }

        /**
         * Creates the default QubitOn configuration record if none exists.
         *
         * @returns {number|null} Internal ID of the created record, or null if
         *   a record already existed.
         */
        function ensureConfigRecord() {
            if (recordExists(RECORD_TYPE.CONFIG)) {
                log.audit({
                    title: 'QubitOn Install',
                    details: 'Configuration record already exists — skipping creation.'
                });
                return null;
            }

            var configId = createCustomRecord(
                RECORD_TYPE.CONFIG,
                'QubitOn Default Configuration',
                DEFAULT_CONFIG
            );

            log.audit({
                title: 'QubitOn Install',
                details: 'Created default configuration record (ID: ' + configId + ').'
            });

            return configId;
        }

        /**
         * Creates a sample validation configuration record if one does not
         * already exist for the given entity type.
         *
         * @param {Object} valCfg - Field-value map that includes an entity type
         *   field and a 'name' property.
         * @returns {number|null} Internal ID of the created record, or null if
         *   a record already existed.
         */
        function ensureValCfgRecord(valCfg) {
            var entityType = valCfg.custrecord_qbn_vc_record_type;

            if (valCfgExistsForType(entityType)) {
                log.audit({
                    title: 'QubitOn Install',
                    details: 'Validation config for "' + entityType + '" already exists — skipping.'
                });
                return null;
            }

            var name = valCfg.name;
            var fields = {};
            var keys = Object.keys(valCfg);
            for (var i = 0; i < keys.length; i++) {
                if (keys[i] !== 'name') {
                    fields[keys[i]] = valCfg[keys[i]];
                }
            }

            var recId = createCustomRecord(RECORD_TYPE.VAL_CFG, name, fields);

            log.audit({
                title: 'QubitOn Install',
                details: 'Created "' + entityType + '" validation config (ID: ' + recId + ').'
            });

            return recId;
        }

        /**
         * Deletes API log records older than the specified number of days.
         * Processes in batches to stay within governance limits.
         *
         * @param {number} retentionDays - Records older than this are deleted.
         * @returns {number} Total number of records deleted.
         */
        function cleanupOldApiLogs(retentionDays) {
            var cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

            var cutoffStr = formatDate(cutoffDate);
            var totalDeleted = 0;
            var hasMore = true;

            while (hasMore) {
                var remainingUsage = runtime.getCurrentScript().getRemainingUsage();
                if (remainingUsage < 200) {
                    log.audit({
                        title: 'QubitOn Cleanup',
                        details: 'Stopping log cleanup — governance remaining: ' + remainingUsage +
                            '. Deleted so far: ' + totalDeleted
                    });
                    break;
                }

                var logSearch = search.create({
                    type: RECORD_TYPE.API_LOG,
                    filters: [
                        ['created', 'before', cutoffStr]
                    ],
                    columns: ['internalid']
                });

                var results = logSearch.run().getRange({
                    start: 0,
                    end: LOG_DELETE_BATCH_SIZE
                });

                if (results.length === 0) {
                    hasMore = false;
                    break;
                }

                for (var i = 0; i < results.length; i++) {
                    try {
                        record.delete({
                            type: RECORD_TYPE.API_LOG,
                            id: results[i].id
                        });
                        totalDeleted++;
                    } catch (e) {
                        log.error({
                            title: 'QubitOn Cleanup',
                            details: 'Failed to delete API log ' + results[i].id + ': ' + e.message
                        });
                    }
                }

                if (results.length < LOG_DELETE_BATCH_SIZE) {
                    hasMore = false;
                }
            }

            return totalDeleted;
        }

        /**
         * Formats a Date object as MM/DD/YYYY for use in SuiteScript search
         * filters.
         *
         * @param {Date} d - The date to format.
         * @returns {string} Formatted date string.
         */
        function formatDate(d) {
            var month = d.getMonth() + 1;
            var day = d.getDate();
            var year = d.getFullYear();
            return (month < 10 ? '0' : '') + month + '/' +
                   (day < 10 ? '0' : '') + day + '/' + year;
        }

        // -------------------------------------------------------------------
        // Entry points
        // -------------------------------------------------------------------

        /**
         * Runs after the SuiteApp bundle is installed for the first time.
         * Creates default configuration and sample validation config records.
         *
         * @param {Object} params - Bundle installation parameters provided by
         *   the SuiteScript framework.
         */
        function afterInstall(params) {
            log.audit({
                title: 'QubitOn Install',
                details: 'Starting first-time installation setup.'
            });

            try {
                ensureConfigRecord();
            } catch (e) {
                log.error({
                    title: 'QubitOn Install',
                    details: 'Failed to create config record: ' + e.message
                });
            }

            try {
                ensureValCfgRecord(VENDOR_VAL_CFG);
            } catch (e) {
                log.error({
                    title: 'QubitOn Install',
                    details: 'Failed to create vendor validation config: ' + e.message
                });
            }

            try {
                ensureValCfgRecord(CUSTOMER_VAL_CFG);
            } catch (e) {
                log.error({
                    title: 'QubitOn Install',
                    details: 'Failed to create customer validation config: ' + e.message
                });
            }

            log.audit({
                title: 'QubitOn Install',
                details: 'First-time installation setup complete.'
            });
        }

        /**
         * Runs after the SuiteApp bundle is updated to a new version.
         * Ensures the configuration record exists (handles upgrade from a
         * version that did not create one). Does NOT overwrite existing values
         * so user customisations are preserved.
         *
         * @param {Object} params - Bundle installation parameters provided by
         *   the SuiteScript framework.
         * @param {string} params.fromVersion - The version being upgraded from.
         * @param {string} params.toVersion - The version being upgraded to.
         */
        function afterUpdate(params) {
            var fromVersion = params.fromVersion || 'unknown';
            var toVersion = params.toVersion || 'unknown';

            log.audit({
                title: 'QubitOn Update',
                details: 'Updating from v' + fromVersion + ' to v' + toVersion + '.'
            });

            try {
                ensureConfigRecord();
            } catch (e) {
                log.error({
                    title: 'QubitOn Update',
                    details: 'Failed to ensure config record during update: ' + e.message
                });
            }

            try {
                ensureValCfgRecord(VENDOR_VAL_CFG);
            } catch (e) {
                log.error({
                    title: 'QubitOn Update',
                    details: 'Failed to ensure vendor validation config during update: ' + e.message
                });
            }

            try {
                ensureValCfgRecord(CUSTOMER_VAL_CFG);
            } catch (e) {
                log.error({
                    title: 'QubitOn Update',
                    details: 'Failed to ensure customer validation config during update: ' + e.message
                });
            }

            log.audit({
                title: 'QubitOn Update',
                details: 'Update to v' + toVersion + ' complete.'
            });
        }

        /**
         * Runs before the SuiteApp bundle is uninstalled.
         * Cleans up API log records older than the retention period.
         * Deliberately does NOT delete configuration or validation config
         * records so that data is preserved if the user reinstalls.
         *
         * @param {Object} params - Bundle installation parameters provided by
         *   the SuiteScript framework.
         */
        function beforeUninstall(params) {
            log.audit({
                title: 'QubitOn Uninstall',
                details: 'Starting pre-uninstall cleanup.'
            });

            try {
                var deleted = cleanupOldApiLogs(DEFAULT_LOG_RETENTION_DAYS);
                log.audit({
                    title: 'QubitOn Uninstall',
                    details: 'Cleaned up ' + deleted + ' API log records older than ' +
                        DEFAULT_LOG_RETENTION_DAYS + ' days.'
                });
            } catch (e) {
                log.error({
                    title: 'QubitOn Uninstall',
                    details: 'Error during API log cleanup: ' + e.message
                });
            }

            log.audit({
                title: 'QubitOn Uninstall',
                details: 'Pre-uninstall cleanup complete. Configuration and validation ' +
                    'config records have been preserved.'
            });
        }

        return {
            afterInstall: afterInstall,
            afterUpdate: afterUpdate,
            beforeUninstall: beforeUninstall
        };
    });
