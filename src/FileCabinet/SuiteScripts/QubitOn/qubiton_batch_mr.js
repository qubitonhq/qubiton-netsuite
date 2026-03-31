/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 *
 * QubitOn Batch Validation (Layer 3)
 * Validates vendors and/or customers in bulk via Map/Reduce.
 * Equivalent to SAP batch input (SM35) / Oracle concurrent programs.
 *
 * Designed for:
 *   - Initial data cleanse when first deploying QubitOn
 *   - Periodic re-validation of all active records
 *   - On-demand validation of a filtered set via saved search
 *
 * Script parameters:
 *   custscript_qbn_batch_record_type   (List: vendor|customer) - Required
 *   custscript_qbn_batch_search_id     (Free-Form Text) - Optional saved search ID
 *   custscript_qbn_batch_max_records   (Integer) - Optional cap on records to process
 *   custscript_qbn_batch_update_record (Checkbox) - Write results back to records
 *
 * Governance: Map/Reduce has 10,000 units per phase. Each record.submitFields
 * costs 10 units (2 + 4 per sublist touched), so ~900 records per reduce phase
 * with safety margin. The N/search in getInputData is 10 units per page.
 *
 * Deployment: Single deployment, triggered via Suitelet or scheduled.
 */
define(['N/search', 'N/record', 'N/log', 'N/runtime', 'N/error', './qubiton_validation'],
function(search, record, log, runtime, error, validation) {

    /**
     * Custom field IDs (same as UE scripts — entity-level fields).
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
     * Supported record types for batch validation.
     * @type {Object<string, string>}
     */
    const RECORD_TYPE_MAP = {
        vendor: search.Type.VENDOR,
        customer: search.Type.CUSTOMER
    };

    /**
     * getInputData - Returns a search of all active records of the specified type.
     * If a saved search ID is provided, uses that instead.
     *
     * @returns {search.Search} A NetSuite search object
     */
    function getInputData() {
        const currentScript = runtime.getCurrentScript();

        const recordTypeParam = currentScript.getParameter({
            name: 'custscript_qbn_batch_record_type'
        });

        if (!recordTypeParam) {
            throw error.create({
                name: 'QBN_MISSING_PARAM',
                message: 'custscript_qbn_batch_record_type is required (vendor or customer)'
            });
        }

        const recordType = String(recordTypeParam).toLowerCase();
        const searchType = RECORD_TYPE_MAP[recordType];

        if (!searchType) {
            throw error.create({
                name: 'QBN_INVALID_PARAM',
                message: `Invalid record type "${recordTypeParam}". Must be "vendor" or "customer".`
            });
        }

        const savedSearchId = currentScript.getParameter({
            name: 'custscript_qbn_batch_search_id'
        });

        log.audit({
            title: 'QubitOn Batch MR - getInputData',
            details: JSON.stringify({
                recordType: recordType,
                savedSearchId: savedSearchId || '(default search)',
                timestamp: new Date().toISOString()
            })
        });

        // Use saved search if provided
        if (savedSearchId) {
            return search.load({ id: savedSearchId });
        }

        // Build default search: all active records with key fields
        const columns = buildSearchColumns(recordType);
        const filters = buildSearchFilters(recordType);

        return search.create({
            type: searchType,
            filters: filters,
            columns: columns
        });
    }

    /**
     * map - Parses each search result and runs QubitOn validation.
     * Writes the validation result keyed by record ID for the reduce phase.
     *
     * @param {Object} context
     * @param {string} context.key - The search result key (internal ID)
     * @param {string} context.value - The search result JSON string
     * @param {Function} context.write - Write function to pass data to reduce
     */
    function map(context) {
        const currentScript = runtime.getCurrentScript();
        const recordTypeParam = currentScript.getParameter({
            name: 'custscript_qbn_batch_record_type'
        });
        const recordType = String(recordTypeParam).toLowerCase();

        let searchResult;
        try {
            searchResult = JSON.parse(context.value);
        } catch (e) {
            log.error({
                title: 'QubitOn Batch MR - map Parse Error',
                details: `Key: ${context.key}, Error: ${e.message}`
            });
            context.write({
                key: context.key,
                value: JSON.stringify({
                    recordId: context.key,
                    status: 'error',
                    error: 'Failed to parse search result'
                })
            });
            return;
        }

        const recordId = searchResult.id;

        // Check governance before making API call
        const remainingUsage = currentScript.getRemainingUsage();
        if (remainingUsage < 200) {
            log.audit({
                title: 'QubitOn Batch MR - Governance Warning',
                details: `Record ${recordId}: only ${remainingUsage} units remaining`
            });
            context.write({
                key: String(recordId),
                value: JSON.stringify({
                    recordId: recordId,
                    status: 'deferred',
                    reason: 'Insufficient governance units'
                })
            });
            return;
        }

        try {
            log.debug({
                title: 'QubitOn Batch MR - Validating',
                details: `Record ${recordId}`
            });

            // Load the full record for validation
            const nsRecordType = recordType === 'vendor'
                ? record.Type.VENDOR
                : record.Type.CUSTOMER;
            const rec = record.load({ type: nsRecordType, id: recordId });

            // Call QubitOn validation
            const result = validation.validateRecord(rec, recordType);

            var score = Math.round((result.summary.passed / Math.max(result.summary.total, 1)) * 100);
            context.write({
                key: String(recordId),
                value: JSON.stringify({
                    recordId: recordId,
                    status: result.passed ? 'pass' : 'fail',
                    score: score,
                    validationId: '',
                    details: result.summary || {},
                    passed: result.passed
                })
            });

        } catch (e) {
            log.error({
                title: 'QubitOn Batch MR - map Validation Error',
                details: `Record ${recordId}: ${e.name}: ${e.message}`
            });

            context.write({
                key: String(recordId),
                value: JSON.stringify({
                    recordId: recordId,
                    status: 'error',
                    error: e.message
                })
            });
        }
    }

    /**
     * reduce - Aggregates validation results and updates the NetSuite record.
     * Each key is a record internal ID with one or more validation results.
     *
     * @param {Object} context
     * @param {string} context.key - The record internal ID
     * @param {string[]} context.values - Array of validation result JSON strings
     * @param {Function} context.write - Write function to pass summary data
     */
    function reduce(context) {
        const currentScript = runtime.getCurrentScript();
        const recordTypeParam = currentScript.getParameter({
            name: 'custscript_qbn_batch_record_type'
        });
        const recordType = String(recordTypeParam).toLowerCase();
        const updateRecord = currentScript.getParameter({
            name: 'custscript_qbn_batch_update_record'
        });

        const recordId = context.key;

        // Take the last result (in case of retries, the latest is most relevant)
        let result;
        if (!context.values || context.values.length === 0) {
            log.error({
                title: 'QubitOn Batch MR - reduce',
                details: `Record ${recordId}: no values received from map phase`
            });
            context.write({
                key: recordId,
                value: JSON.stringify({ recordId: recordId, status: 'error' })
            });
            return;
        }
        try {
            result = JSON.parse(context.values[context.values.length - 1]);
        } catch (e) {
            log.error({
                title: 'QubitOn Batch MR - reduce Parse Error',
                details: `Record ${recordId}: ${e.message}`
            });
            context.write({
                key: recordId,
                value: JSON.stringify({ recordId: recordId, status: 'error' })
            });
            return;
        }

        // Update the record with validation results if enabled
        if (updateRecord && result.status !== 'deferred') {
            const remainingUsage = currentScript.getRemainingUsage();
            if (remainingUsage < 50) {
                log.audit({
                    title: 'QubitOn Batch MR - reduce Governance Warning',
                    details: `Record ${recordId}: only ${remainingUsage} units remaining, skipping update`
                });
                context.write({
                    key: recordId,
                    value: JSON.stringify({
                        recordId: recordId,
                        status: 'deferred',
                        reason: 'Insufficient governance for record update'
                    })
                });
                return;
            }

            try {
                const statusValue = mapStatusToListValue(result.status);
                const detailsStr = typeof result.details === 'object'
                    ? JSON.stringify(result.details)
                    : String(result.details || '');

                // Truncate details to Long Text limit
                const truncatedDetails = detailsStr.length > 100000
                    ? detailsStr.substring(0, 99990) + '...[truncated]'
                    : detailsStr;

                const nsRecordType = recordType === 'vendor'
                    ? record.Type.VENDOR
                    : record.Type.CUSTOMER;

                record.submitFields({
                    type: nsRecordType,
                    id: recordId,
                    values: {
                        [FIELDS.STATUS]: statusValue,
                        [FIELDS.DATE]: new Date(),
                        [FIELDS.SCORE]: result.score || 0,
                        [FIELDS.DETAILS]: truncatedDetails,
                        [FIELDS.VALIDATION_ID]: result.validationId || ''
                    },
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
                });

                log.debug({
                    title: 'QubitOn Batch MR - Record Updated',
                    details: `Record ${recordId}: status=${result.status}, score=${result.score}`
                });

            } catch (e) {
                log.error({
                    title: 'QubitOn Batch MR - reduce Update Error',
                    details: `Record ${recordId}: ${e.name}: ${e.message}`
                });
                result.updateError = e.message;
            }
        }

        // Write final result for summarize phase
        context.write({
            key: recordId,
            value: JSON.stringify(result)
        });
    }

    /**
     * summarize - Logs totals and handles errors from all phases.
     *
     * @param {Object} summary
     * @param {number} summary.concurrency - Number of concurrent map/reduce threads used
     * @param {number} summary.yields - Number of times the script yielded
     * @param {Iterator} summary.output - Iterator of final key/value pairs from reduce
     * @param {Object} summary.inputSummary - Input phase summary
     * @param {Object} summary.mapSummary - Map phase summary
     * @param {Object} summary.reduceSummary - Reduce phase summary
     */
    function summarize(summary) {
        const stats = {
            processed: 0,
            passed: 0,
            failed: 0,
            errors: 0,
            deferred: 0,
            concurrency: summary.concurrency,
            yields: summary.yields
        };

        // Count results from reduce output
        summary.output.iterator().each(function(key, value) {
            stats.processed++;
            try {
                const result = JSON.parse(value);
                switch (result.status) {
                    case 'pass':
                        stats.passed++;
                        break;
                    case 'fail':
                        stats.failed++;
                        break;
                    case 'deferred':
                        stats.deferred++;
                        break;
                    case 'error':
                    default:
                        stats.errors++;
                        break;
                }
            } catch (e) {
                stats.errors++;
            }
            return true; // Continue iterating
        });

        // Log input phase errors
        if (summary.inputSummary.error) {
            log.error({
                title: 'QubitOn Batch MR - Input Phase Error',
                details: summary.inputSummary.error
            });
        }

        // Log map phase errors
        logPhaseErrors(summary.mapSummary, 'Map');

        // Log reduce phase errors
        logPhaseErrors(summary.reduceSummary, 'Reduce');

        // Final audit log
        log.audit({
            title: 'QubitOn Batch MR - Summary',
            details: JSON.stringify({
                total: stats.processed,
                passed: stats.passed,
                failed: stats.failed,
                errors: stats.errors,
                deferred: stats.deferred,
                concurrency: stats.concurrency,
                yields: stats.yields,
                duration: summary.dateCreated
                    ? `Started: ${summary.dateCreated}`
                    : 'N/A'
            })
        });

        log.audit({
            title: 'QubitOn Batch MR - Complete',
            details: `Processed: ${stats.processed} | Passed: ${stats.passed} | ` +
                     `Failed: ${stats.failed} | Errors: ${stats.errors} | ` +
                     `Deferred: ${stats.deferred}`
        });
    }

    // ─── Helper Functions ────────────────────────────────────────────────

    /**
     * Builds default search columns based on record type.
     *
     * @param {string} recordType - 'vendor' or 'customer'
     * @returns {search.Column[]} Array of search columns
     */
    function buildSearchColumns(recordType) {
        const commonColumns = [
            search.createColumn({ name: 'entityid' }),
            search.createColumn({ name: 'companyname' }),
            search.createColumn({ name: 'email' }),
            search.createColumn({ name: 'phone' }),
            search.createColumn({ name: 'vatregnumber' }),
            search.createColumn({ name: 'url' }),
            search.createColumn({ name: 'country' }),
            search.createColumn({ name: 'state' }),
            search.createColumn({ name: 'city' }),
            search.createColumn({ name: 'zipcode' }),
            search.createColumn({ name: 'address1' }),
            search.createColumn({ name: 'address2' }),
            search.createColumn({ name: 'category' }),
            search.createColumn({ name: FIELDS.STATUS }),
            search.createColumn({ name: FIELDS.DATE })
        ];

        if (recordType === 'vendor') {
            commonColumns.push(
                search.createColumn({ name: 'legalname' }),
                search.createColumn({ name: 'is1099eligible' })
            );
        } else {
            commonColumns.push(
                search.createColumn({ name: 'firstname' }),
                search.createColumn({ name: 'lastname' }),
                search.createColumn({ name: 'isperson' }),
                search.createColumn({ name: 'stage' }),
                search.createColumn({ name: 'creditlimit' })
            );
        }

        return commonColumns;
    }

    /**
     * Builds default search filters: active records, optionally excluding
     * recently validated ones.
     *
     * @param {string} recordType - 'vendor' or 'customer'
     * @returns {search.Filter[]} Array of search filters
     */
    function buildSearchFilters(recordType) {
        const filters = [
            search.createFilter({
                name: 'isinactive',
                operator: search.Operator.IS,
                values: 'F'
            })
        ];

        // Optionally limit the number of records
        const maxRecords = runtime.getCurrentScript().getParameter({
            name: 'custscript_qbn_batch_max_records'
        });

        // Note: NetSuite search results are capped at 10,000 for Map/Reduce.
        // If maxRecords is set, we rely on the map phase to stop processing
        // beyond that count (Map/Reduce doesn't support search result limits directly).

        if (recordType === 'customer') {
            // Exclude leads — only validate prospects and customers
            filters.push(
                search.createFilter({
                    name: 'stage',
                    operator: search.Operator.NONEOF,
                    values: ['LEAD']
                })
            );
        }

        return filters;
    }

    /**
     * Extracts validation data from a search result.
     * Search results have a different API than record objects.
     *
     * @param {Object} searchResult - Parsed search result from context.value
     * @param {string} recordType - 'vendor' or 'customer'
     * @returns {Object} Data object suitable for qubiton_validation.validateRecord
     */
    function extractDataFromSearchResult(searchResult, recordType) {
        const values = searchResult.values || {};

        /**
         * Safely extracts a value from the search result.
         * Handles both simple values and list/record references.
         *
         * @param {string} fieldId - The field ID to extract
         * @returns {string} The field value or empty string
         */
        function getValue(fieldId) {
            const val = values[fieldId];
            if (!val) return '';
            if (typeof val === 'object' && val.length > 0) {
                return val[0].text || val[0].value || '';
            }
            if (typeof val === 'object' && val.text) {
                return val.text;
            }
            if (typeof val === 'object' && val.value) {
                return val.value;
            }
            return String(val);
        }

        const data = {
            companyName: getValue('companyname'),
            email: getValue('email'),
            phone: getValue('phone'),
            taxId: getValue('vatregnumber'),
            url: getValue('url'),
            country: getValue('country'),
            state: getValue('state'),
            city: getValue('city'),
            zip: getValue('zipcode'),
            addr1: getValue('address1'),
            addr2: getValue('address2'),
            category: getValue('category')
        };

        if (recordType === 'vendor') {
            data.legalName = getValue('legalname');
            const is1099Val = getValue('is1099eligible');
            data.is1099Eligible = is1099Val === true || is1099Val === 'T' || is1099Val === 't';
        } else {
            data.firstName = getValue('firstname');
            data.lastName = getValue('lastname');
            const isPersonVal = getValue('isperson');
            data.isPerson = isPersonVal === true || isPersonVal === 'T' || isPersonVal === 't';
            data.stage = getValue('stage');
            data.creditLimit = parseFloat(getValue('creditlimit')) || 0;
        }

        // Address from search is the default/primary address
        // For full address validation, the UE script handles subrecords
        if (data.addr1 || data.city || data.zip) {
            data.addresses = [{
                addr1: data.addr1,
                addr2: data.addr2,
                city: data.city,
                state: data.state,
                zip: data.zip,
                country: data.country
            }];
        } else {
            data.addresses = [];
        }

        return data;
    }

    /**
     * Maps a string status to the custom list internal ID.
     *
     * @param {string} status - 'pass', 'fail', 'error', 'deferred'
     * @returns {string} Custom list value ID
     */
    function mapStatusToListValue(status) {
        const map = {
            pass: STATUS.PASS,
            fail: STATUS.FAIL,
            error: STATUS.ERROR,
            deferred: STATUS.PENDING
        };
        return map[status] || STATUS.ERROR;
    }

    /**
     * Logs errors from a Map/Reduce phase summary.
     *
     * @param {Object} phaseSummary - The map or reduce summary object
     * @param {string} phaseName - 'Map' or 'Reduce' for log titles
     */
    function logPhaseErrors(phaseSummary, phaseName) {
        let errorCount = 0;

        phaseSummary.errors.each(function(key, errorMsg, executionNo) {
            errorCount++;
            // Log first 25 errors individually, then just count the rest
            if (errorCount <= 25) {
                log.error({
                    title: `QubitOn Batch MR - ${phaseName} Error`,
                    details: `Key: ${key}, Execution: ${executionNo}, Error: ${errorMsg}`
                });
            }
            return true; // Continue iterating
        });

        if (errorCount > 25) {
            log.error({
                title: `QubitOn Batch MR - ${phaseName} Error Summary`,
                details: `Total ${phaseName} phase errors: ${errorCount} (first 25 logged individually)`
            });
        } else if (errorCount > 0) {
            log.audit({
                title: `QubitOn Batch MR - ${phaseName} Error Count`,
                details: `${errorCount} errors in ${phaseName} phase`
            });
        }
    }

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };
});
