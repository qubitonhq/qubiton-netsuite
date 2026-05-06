/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * QubitOn API Client for NetSuite (Layer 1)
 *
 * Core HTTP client providing all 42 QubitOn API methods.
 * This is a utility module loaded by Layer 2 (field-mapping) and Layer 3 (transaction scripts).
 *
 * Architecture:
 *   Layer 1 — This module: raw API calls, config, logging
 *   Layer 2 — qubiton_field_mapper.js: NetSuite record <-> API field mapping
 *   Layer 3 — qubiton_suitelet.js / qubiton_ue.js: user-facing scripts
 *
 * Config: customrecord_qubiton_config (single-row custom record)
 * Logging: customrecord_qubiton_api_log (one record per API call)
 *
 * Error modes:
 *   E (Stop)   — throw an error on API failure
 *   W (Warn)   — log a warning and return null
 *   S (Silent) — return null without logging
 *
 * @module qubiton_api_client
 */
define(['N/https', 'N/log', 'N/runtime', 'N/record', 'N/search', 'N/error'],
function (https, log, runtime, record, search, error) {

    // =========================================================================
    // Constants
    // =========================================================================

    const MODULE = 'QubitOn.ApiClient';

    /**
     * Error mode constants.
     * E = throw on failure, W = log warning + return null, S = return null silently.
     */
    const ERROR_MODE = Object.freeze({
        STOP: 'E',
        WARN: 'W',
        SILENT: 'S'
    });

    // =========================================================================
    // Config
    // =========================================================================

    /** @type {Object|null} Cached config — loaded once per script execution. */
    let _configCache = null;

    /**
     * Load configuration from the customrecord_qubiton_config custom record.
     * Expects exactly one record to exist. Throws if none found.
     *
     * @returns {Object} config object with apiKey, baseUrl, timeout, errorMode, logEnabled
     */
    function loadConfig() {
        const results = [];

        search.create({
            type: 'customrecord_qubiton_config',
            filters: [],
            columns: [
                'custrecord_qbn_api_key',
                'custrecord_qbn_base_url',
                'custrecord_qbn_timeout',
                'custrecord_qbn_error_mode',
                'custrecord_qbn_log_enabled'
            ]
        }).run().each(function (result) {
            results.push(result);
            return false; // only need the first record
        });

        if (results.length === 0) {
            throw error.create({
                name: 'QUBITON_CONFIG_MISSING',
                message: 'No QubitOn configuration record found. Create a customrecord_qubiton_config record.',
                notifyOff: false
            });
        }

        const r = results[0];
        const baseUrl = (r.getValue('custrecord_qbn_base_url') || '').replace(/\/+$/, '');

        if (!baseUrl) {
            throw error.create({
                name: 'QUBITON_CONFIG_INVALID',
                message: 'custrecord_qbn_base_url is empty in the QubitOn configuration record.',
                notifyOff: false
            });
        }

        const apiKey = r.getValue('custrecord_qbn_api_key') || '';
        if (!apiKey) {
            throw error.create({
                name: 'QUBITON_CONFIG_INVALID',
                message: 'custrecord_qbn_api_key is empty in the QubitOn configuration record.',
                notifyOff: false
            });
        }

        return {
            apiKey: apiKey,
            baseUrl: baseUrl,
            timeout: parseInt(r.getValue('custrecord_qbn_timeout'), 10) || 30,
            errorMode: r.getValue('custrecord_qbn_error_mode') || r.getText('custrecord_qbn_error_mode') || ERROR_MODE.STOP,
            logEnabled: r.getValue('custrecord_qbn_log_enabled') === true ||
                        r.getValue('custrecord_qbn_log_enabled') === 'T'
        };
    }

    /**
     * Get config (cached). Loads from custom record on first call.
     *
     * @returns {Object} config
     */
    function getConfig() {
        if (!_configCache) {
            _configCache = loadConfig();
        }
        return _configCache;
    }

    /**
     * Clear the config cache. Useful when config changes mid-execution.
     */
    function clearConfigCache() {
        _configCache = null;
    }

    // =========================================================================
    // Logging
    // =========================================================================

    /**
     * Create an API log entry in customrecord_qubiton_api_log.
     * Only writes if config.logEnabled is true.
     *
     * @param {string} method     - HTTP method (GET/POST)
     * @param {string} endpoint   - API endpoint path
     * @param {number} statusCode - HTTP response status code (0 on network error)
     * @param {number} durationMs - Round-trip time in milliseconds
     * @param {string} [errorMsg] - Error message if the call failed
     */
    function logApiCall(method, endpoint, statusCode, durationMs, errorMsg, sourceType, sourceId) {
        try {
            const cfg = getConfig();
            if (!cfg.logEnabled) {
                return;
            }

            const logRec = record.create({ type: 'customrecord_qubiton_api_log' });
            logRec.setValue({ fieldId: 'custrecord_qbn_log_method', value: method });
            logRec.setValue({ fieldId: 'custrecord_qbn_log_endpoint', value: endpoint });
            logRec.setValue({ fieldId: 'custrecord_qbn_log_status', value: statusCode });
            logRec.setValue({ fieldId: 'custrecord_qbn_log_duration', value: durationMs });
            logRec.setValue({
                fieldId: 'custrecord_qbn_log_user',
                value: runtime.getCurrentUser().id
            });
            logRec.setValue({
                fieldId: 'custrecord_qbn_log_date',
                value: new Date()
            });
            if (sourceType) {
                logRec.setValue({ fieldId: 'custrecord_qbn_log_src_type', value: String(sourceType) });
            }
            if (sourceId) {
                logRec.setValue({ fieldId: 'custrecord_qbn_log_src_id', value: String(sourceId) });
            }

            if (errorMsg) {
                // Truncate to 4000 chars (NetSuite text field limit)
                logRec.setValue({
                    fieldId: 'custrecord_qbn_log_error',
                    value: String(errorMsg).substring(0, 4000)
                });
            }

            logRec.save({ ignoreMandatoryFields: true });
        } catch (e) {
            // Never let logging failures break the API call flow
            log.error({ title: MODULE + '.logApiCall', details: e.message || e });
        }
    }

    // =========================================================================
    // Payload Builder
    // =========================================================================

    /**
     * Build a clean payload object, omitting null, undefined, and empty-string values.
     * Mirrors the SAP build_json() and Oracle build_json() helpers.
     *
     * @param {Object} fields - Key-value pairs for the request body
     * @returns {Object} cleaned payload
     */
    function buildPayload(fields) {
        const payload = {};
        const keys = Object.keys(fields);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const val = fields[key];
            if (val !== null && val !== undefined && val !== '') {
                payload[key] = val;
            }
        }
        return payload;
    }

    // =========================================================================
    // Validation Helpers
    // =========================================================================

    /**
     * Validate that all required fields are present and non-empty.
     *
     * @param {string}   methodName - Calling method name (for error messages)
     * @param {Object}   params     - Parameters object to validate
     * @param {string[]} required   - Array of required field names
     * @throws {error.SuiteScriptError} if any required field is missing
     */
    function validateRequired(methodName, params, required) {
        if (!params || typeof params !== 'object') {
            throw error.create({
                name: 'QUBITON_MISSING_PARAMS',
                message: methodName + ': params object is required',
                notifyOff: true
            });
        }

        for (let i = 0; i < required.length; i++) {
            const field = required[i];
            const val = params[field];
            if (val === null || val === undefined || val === '') {
                throw error.create({
                    name: 'QUBITON_MISSING_FIELD',
                    message: methodName + ': required field "' + field + '" is missing or empty',
                    notifyOff: true
                });
            }
        }
    }

    // =========================================================================
    // HTTP Core
    // =========================================================================

    /**
     * Execute an HTTP request against the QubitOn API.
     *
     * @param {string}      httpMethod - 'GET' or 'POST'
     * @param {string}      endpoint   - API path (e.g. '/api/address/validate')
     * @param {Object|null} payload    - Request body for POST (null for GET)
     * @returns {Object|null} Parsed JSON response, or null on handled error
     */
    function callApi(httpMethod, endpoint, payload) {
        // Governance safety net — don't crash the script on an HTTP call
        const remaining = runtime.getCurrentScript().getRemainingUsage();
        if (remaining < 20) {
            log.audit({ title: MODULE, details: 'Insufficient governance for API call to ' + endpoint + ' (remaining: ' + remaining + ')' });
            return handleError(getConfig().errorMode, 'callApi', 'Insufficient governance units for API call');
        }

        const cfg = getConfig();
        const url = cfg.baseUrl + endpoint;
        const startTime = Date.now();
        let statusCode = 0;
        let errorMsg = null;

        try {
            const headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'apikey': cfg.apiKey
            };

            let response;

            if (httpMethod === 'GET') {
                response = https.get({
                    url: url,
                    headers: headers
                });
            } else {
                response = https.post({
                    url: url,
                    headers: headers,
                    body: JSON.stringify(payload || {})
                });
            }

            statusCode = response.code;
            const durationMs = Date.now() - startTime;

            if (statusCode >= 200 && statusCode < 300) {
                logApiCall(httpMethod, endpoint, statusCode, durationMs, null);
                const body = response.body;
                if (!body) {
                    return null;
                }
                try {
                    return JSON.parse(body);
                } catch (parseErr) {
                    // Response is not JSON — return raw body wrapped
                    return { _raw: body };
                }
            }

            // Non-success status
            errorMsg = 'HTTP ' + statusCode + ': ' + (response.body || '').substring(0, 1000);
            logApiCall(httpMethod, endpoint, statusCode, durationMs, errorMsg);

            return handleError(cfg.errorMode, 'callApi', errorMsg);

        } catch (e) {
            const durationMs = Date.now() - startTime;
            errorMsg = e.message || String(e);
            logApiCall(httpMethod, endpoint, statusCode, durationMs, errorMsg);

            return handleError(cfg.errorMode, 'callApi', errorMsg);
        }
    }

    /**
     * Handle an API error according to the configured error mode.
     *
     * @param {string} mode       - Error mode: E, W, or S
     * @param {string} methodName - Calling method name
     * @param {string} message    - Error message
     * @returns {null} Always returns null for W and S modes
     * @throws {error.SuiteScriptError} In E (stop) mode
     */
    function handleError(mode, methodName, message) {
        switch (mode) {
            case ERROR_MODE.STOP:
                throw error.create({
                    name: 'QUBITON_API_ERROR',
                    message: methodName + ': ' + message,
                    notifyOff: false
                });

            case ERROR_MODE.WARN:
                log.audit({
                    title: MODULE + '.' + methodName,
                    details: message
                });
                return null;

            case ERROR_MODE.SILENT:
            default:
                return null;
        }
    }

    // =========================================================================
    // API Methods — Validation (1-20)
    // =========================================================================

    /**
     * 1. Validate a postal address.
     * POST /api/address/validate
     *
     * @param {Object} params
     * @param {string} params.addressLine1 - Street address line 1 (required)
     * @param {string} [params.addressLine2] - Street address line 2
     * @param {string} params.city - City (required)
     * @param {string} [params.state] - State or province
     * @param {string} [params.postalCode] - Postal / ZIP code
     * @param {string} params.country - Country code (required)
     * @returns {Object|null} Validation result
     */
    function validateAddress(params) {
        validateRequired('validateAddress', params, ['addressLine1', 'city', 'country']);
        const payload = buildPayload({
            addressLine1: params.addressLine1,
            addressLine2: params.addressLine2,
            city: params.city,
            state: params.state,
            postalCode: params.postalCode,
            country: params.country
        });
        return callApi('POST', '/api/address/validate', payload);
    }

    /**
     * 2. Validate a tax identification number.
     * POST /api/tax/validate
     *
     * @param {Object} params
     * @param {string} params.identityNumber - Tax ID number (required)
     * @param {string} [params.identityNumberType] - Type of tax ID
     * @param {string} params.country - Country code (required)
     * @param {string} [params.entityName] - Entity / company name
     * @param {string} [params.businessEntityType] - Business entity type
     * @returns {Object|null} Validation result
     */
    function validateTax(params) {
        validateRequired('validateTax', params, ['identityNumber', 'country']);
        const payload = buildPayload({
            identityNumber: params.identityNumber,
            identityNumberType: params.identityNumberType,
            country: params.country,
            entityName: params.entityName,
            businessEntityType: params.businessEntityType
        });
        return callApi('POST', '/api/tax/validate', payload);
    }

    /**
     * 3. Validate bank account details.
     * POST /api/bank/validate
     *
     * @param {Object} params
     * @param {string} [params.bankNumberType] - Bank number type
     * @param {string} [params.bankCode] - Bank code
     * @param {string} [params.businessEntityType] - Business entity type
     * @param {string} [params.bankAccountHolder] - Account holder name
     * @param {string} params.accountNumber - Account number (required)
     * @param {string} [params.routingNumber] - Routing / sort code
     * @param {string} [params.iban] - IBAN
     * @param {string} [params.swiftCode] - SWIFT / BIC code
     * @param {string} params.country - Country code (required)
     * @returns {Object|null} Validation result
     */
    function validateBank(params) {
        validateRequired('validateBank', params, ['country']);
        if (!params.accountNumber && !params.iban) {
            throw error.create({
                name: 'QUBITON_MISSING_FIELD',
                message: 'validateBank: either "accountNumber" or "iban" is required',
                notifyOff: true
            });
        }
        const payload = buildPayload({
            bankNumberType: params.bankNumberType,
            bankCode: params.bankCode,
            businessEntityType: params.businessEntityType,
            bankAccountHolder: params.bankAccountHolder,
            accountNumber: params.accountNumber,
            routingNumber: params.routingNumber,
            iban: params.iban,
            swiftCode: params.swiftCode,
            country: params.country
        });
        return callApi('POST', '/api/bank/validate', payload);
    }

    /**
     * 4. Validate bank account details (Pro — enhanced validation).
     * POST /api/bank/validate/pro
     *
     * @param {Object} params - Same fields as validateBank
     * @returns {Object|null} Validation result
     */
    function validateBankPro(params) {
        validateRequired('validateBankPro', params, ['country']);
        if (!params.accountNumber && !params.iban) {
            throw error.create({
                name: 'QUBITON_MISSING_FIELD',
                message: 'validateBankPro: either "accountNumber" or "iban" is required',
                notifyOff: true
            });
        }
        const payload = buildPayload({
            bankNumberType: params.bankNumberType,
            bankCode: params.bankCode,
            businessEntityType: params.businessEntityType,
            bankAccountHolder: params.bankAccountHolder,
            accountNumber: params.accountNumber,
            routingNumber: params.routingNumber,
            iban: params.iban,
            swiftCode: params.swiftCode,
            country: params.country
        });
        return callApi('POST', '/api/bank/validate/pro', payload);
    }

    /**
     * 5. Validate a phone number.
     * POST /api/phone/validate
     *
     * @param {Object} params
     * @param {string} params.phoneNumber - Phone number (required)
     * @param {string} params.country - Country code (required)
     * @param {string} [params.phoneExtension] - Extension
     * @returns {Object|null} Validation result
     */
    function validatePhone(params) {
        validateRequired('validatePhone', params, ['phoneNumber', 'country']);
        const payload = buildPayload({
            phoneNumber: params.phoneNumber,
            country: params.country,
            phoneExtension: params.phoneExtension
        });
        return callApi('POST', '/api/phone/validate', payload);
    }

    /**
     * 6. Validate an email address.
     * POST /api/email/validate
     *
     * @param {Object} params
     * @param {string} params.emailAddress - Email address (required)
     * @returns {Object|null} Validation result
     */
    function validateEmail(params) {
        validateRequired('validateEmail', params, ['emailAddress']);
        const payload = buildPayload({
            emailAddress: params.emailAddress
        });
        return callApi('POST', '/api/email/validate', payload);
    }

    /**
     * 7. Validate an Indian identity number (PAN, Aadhaar, etc.).
     * POST /api/inidentity/validate
     *
     * @param {Object} params
     * @param {string} params.identityNumber - Identity number (required)
     * @param {string} params.identityNumberType - Type of identity (required)
     * @param {string} [params.entityName] - Entity name
     * @returns {Object|null} Validation result
     */
    function validateInIdentity(params) {
        validateRequired('validateInIdentity', params, ['identityNumber', 'identityNumberType']);
        const payload = buildPayload({
            identityNumber: params.identityNumber,
            identityNumberType: params.identityNumberType,
            entityName: params.entityName,
            dob: params.dob
        });
        return callApi('POST', '/api/inidentity/validate', payload);
    }

    /**
     * 8. Validate a tax ID format (structure check, no live verification).
     * POST /api/tax/format-validate
     *
     * @param {Object} params
     * @param {string} params.identityNumber - Tax ID (required)
     * @param {string} params.identityNumberType - Type of tax ID (required)
     * @param {string} params.countryIso2 - ISO 3166-1 alpha-2 country code (required)
     * @returns {Object|null} Validation result
     */
    function validateTaxFormat(params) {
        validateRequired('validateTaxFormat', params, ['identityNumber', 'identityNumberType', 'countryIso2']);
        const payload = buildPayload({
            identityNumber: params.identityNumber,
            identityNumberType: params.identityNumberType,
            countryIso2: params.countryIso2
        });
        return callApi('POST', '/api/tax/format-validate', payload);
    }

    /**
     * 9. Get all supported tax ID format countries.
     * GET /api/tax/format-validate/countries
     *
     * @returns {Object|null} Supported format countries list
     */
    function getSupportedTaxFormats() {
        return callApi('GET', '/api/tax/format-validate/countries', null);
    }

    /**
     * 11. Validate a business certification.
     * POST /api/certification/validate
     *
     * @param {Object} params
     * @param {string} params.companyName - Company name (required)
     * @param {string} params.country - Country code (required)
     * @param {string} params.certificationNumber - Certification number (required)
     * @param {string} [params.certificationType] - Certification type
     * @param {string} [params.certificationGroup] - Certification group
     * @param {string} [params.identityType] - Identity type
     * @returns {Object|null} Validation result
     */
    function validateCertification(params) {
        validateRequired('validateCertification', params, ['companyName', 'country', 'certificationNumber']);
        const payload = buildPayload({
            companyName: params.companyName,
            country: params.country,
            certificationNumber: params.certificationNumber,
            certificationType: params.certificationType,
            certificationGroup: params.certificationGroup,
            identityType: params.identityType
        });
        return callApi('POST', '/api/certification/validate', payload);
    }

    /**
     * 12. Screen for disqualified directors.
     * POST /api/disqualifieddirectors/validate
     *
     * @param {Object} params
     * @param {string} params.firstName - First name (required)
     * @param {string} params.lastName - Last name (required)
     * @param {string} params.country - Country code (required)
     * @param {string} [params.middleName] - Middle name
     * @returns {Object|null} Screening result
     */
    function validateDisqualifiedDirectors(params) {
        validateRequired('validateDisqualifiedDirectors', params, ['firstName', 'lastName', 'country']);
        const payload = buildPayload({
            firstName: params.firstName,
            middleName: params.middleName,
            lastName: params.lastName,
            country: params.country
        });
        return callApi('POST', '/api/disqualifieddirectors/validate', payload);
    }

    /**
     * 13. Validate EPA criminal prosecution records.
     * POST /api/criminalprosecution/validate
     *
     * @param {Object} params
     * @param {string} params.name - Entity or person name (required)
     * @param {string} [params.state] - US state
     * @param {string} [params.fiscalYear] - Fiscal year
     * @returns {Object|null} Prosecution records
     */
    function validateEpaProsecution(params) {
        validateRequired('validateEpaProsecution', params, ['name']);
        const payload = buildPayload({
            name: params.name,
            state: params.state,
            fiscalYear: params.fiscalYear
        });
        return callApi('POST', '/api/criminalprosecution/validate', payload);
    }

    /**
     * 14. Validate healthcare provider exclusion status.
     * POST /api/providerexclusion/validate
     *
     * @param {Object} params
     * @param {string} [params.healthCareType] - Healthcare type (HCO or HCP)
     * @param {string} [params.entityName] - Entity name
     * @param {string} [params.lastName] - Last name
     * @param {string} [params.firstName] - First name
     * @param {string} [params.address] - Address
     * @param {string} [params.city] - City
     * @param {string} [params.state] - US state (2 chars)
     * @param {string} [params.zipCode] - ZIP code (5 digits)
     * @returns {Object|null} Exclusion result
     */
    function validateProviderExclusion(params) {
        params = params || {};
        const payload = buildPayload({
            healthCareType: params.healthCareType,
            entityName: params.entityName,
            lastName: params.lastName,
            firstName: params.firstName,
            address: params.address,
            city: params.city,
            state: params.state,
            zipCode: params.zipCode
        });
        return callApi('POST', '/api/providerexclusion/validate', payload);
    }

    /**
     * 15. Validate a National Provider Identifier (NPI).
     * POST /api/nationalprovideridentifier/validate
     *
     * @param {Object} params
     * @param {string} params.npi - NPI number (required)
     * @param {string} [params.organizationName] - Organization name
     * @param {string} [params.lastName] - Provider last name
     * @param {string} [params.firstName] - Provider first name
     * @param {string} [params.middleName] - Provider middle name
     * @returns {Object|null} NPI validation result
     */
    function validateNpi(params) {
        validateRequired('validateNpi', params, ['npi']);
        const payload = buildPayload({
            npi: params.npi,
            organizationName: params.organizationName,
            lastName: params.lastName,
            firstName: params.firstName,
            middleName: params.middleName
        });
        return callApi('POST', '/api/nationalprovideridentifier/validate', payload);
    }

    /**
     * 16. Validate via MEDPASS (Medicare/Medicaid provider screening).
     * POST /api/Medpass/validate
     *
     * @param {Object} params
     * @param {string} params.id - Identifier (required)
     * @param {string} params.businessEntityType - Business entity type (required)
     * @param {string} [params.companyName] - Company name
     * @param {string} [params.country] - Country code
     * @returns {Object|null} MEDPASS result
     */
    function validateMedpass(params) {
        validateRequired('validateMedpass', params, ['id', 'businessEntityType']);
        const payload = buildPayload({
            id: params.id,
            businessEntityType: params.businessEntityType,
            companyName: params.companyName,
            country: params.country
        });
        return callApi('POST', '/api/Medpass/validate', payload);
    }

    /**
     * 17. Retrieve ESG (Environmental, Social, Governance) scores.
     * POST /api/esg/Scores
     *
     * Note: country and domain are bound on the server as [FromQuery]
     * parameters on ESGController, not body — the SDK serialises them
     * into the URL query string. Sending them in the body would silently
     * no-op.
     *
     * @param {Object} params
     * @param {string} params.companyName - Company name (required, body)
     * @param {number} [params.esgId] - ESG identifier (integer, body)
     * @param {string} [params.country] - ISO country (query string)
     * @param {string} [params.domain] - Company domain (query string)
     * @returns {Object|null} ESG scores
     */
    function validateEsgScore(params) {
        validateRequired('validateEsgScore', params, ['companyName']);
        const payload = buildPayload({
            companyName: params.companyName,
            esgId: params.esgId
        });

        const qs = [];
        if (params.country) qs.push('country=' + encodeURIComponent(params.country));
        if (params.domain)  qs.push('domain='  + encodeURIComponent(params.domain));
        const path = qs.length ? '/api/esg/Scores?' + qs.join('&') : '/api/esg/Scores';

        return callApi('POST', path, payload);
    }

    /**
     * 18. Validate IP address quality / reputation.
     * POST /api/ipquality/validate
     *
     * @param {Object} params
     * @param {string} params.ipAddress - IP address (required)
     * @returns {Object|null} IP quality result
     */
    function validateIpQuality(params) {
        validateRequired('validateIpQuality', params, ['ipAddress']);
        const payload = buildPayload({
            ipAddress: params.ipAddress
        });
        return callApi('POST', '/api/ipquality/validate', payload);
    }

    /**
     * 19. Validate a PEPPOL participant identifier.
     * POST /api/peppol/validate
     *
     * @param {Object} params
     * @param {string} params.participantId - PEPPOL participant ID (required)
     * @param {boolean} [params.directoryLookup] - Whether to query the PEPPOL directory
     * @returns {Object|null} PEPPOL validation result
     */
    function validatePeppolId(params) {
        validateRequired('validatePeppolId', params, ['participantId']);
        const payload = buildPayload({
            participantId: params.participantId,
            directoryLookup: params.directoryLookup
        });
        return callApi('POST', '/api/peppol/validate', payload);
    }

    /**
     * 20. Get available PEPPOL identifier schemes.
     * GET /api/peppol/schemes
     *
     * @returns {Object|null} Schemes list
     */
    function getPeppolSchemes() {
        return callApi('GET', '/api/peppol/schemes', null);
    }

    // =========================================================================
    // API Methods — Enrichment / Lookup (21-29)
    // =========================================================================

    /**
     * 21. Look up business registration details.
     * POST /api/businessregistration/lookup
     *
     * @param {Object} params
     * @param {string} params.entityName - Entity name (required)
     * @param {string} params.country - Country code (required)
     * @param {string} [params.state] - State or province
     * @param {string} [params.city] - City
     * @returns {Object|null} Business registration data
     */
    function lookupBusinessRegistration(params) {
        validateRequired('lookupBusinessRegistration', params, ['entityName', 'country']);
        const payload = buildPayload({
            entityName: params.entityName,
            country: params.country,
            state: params.state,
            city: params.city
        });
        return callApi('POST', '/api/businessregistration/lookup', payload);
    }

    /**
     * 22. Look up a company by DUNS number.
     * POST /api/duns-number-lookup
     *
     * @param {Object} params
     * @param {string} params.dunsNumber - DUNS number (required)
     * @returns {Object|null} DUNS lookup result
     */
    function lookupDunsNumber(params) {
        validateRequired('lookupDunsNumber', params, ['dunsNumber']);
        const payload = buildPayload({
            dunsNumber: params.dunsNumber
        });
        return callApi('POST', '/api/duns-number-lookup', payload);
    }

    /**
     * 23. Look up business classification (SIC, NAICS, etc.).
     * POST /api/businessclassification/lookup
     *
     * @param {Object} params
     * @param {string} params.companyName - Company name (required)
     * @param {string} params.city - City (required)
     * @param {string} params.state - State or province (required)
     * @param {string} params.country - Country code (required)
     * @param {string} [params.address1] - Address line 1
     * @param {string} [params.address2] - Address line 2
     * @param {string} [params.phone] - Phone number
     * @param {string} [params.postalCode] - Postal code
     * @returns {Object|null} Classification result
     */
    function lookupBusinessClassification(params) {
        validateRequired('lookupBusinessClassification', params, ['companyName', 'city', 'state', 'country']);
        const payload = buildPayload({
            companyName: params.companyName,
            city: params.city,
            state: params.state,
            country: params.country,
            address1: params.address1,
            address2: params.address2,
            phone: params.phone,
            postalCode: params.postalCode
        });
        return callApi('POST', '/api/businessclassification/lookup', payload);
    }

    /**
     * 24. Look up corporate hierarchy (parent/child relationships).
     * POST /api/corporatehierarchy/lookup
     *
     * @param {Object} params
     * @param {string} params.companyName - Company name (required)
     * @param {string} params.addressLine1 - Address line 1 (required)
     * @param {string} params.city - City (required)
     * @param {string} params.state - State (required)
     * @param {string} params.zipCode - ZIP code (required)
     * @returns {Object|null} Corporate hierarchy
     */
    function lookupCorporateHierarchy(params) {
        validateRequired('lookupCorporateHierarchy', params,
            ['companyName', 'addressLine1', 'city', 'state', 'zipCode']);
        const payload = buildPayload({
            companyName: params.companyName,
            addressLine1: params.addressLine1,
            city: params.city,
            state: params.state,
            zipCode: params.zipCode
        });
        return callApi('POST', '/api/corporatehierarchy/lookup', payload);
    }

    /**
     * 25. Look up company hierarchy by identifier.
     * POST /api/company/hierarchy/lookup
     *
     * @param {Object} params
     * @param {string} params.identifier - Company identifier (required)
     * @param {string} params.identifierType - Type of identifier, e.g. DUNS, EIN (required)
     * @param {string} [params.country] - Country code
     * @param {string} [params.options] - Additional lookup options
     * @returns {Object|null} Company hierarchy
     */
    function lookupCompanyHierarchy(params) {
        validateRequired('lookupCompanyHierarchy', params, ['identifier', 'identifierType']);
        const payload = buildPayload({
            identifier: params.identifier,
            identifierType: params.identifierType,
            country: params.country,
            options: params.options
        });
        return callApi('POST', '/api/company/hierarchy/lookup', payload);
    }

    /**
     * 26. Look up beneficial ownership information.
     * POST /api/beneficialownership/lookup
     *
     * @param {Object} params
     * @param {string} params.companyName - Company name (required)
     * @param {string} params.countryIso2 - ISO 3166-1 alpha-2 country code (required)
     * @param {string} [params.uboThreshold] - Ownership threshold percentage
     * @param {string} [params.maxLayers] - Maximum ownership layers to traverse
     * @returns {Object|null} Beneficial ownership data
     */
    function lookupBeneficialOwnership(params) {
        validateRequired('lookupBeneficialOwnership', params, ['companyName', 'countryIso2']);
        const payload = buildPayload({
            companyName: params.companyName,
            countryIso2: params.countryIso2,
            uboThreshold: params.uboThreshold,
            maxLayers: params.maxLayers
        });
        return callApi('POST', '/api/beneficialownership/lookup', payload);
    }

    /**
     * 27. Look up certification records for a company.
     * POST /api/certification/lookup
     *
     * @param {Object} params
     * @param {string} params.companyName - Company name (required)
     * @param {string} params.country - Country code (required)
     * @param {string} [params.identityType] - Identity type
     * @returns {Object|null} Certification records
     */
    function lookupCertification(params) {
        validateRequired('lookupCertification', params, ['companyName', 'country']);
        const payload = buildPayload({
            companyName: params.companyName,
            country: params.country,
            identityType: params.identityType
        });
        return callApi('POST', '/api/certification/lookup', payload);
    }

    /**
     * 28. Identify the likely gender of a name.
     * POST /api/genderize/identifygender
     *
     * @param {Object} params
     * @param {string} params.name - Person name (required)
     * @param {string} [params.country] - Country code for locale context
     * @returns {Object|null} Gender identification result
     */
    function identifyGender(params) {
        validateRequired('identifyGender', params, ['name']);
        const payload = buildPayload({
            name: params.name,
            country: params.country
        });
        return callApi('POST', '/api/genderize/identifygender', payload);
    }

    /**
     * 29. Look up an Ariba supplier profile by ANID.
     * POST /api/aribasupplierprofile/lookup
     *
     * @param {Object} params
     * @param {string} params.anid - Ariba Network ID (required)
     * @returns {Object|null} Ariba supplier profile
     */
    function lookupAribaSupplierProfile(params) {
        validateRequired('lookupAribaSupplierProfile', params, ['anid']);
        const payload = buildPayload({
            anid: params.anid
        });
        return callApi('POST', '/api/aribasupplierprofile/lookup', payload);
    }

    // =========================================================================
    // API Methods — Risk & Compliance (30-36)
    // =========================================================================

    /**
     * 30. Screen against global sanctions / prohibited parties lists (OFAC, EU, UN).
     * POST /api/prohibited/lookup
     *
     * @param {Object} params
     * @param {string} params.companyName - Company or individual name (required)
     * @param {string} [params.businessEntityType] - Business entity type
     * @param {string} [params.country] - Country code
     * @param {string} [params.firstName] - Individual first name
     * @param {string} [params.middleName] - Individual middle name
     * @param {string} [params.lastName] - Individual last name
     * @param {string} [params.identityNumber] - Identity number (e.g. passport, national ID)
     * @param {string} [params.addressLine1] - Address line 1
     * @param {string} [params.city] - City
     * @param {string} [params.state] - State
     * @param {string} [params.postalCode] - Postal code
     * @param {number} [params.threshold] - Match threshold (0.0-1.0)
     * @returns {Object|null} Sanctions screening result
     */
    function screenSanctions(params) {
        validateRequired('screenSanctions', params, ['companyName']);
        const payload = buildPayload({
            companyName: params.companyName,
            businessEntityType: params.businessEntityType,
            country: params.country,
            firstName: params.firstName,
            middleName: params.middleName,
            lastName: params.lastName,
            identityNumber: params.identityNumber,
            addressLine1: params.addressLine1,
            city: params.city,
            state: params.state,
            postalCode: params.postalCode,
            threshold: params.threshold
        });
        return callApi('POST', '/api/prohibited/lookup', payload);
    }

    /**
     * 31. Screen for Politically Exposed Persons (PEP).
     * POST /api/pep/lookup
     *
     * @param {Object} params
     * @param {string} params.name - Person name (required)
     * @param {string} params.country - Country code (required)
     * @returns {Object|null} PEP screening result
     */
    function screenPep(params) {
        validateRequired('screenPep', params, ['name', 'country']);
        const payload = buildPayload({
            name: params.name,
            country: params.country
        });
        return callApi('POST', '/api/pep/lookup', payload);
    }

    /**
     * 32. Assess entity fraud / risk.
     * POST /api/entity/fraud/lookup
     *
     * NOTE: CountryOfIncorporation uses PascalCase (explicit JsonPropertyName override in API).
     *
     * @param {Object} params
     * @param {string} params.companyName - Company name (required)
     * @param {string} [params.CountryOfIncorporation] - Country of incorporation (PascalCase — explicit API override)
     * @param {string} [params.businessEntityType] - Business entity type
     * @returns {Object|null} Entity risk assessment
     */
    function assessEntityRisk(params) {
        validateRequired('assessEntityRisk', params, ['companyName']);
        const payload = buildPayload({
            companyName: params.companyName,
            CountryOfIncorporation: params.CountryOfIncorporation,
            businessEntityType: params.businessEntityType
        });
        return callApi('POST', '/api/entity/fraud/lookup', payload);
    }

    /**
     * 33. Look up credit analysis for a company.
     * POST /api/creditanalysis/lookup
     *
     * @param {Object} params
     * @param {string} params.companyName - Company name (required)
     * @param {string} params.addressLine1 - Address line 1 (required)
     * @param {string} params.city - City (required)
     * @param {string} params.state - State (required)
     * @param {string} params.country - Country code (required)
     * @param {string} [params.addressLine2] - Address line 2
     * @param {string} [params.postalCode] - Postal code
     * @param {string} [params.dunsNumber] - DUNS number for precise matching
     * @returns {Object|null} Credit analysis
     */
    function lookupCreditAnalysis(params) {
        validateRequired('lookupCreditAnalysis', params, ['companyName', 'addressLine1', 'city', 'state', 'country']);
        const payload = buildPayload({
            dunsNumber: params.dunsNumber,
            companyName: params.companyName,
            addressLine1: params.addressLine1,
            addressLine2: params.addressLine2,
            city: params.city,
            state: params.state,
            postalCode: params.postalCode,
            country: params.country
        });
        return callApi('POST', '/api/creditanalysis/lookup', payload);
    }

    /**
     * 34. Look up credit score for a company.
     * POST /api/risk/lookup (category: "Credit Score")
     *
     * @param {Object} params
     * @param {string} params.entityName - Entity name (required)
     * @param {string} [params.country] - Country code
     * @param {string} [params.addressLine1] - Address line 1
     * @param {string} [params.city] - City
     * @param {string} [params.state] - State
     * @param {string} [params.postalCode] - Postal code
     * @returns {Object|null} Credit score
     */
    function lookupCreditScore(params) {
        validateRequired('lookupCreditScore', params, ['entityName']);
        const payload = buildPayload({
            entityName: params.entityName,
            category: 'Credit Score',
            country: params.country,
            addressLine1: params.addressLine1,
            city: params.city,
            state: params.state,
            postalCode: params.postalCode
        });
        return callApi('POST', '/api/risk/lookup', payload);
    }

    /**
     * 35. Look up bankruptcy records for a company.
     * POST /api/risk/lookup (category: "Bankruptcy")
     *
     * @param {Object} params
     * @param {string} params.entityName - Entity name (required)
     * @param {string} [params.country] - Country code
     * @param {string} [params.addressLine1] - Address line 1
     * @param {string} [params.city] - City
     * @param {string} [params.state] - State
     * @param {string} [params.postalCode] - Postal code
     * @returns {Object|null} Bankruptcy records
     */
    function lookupBankruptcy(params) {
        validateRequired('lookupBankruptcy', params, ['entityName']);
        const payload = buildPayload({
            entityName: params.entityName,
            category: 'Bankruptcy',
            country: params.country,
            addressLine1: params.addressLine1,
            city: params.city,
            state: params.state,
            postalCode: params.postalCode
        });
        return callApi('POST', '/api/risk/lookup', payload);
    }

    /**
     * 36. Look up payment failure rate for a company.
     * POST /api/risk/lookup (category: "Fail Rate")
     *
     * @param {Object} params
     * @param {string} params.entityName - Entity name (required)
     * @param {string} [params.country] - Country code
     * @param {string} [params.addressLine1] - Address line 1
     * @param {string} [params.city] - City
     * @param {string} [params.state] - State
     * @param {string} [params.postalCode] - Postal code
     * @returns {Object|null} Failure rate data
     */
    function lookupFailRate(params) {
        validateRequired('lookupFailRate', params, ['entityName']);
        const payload = buildPayload({
            entityName: params.entityName,
            category: 'Fail Rate',
            country: params.country,
            addressLine1: params.addressLine1,
            city: params.city,
            state: params.state,
            postalCode: params.postalCode
        });
        return callApi('POST', '/api/risk/lookup', payload);
    }

    // =========================================================================
    // API Methods — Industry (37-40)
    // =========================================================================

    /**
     * 37. Look up DOT / FMCSA motor carrier information.
     * POST /api/dot/fmcsa/lookup
     *
     * @param {Object} params
     * @param {string} params.dotNumber - DOT number (required)
     * @param {string} [params.entityName] - Carrier name
     * @returns {Object|null} Motor carrier data
     */
    function lookupDotMotorCarrier(params) {
        validateRequired('lookupDotMotorCarrier', params, ['dotNumber']);
        const payload = buildPayload({
            dotNumber: params.dotNumber,
            entityName: params.entityName
        });
        return callApi('POST', '/api/dot/fmcsa/lookup', payload);
    }

    /**
     * 38. Look up healthcare provider exclusion records.
     * POST /api/providerexclusion/lookup
     *
     * @param {Object} params
     * @param {string} [params.healthCareType] - Healthcare type (HCO or HCP)
     * @param {string} [params.entityName] - Entity name
     * @param {string} [params.lastName] - Last name
     * @param {string} [params.firstName] - First name
     * @param {string} [params.address] - Address
     * @param {string} [params.city] - City
     * @param {string} [params.state] - US state (2 chars)
     * @param {string} [params.zipCode] - ZIP code (5 digits)
     * @returns {Object|null} Provider exclusion records
     */
    function lookupProviderExclusion(params) {
        params = params || {};
        const payload = buildPayload({
            healthCareType: params.healthCareType,
            entityName: params.entityName,
            lastName: params.lastName,
            firstName: params.firstName,
            address: params.address,
            city: params.city,
            state: params.state,
            zipCode: params.zipCode
        });
        return callApi('POST', '/api/providerexclusion/lookup', payload);
    }

    /**
     * 39. Validate an Ariba supplier profile by ANID.
     * POST /api/aribasupplierprofile/validate
     *
     * @param {Object} params
     * @param {string} params.anid - Ariba Network ID (required)
     * @returns {Object|null} Supplier validation result
     */
    function validateAribaSupplierProfile(params) {
        validateRequired('validateAribaSupplierProfile', params, ['anid']);
        const payload = buildPayload({
            anid: params.anid
        });
        return callApi('POST', '/api/aribasupplierprofile/validate', payload);
    }

    // =========================================================================
    // API Methods — Financial (41-43)
    // =========================================================================

    /**
     * 40. Get currency exchange rates.
     * POST /api/currency/exchange-rates/{baseCurrency}
     *
     * NOTE: baseCurrency is a path parameter, body is an array of date strings.
     *
     * @param {Object} params
     * @param {string} params.baseCurrency - Base currency ISO 4217 code, e.g. 'USD' (required)
     * @param {Array}  [params.dates] - Array of date strings (YYYY-MM-DD) for historical rates
     * @returns {Object|null} Exchange rates
     */
    function getExchangeRates(params) {
        validateRequired('getExchangeRates', params, ['baseCurrency']);
        const dates = Array.isArray(params.dates) ? params.dates : [];
        return callApi('POST', '/api/currency/exchange-rates/' + encodeURIComponent(params.baseCurrency), dates);
    }

    /**
     * 42. Analyze payment terms for early-pay discount optimization.
     * POST /api/paymentterms/validate
     *
     * @param {Object} params
     * @param {string} params.currentPayTerm - Current payment term, e.g. 'Net 30' (required)
     * @param {number} params.annualSpend - Annual spend amount (required)
     * @param {number} [params.avgDaysPay] - Average days to pay
     * @param {number} [params.savingsRate] - Target savings rate
     * @param {number} [params.threshold] - Threshold value
     * @param {string} [params.vendorName] - Vendor name
     * @returns {Object|null} Payment terms analysis
     */
    function analyzePaymentTerms(params) {
        validateRequired('analyzePaymentTerms', params, ['currentPayTerm', 'annualSpend']);
        const payload = buildPayload({
            currentPayTerm: params.currentPayTerm,
            annualSpend: params.annualSpend,
            avgDaysPay: params.avgDaysPay,
            savingsRate: params.savingsRate,
            threshold: params.threshold,
            vendorName: params.vendorName
        });
        return callApi('POST', '/api/paymentterms/validate', payload);
    }

    /**
     * 43. Look up domain security / IT security report.
     * POST /api/itsecurity/domainreport
     *
     * @param {Object} params
     * @param {string} params.domain - Domain name (required)
     * @returns {Object|null} Domain security report
     */
    function lookupDomainSecurity(params) {
        validateRequired('lookupDomainSecurity', params, ['domain']);
        const payload = buildPayload({
            domain: params.domain
        });
        return callApi('POST', '/api/itsecurity/domainreport', payload);
    }

    // =========================================================================
    // Public API
    // =========================================================================

    return {
        // Config
        loadConfig: loadConfig,
        getConfig: getConfig,
        clearConfigCache: clearConfigCache,

        // Core (exposed for advanced usage / testing)
        callApi: callApi,
        buildPayload: buildPayload,

        // Validation (1-20)
        validateAddress: validateAddress,
        validateTax: validateTax,
        validateBank: validateBank,
        validateBankPro: validateBankPro,
        validatePhone: validatePhone,
        validateEmail: validateEmail,
        validateInIdentity: validateInIdentity,
        validateTaxFormat: validateTaxFormat,
        getSupportedTaxFormats: getSupportedTaxFormats,
        validateCertification: validateCertification,
        validateDisqualifiedDirectors: validateDisqualifiedDirectors,
        validateEpaProsecution: validateEpaProsecution,
        validateProviderExclusion: validateProviderExclusion,
        validateNpi: validateNpi,
        validateMedpass: validateMedpass,
        validateEsgScore: validateEsgScore,
        validateIpQuality: validateIpQuality,
        validatePeppolId: validatePeppolId,
        getPeppolSchemes: getPeppolSchemes,

        // Enrichment / Lookup (21-29)
        lookupBusinessRegistration: lookupBusinessRegistration,
        lookupDunsNumber: lookupDunsNumber,
        lookupBusinessClassification: lookupBusinessClassification,
        lookupCorporateHierarchy: lookupCorporateHierarchy,
        lookupCompanyHierarchy: lookupCompanyHierarchy,
        lookupBeneficialOwnership: lookupBeneficialOwnership,
        lookupCertification: lookupCertification,
        identifyGender: identifyGender,
        lookupAribaSupplierProfile: lookupAribaSupplierProfile,

        // Risk & Compliance (30-36)
        screenSanctions: screenSanctions,
        screenPep: screenPep,
        assessEntityRisk: assessEntityRisk,
        lookupCreditAnalysis: lookupCreditAnalysis,
        lookupCreditScore: lookupCreditScore,
        lookupBankruptcy: lookupBankruptcy,
        lookupFailRate: lookupFailRate,

        // Industry (37-39)
        lookupDotMotorCarrier: lookupDotMotorCarrier,
        lookupProviderExclusion: lookupProviderExclusion,
        validateAribaSupplierProfile: validateAribaSupplierProfile,

        // Financial (40-42)
        getExchangeRates: getExchangeRates,
        analyzePaymentTerms: analyzePaymentTerms,
        lookupDomainSecurity: lookupDomainSecurity,

        // Constants
        ERROR_MODE: ERROR_MODE
    };
});
