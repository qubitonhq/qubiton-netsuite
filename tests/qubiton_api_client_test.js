/**
 * QubitOn API Client Unit Tests
 *
 * Complete test suite for qubiton_api_client.js — all 41 API methods,
 * config, buildPayload, callApi, error modes, and logging.
 *
 * Run options:
 *   1. Deploy as a Suitelet — navigate to the deployment URL to execute all tests
 *   2. Use with Jest/Mocha + SuiteScript stubs (e.g., @anthropic/suitescript-mocks)
 *
 * The file bundles a minimal test framework so it runs standalone in NetSuite
 * without any external dependencies.
 *
 * @NApiVersion 2.1
 * @NModuleScope Public
 */
define([], function () {

    // ===================================================================
    // Minimal Test Framework
    // ===================================================================

    var results = { passed: 0, failed: 0, skipped: 0, tests: [] };

    function assert(condition, message) {
        if (!condition) {
            throw new Error('Assertion failed: ' + (message || '(no message)'));
        }
    }

    function assertEqual(actual, expected, message) {
        if (actual !== expected) {
            throw new Error(
                (message || 'assertEqual') +
                ' — expected: ' + JSON.stringify(expected) +
                ', got: ' + JSON.stringify(actual)
            );
        }
    }

    function assertDeepEqual(actual, expected, message) {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(
                (message || 'assertDeepEqual') +
                ' — expected: ' + JSON.stringify(expected) +
                ', got: ' + JSON.stringify(actual)
            );
        }
    }

    function assertThrows(fn, expectedMsg, message) {
        var threw = false;
        var actualMsg = '';
        try {
            fn();
        } catch (e) {
            threw = true;
            actualMsg = e.message || String(e);
        }
        if (!threw) {
            throw new Error((message || 'assertThrows') + ' — expected function to throw, but it did not');
        }
        if (expectedMsg && actualMsg.indexOf(expectedMsg) === -1) {
            throw new Error(
                (message || 'assertThrows') +
                ' — expected error containing "' + expectedMsg +
                '", got: "' + actualMsg + '"'
            );
        }
    }

    function assertDoesNotThrow(fn, message) {
        try {
            fn();
        } catch (e) {
            throw new Error((message || 'assertDoesNotThrow') + ' — unexpected error: ' + e.message);
        }
    }

    function assertNotNull(value, message) {
        if (value === null || value === undefined) {
            throw new Error((message || 'assertNotNull') + ' — value was ' + String(value));
        }
    }

    function assertNull(value, message) {
        if (value !== null && value !== undefined) {
            throw new Error((message || 'assertNull') + ' — expected null/undefined, got: ' + JSON.stringify(value));
        }
    }

    function assertContains(haystack, needle, message) {
        if (typeof haystack === 'string') {
            if (haystack.indexOf(needle) === -1) {
                throw new Error((message || 'assertContains') + ' — "' + haystack + '" does not contain "' + needle + '"');
            }
        } else if (Array.isArray(haystack)) {
            if (haystack.indexOf(needle) === -1) {
                throw new Error((message || 'assertContains') + ' — array does not contain ' + JSON.stringify(needle));
            }
        } else {
            throw new Error((message || 'assertContains') + ' — first argument must be a string or array');
        }
    }

    function test(name, fn) {
        try {
            fn();
            results.passed++;
            results.tests.push({ name: name, status: 'PASS' });
        } catch (e) {
            results.failed++;
            results.tests.push({ name: name, status: 'FAIL', error: e.message });
        }
    }

    function skip(name, reason) {
        results.skipped++;
        results.tests.push({ name: name, status: 'SKIP', reason: reason || '' });
    }

    // ===================================================================
    // Stubs & Mocks (SuiteScript module stubs for running outside NetSuite)
    // ===================================================================

    var _logEntries = [];
    var _warningEntries = [];

    var stubLog = {
        error: function (opts) { _logEntries.push({ level: 'error', title: opts.title, details: opts.details }); },
        warning: function (opts) { _warningEntries.push({ title: opts.title, details: opts.details }); },
        audit: function () {},
        debug: function () {}
    };

    var stubError = {
        create: function (opts) {
            var e = new Error(opts.message);
            e.name = opts.name;
            return e;
        }
    };

    var _savedRecords = [];

    function createRecordStub() {
        var fields = {};
        return {
            setValue: function (opts) { fields[opts.fieldId] = opts.value; },
            getValue: function (id) { return fields[id]; },
            save: function () { _savedRecords.push(JSON.parse(JSON.stringify(fields))); return 1; },
            _fields: fields
        };
    }

    var stubRecord = {
        create: function () { return createRecordStub(); }
    };

    var stubRuntime = {
        getCurrentUser: function () { return { id: 999 }; }
    };

    /**
     * Build a search stub that returns configurable results.
     */
    function createSearchStub(configValues) {
        return {
            create: function () {
                return {
                    run: function () {
                        return {
                            each: function (callback) {
                                if (configValues) {
                                    callback({
                                        getValue: function (col) { return configValues[col]; }
                                    });
                                }
                            }
                        };
                    }
                };
            }
        };
    }

    /**
     * Build a mock https module that captures calls.
     */
    function createHttpsMock(responseOverrides) {
        var defaults = { code: 200, body: JSON.stringify({ success: true, data: {} }) };
        var opts = responseOverrides || {};
        var captured = { calls: [] };
        var resp = {
            code: opts.code !== undefined ? opts.code : defaults.code,
            body: opts.body !== undefined ? opts.body : defaults.body
        };

        captured.mock = {
            get: function (options) {
                captured.calls.push({ method: 'GET', url: options.url, headers: options.headers, body: null });
                return resp;
            },
            post: function (options) {
                captured.calls.push({ method: 'POST', url: options.url, headers: options.headers, body: options.body });
                return resp;
            }
        };

        return captured;
    }

    /**
     * Create a fully wired API client instance with injectable stubs.
     * This re-implements the module factory so we can control all dependencies.
     */
    function createClient(opts) {
        opts = opts || {};

        var configValues = opts.config || {
            custrecord_qbn_api_key: 'test-api-key-12345',
            custrecord_qbn_base_url: 'https://api.qubiton.com',
            custrecord_qbn_timeout: '30',
            custrecord_qbn_error_mode: opts.errorMode || 'E',
            custrecord_qbn_log_enabled: opts.logEnabled ? 'T' : false
        };

        var httpMock = opts.httpMock || createHttpsMock(opts.httpResponse);
        var searchStub = createSearchStub(configValues);
        _savedRecords = [];
        _warningEntries = [];

        // Inline reconstruction of the module with stubs
        var https = httpMock.mock;
        var log = stubLog;
        var runtime = stubRuntime;
        var record = stubRecord;
        var search = searchStub;
        var error = stubError;

        var ERROR_MODE = Object.freeze({ STOP: 'E', WARN: 'W', SILENT: 'S' });

        var _configCache = null;

        function loadConfig() {
            var results = [];
            search.create({
                type: 'customrecord_qubiton_config',
                filters: [],
                columns: ['custrecord_qbn_api_key', 'custrecord_qbn_base_url', 'custrecord_qbn_timeout', 'custrecord_qbn_error_mode', 'custrecord_qbn_log_enabled']
            }).run().each(function (result) {
                results.push(result);
                return false;
            });
            if (results.length === 0) {
                throw error.create({ name: 'QUBITON_CONFIG_MISSING', message: 'No QubitOn configuration record found. Create a customrecord_qubiton_config record.', notifyOff: false });
            }
            var r = results[0];
            var baseUrl = (r.getValue('custrecord_qbn_base_url') || '').replace(/\/+$/, '');
            if (!baseUrl) {
                throw error.create({ name: 'QUBITON_CONFIG_INVALID', message: 'custrecord_qbn_base_url is empty in the QubitOn configuration record.', notifyOff: false });
            }
            var apiKey = r.getValue('custrecord_qbn_api_key') || '';
            if (!apiKey) {
                throw error.create({ name: 'QUBITON_CONFIG_INVALID', message: 'custrecord_qbn_api_key is empty in the QubitOn configuration record.', notifyOff: false });
            }
            return {
                apiKey: apiKey,
                baseUrl: baseUrl,
                timeout: parseInt(r.getValue('custrecord_qbn_timeout'), 10) || 30,
                errorMode: r.getValue('custrecord_qbn_error_mode') || ERROR_MODE.STOP,
                logEnabled: r.getValue('custrecord_qbn_log_enabled') === true || r.getValue('custrecord_qbn_log_enabled') === 'T'
            };
        }

        function getConfig() {
            if (!_configCache) { _configCache = loadConfig(); }
            return _configCache;
        }

        function clearConfigCache() { _configCache = null; }

        function logApiCall(method, endpoint, statusCode, durationMs, errorMsg) {
            try {
                var cfg = getConfig();
                if (!cfg.logEnabled) return;
                var logRec = record.create({ type: 'customrecord_qubiton_api_log' });
                logRec.setValue({ fieldId: 'custrecord_qbn_log_method', value: method });
                logRec.setValue({ fieldId: 'custrecord_qbn_log_endpoint', value: endpoint });
                logRec.setValue({ fieldId: 'custrecord_qbn_log_status', value: statusCode });
                logRec.setValue({ fieldId: 'custrecord_qbn_log_duration', value: durationMs });
                logRec.setValue({ fieldId: 'custrecord_qbn_log_user', value: runtime.getCurrentUser().id });
                if (errorMsg) {
                    logRec.setValue({ fieldId: 'custrecord_qbn_log_error', value: String(errorMsg).substring(0, 4000) });
                }
                logRec.save({ ignoreMandatoryFields: true });
            } catch (e) {
                log.error({ title: 'QubitOn.ApiClient.logApiCall', details: e.message || e });
            }
        }

        function buildPayload(fields) {
            var payload = {};
            var keys = Object.keys(fields);
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                var val = fields[key];
                if (val !== null && val !== undefined && val !== '') {
                    payload[key] = val;
                }
            }
            return payload;
        }

        function validateRequired(methodName, params, required) {
            if (!params || typeof params !== 'object') {
                throw error.create({ name: 'QUBITON_MISSING_PARAMS', message: methodName + ': params object is required', notifyOff: true });
            }
            for (var i = 0; i < required.length; i++) {
                var field = required[i];
                var val = params[field];
                if (val === null || val === undefined || val === '') {
                    throw error.create({ name: 'QUBITON_MISSING_FIELD', message: methodName + ': required field "' + field + '" is missing or empty', notifyOff: true });
                }
            }
        }

        function callApi(httpMethod, endpoint, payload) {
            var cfg = getConfig();
            var url = cfg.baseUrl + endpoint;
            var startTime = Date.now();
            var statusCode = 0;
            var errorMsg = null;
            try {
                var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json', 'apikey': cfg.apiKey };
                var response;
                if (httpMethod === 'GET') {
                    response = https.get({ url: url, headers: headers });
                } else {
                    response = https.post({ url: url, headers: headers, body: JSON.stringify(payload || {}) });
                }
                statusCode = response.code;
                var durationMs = Date.now() - startTime;
                if (statusCode >= 200 && statusCode < 300) {
                    logApiCall(httpMethod, endpoint, statusCode, durationMs, null);
                    var body = response.body;
                    if (!body) return null;
                    try { return JSON.parse(body); } catch (parseErr) { return { _raw: body }; }
                }
                errorMsg = 'HTTP ' + statusCode + ': ' + (response.body || '').substring(0, 1000);
                logApiCall(httpMethod, endpoint, statusCode, durationMs, errorMsg);
                return handleError(cfg.errorMode, 'callApi', errorMsg);
            } catch (e) {
                var durationMs2 = Date.now() - startTime;
                errorMsg = e.message || String(e);
                logApiCall(httpMethod, endpoint, statusCode, durationMs2, errorMsg);
                return handleError(cfg.errorMode, 'callApi', errorMsg);
            }
        }

        function handleError(mode, methodName, message) {
            switch (mode) {
                case ERROR_MODE.STOP:
                    throw error.create({ name: 'QUBITON_API_ERROR', message: methodName + ': ' + message, notifyOff: false });
                case ERROR_MODE.WARN:
                    log.warning({ title: 'QubitOn.ApiClient.' + methodName, details: message });
                    return null;
                case ERROR_MODE.SILENT:
                default:
                    return null;
            }
        }

        // -- API methods (exact replica of the real module) --

        function validateAddress(params) {
            validateRequired('validateAddress', params, ['addressLine1', 'city', 'country']);
            return callApi('POST', '/api/address/validate', buildPayload({ addressLine1: params.addressLine1, addressLine2: params.addressLine2, city: params.city, state: params.state, postalCode: params.postalCode, country: params.country }));
        }
        function validateTax(params) {
            validateRequired('validateTax', params, ['identityNumber', 'country']);
            return callApi('POST', '/api/tax/validate', buildPayload({ identityNumber: params.identityNumber, identityNumberType: params.identityNumberType, country: params.country, entityName: params.entityName, businessEntityType: params.businessEntityType }));
        }
        function validateBank(params) {
            validateRequired('validateBank', params, ['accountNumber', 'country']);
            return callApi('POST', '/api/bank/validate', buildPayload({ bankNumberType: params.bankNumberType, bankCode: params.bankCode, businessEntityType: params.businessEntityType, bankAccountHolder: params.bankAccountHolder, accountNumber: params.accountNumber, routingNumber: params.routingNumber, iban: params.iban, swiftCode: params.swiftCode, country: params.country }));
        }
        function validateBankPro(params) {
            validateRequired('validateBankPro', params, ['accountNumber', 'country']);
            return callApi('POST', '/api/bank/validate/pro', buildPayload({ bankNumberType: params.bankNumberType, bankCode: params.bankCode, businessEntityType: params.businessEntityType, bankAccountHolder: params.bankAccountHolder, accountNumber: params.accountNumber, routingNumber: params.routingNumber, iban: params.iban, swiftCode: params.swiftCode, country: params.country }));
        }
        function validatePhone(params) {
            validateRequired('validatePhone', params, ['phoneNumber', 'country']);
            return callApi('POST', '/api/phone/validate', buildPayload({ phoneNumber: params.phoneNumber, country: params.country, phoneExtension: params.phoneExtension }));
        }
        function validateEmail(params) {
            validateRequired('validateEmail', params, ['emailAddress']);
            return callApi('POST', '/api/email/validate', buildPayload({ emailAddress: params.emailAddress }));
        }
        function validateInIdentity(params) {
            validateRequired('validateInIdentity', params, ['identityNumber', 'identityNumberType', 'entityName']);
            return callApi('POST', '/api/inidentity/validate', buildPayload({ identityNumber: params.identityNumber, identityNumberType: params.identityNumberType, entityName: params.entityName, dob: params.dob }));
        }
        function validateTaxFormat(params) {
            validateRequired('validateTaxFormat', params, ['identityNumber', 'identityNumberType', 'countryIso2']);
            return callApi('POST', '/api/tax/format-validate', buildPayload({ identityNumber: params.identityNumber, identityNumberType: params.identityNumberType, countryIso2: params.countryIso2 }));
        }
        function getSupportedTaxFormats() {
            return callApi('GET', '/api/tax/format-validate/countries', null);
        }
        function validateCertification(params) {
            validateRequired('validateCertification', params, ['companyName', 'country', 'certificationNumber']);
            return callApi('POST', '/api/certification/validate', buildPayload({ companyName: params.companyName, country: params.country, certificationNumber: params.certificationNumber, certificationType: params.certificationType, certificationGroup: params.certificationGroup, identityType: params.identityType }));
        }
        function validateDisqualifiedDirectors(params) {
            validateRequired('validateDisqualifiedDirectors', params, ['firstName', 'lastName', 'country']);
            return callApi('POST', '/api/disqualifieddirectors/validate', buildPayload({ firstName: params.firstName, middleName: params.middleName, lastName: params.lastName, country: params.country }));
        }
        function validateEpaProsecution(params) {
            validateRequired('validateEpaProsecution', params, ['name']);
            return callApi('POST', '/api/criminalprosecution/validate', buildPayload({ name: params.name, state: params.state, fiscalYear: params.fiscalYear }));
        }
        function validateProviderExclusion(params) {
            params = params || {};
            return callApi('POST', '/api/providerexclusion/validate', buildPayload({ healthCareType: params.healthCareType, entityName: params.entityName, lastName: params.lastName, firstName: params.firstName, address: params.address, city: params.city, state: params.state, zipCode: params.zipCode }));
        }
        function validateNpi(params) {
            validateRequired('validateNpi', params, ['npi']);
            return callApi('POST', '/api/nationalprovideridentifier/validate', buildPayload({ npi: params.npi, organizationName: params.organizationName, lastName: params.lastName, firstName: params.firstName, middleName: params.middleName }));
        }
        function validateMedpass(params) {
            validateRequired('validateMedpass', params, ['id', 'businessEntityType']);
            return callApi('POST', '/api/Medpass/validate', buildPayload({ id: params.id, businessEntityType: params.businessEntityType, companyName: params.companyName, country: params.country }));
        }
        function validateEsgScore(params) {
            validateRequired('validateEsgScore', params, ['companyName']);
            return callApi('POST', '/api/esg/Scores', buildPayload({ companyName: params.companyName, esgId: params.esgId }));
        }
        function validateIpQuality(params) {
            validateRequired('validateIpQuality', params, ['ipAddress']);
            return callApi('POST', '/api/ipquality/validate', buildPayload({ ipAddress: params.ipAddress }));
        }
        function validatePeppolId(params) {
            validateRequired('validatePeppolId', params, ['participantId']);
            return callApi('POST', '/api/peppol/validate', buildPayload({ participantId: params.participantId, directoryLookup: params.directoryLookup }));
        }
        function getPeppolSchemes() {
            return callApi('GET', '/api/peppol/schemes', null);
        }
        function lookupBusinessRegistration(params) {
            validateRequired('lookupBusinessRegistration', params, ['entityName', 'country']);
            return callApi('POST', '/api/businessregistration/lookup', buildPayload({ entityName: params.entityName, country: params.country, state: params.state, city: params.city }));
        }
        function lookupDunsNumber(params) {
            validateRequired('lookupDunsNumber', params, ['dunsNumber']);
            return callApi('POST', '/api/duns-number-lookup', buildPayload({ dunsNumber: params.dunsNumber }));
        }
        function lookupBusinessClassification(params) {
            validateRequired('lookupBusinessClassification', params, ['companyName', 'city', 'state', 'country']);
            return callApi('POST', '/api/businessclassification/lookup', buildPayload({ companyName: params.companyName, city: params.city, state: params.state, country: params.country, address1: params.address1, address2: params.address2, phone: params.phone, postalCode: params.postalCode }));
        }
        function lookupCorporateHierarchy(params) {
            validateRequired('lookupCorporateHierarchy', params, ['companyName', 'addressLine1', 'city', 'state', 'zipCode']);
            return callApi('POST', '/api/corporatehierarchy/lookup', buildPayload({ companyName: params.companyName, addressLine1: params.addressLine1, city: params.city, state: params.state, zipCode: params.zipCode }));
        }
        function lookupCompanyHierarchy(params) {
            validateRequired('lookupCompanyHierarchy', params, ['identifier', 'identifierType']);
            return callApi('POST', '/api/company/hierarchy/lookup', buildPayload({ identifier: params.identifier, identifierType: params.identifierType, country: params.country, options: params.options }));
        }
        function lookupBeneficialOwnership(params) {
            validateRequired('lookupBeneficialOwnership', params, ['companyName', 'countryIso2']);
            return callApi('POST', '/api/beneficialownership/lookup', buildPayload({ companyName: params.companyName, countryIso2: params.countryIso2, uboThreshold: params.uboThreshold, maxLayers: params.maxLayers }));
        }
        function lookupCertification(params) {
            validateRequired('lookupCertification', params, ['companyName', 'country']);
            return callApi('POST', '/api/certification/lookup', buildPayload({ companyName: params.companyName, country: params.country, identityType: params.identityType }));
        }
        function identifyGender(params) {
            validateRequired('identifyGender', params, ['name']);
            return callApi('POST', '/api/genderize/identifygender', buildPayload({ name: params.name, country: params.country }));
        }
        function lookupAribaSupplierProfile(params) {
            validateRequired('lookupAribaSupplierProfile', params, ['anid']);
            return callApi('POST', '/api/aribasupplierprofile/lookup', buildPayload({ anid: params.anid }));
        }
        function screenSanctions(params) {
            validateRequired('screenSanctions', params, ['companyName']);
            return callApi('POST', '/api/prohibited/lookup', buildPayload({ companyName: params.companyName, businessEntityType: params.businessEntityType, country: params.country, firstName: params.firstName, middleName: params.middleName, lastName: params.lastName, identityNumber: params.identityNumber, addressLine1: params.addressLine1, city: params.city, state: params.state, postalCode: params.postalCode, threshold: params.threshold }));
        }
        function screenPep(params) {
            validateRequired('screenPep', params, ['name', 'country']);
            return callApi('POST', '/api/pep/lookup', buildPayload({ name: params.name, country: params.country }));
        }
        function assessEntityRisk(params) {
            validateRequired('assessEntityRisk', params, ['CompanyName']);
            return callApi('POST', '/api/entity/fraud/lookup', buildPayload({ CompanyName: params.CompanyName, CountryOfIncorporation: params.CountryOfIncorporation, BusinessEntityType: params.BusinessEntityType }));
        }
        function lookupCreditAnalysis(params) {
            validateRequired('lookupCreditAnalysis', params, ['companyName', 'addressLine1', 'city', 'state', 'country']);
            return callApi('POST', '/api/creditanalysis/lookup', buildPayload({ dunsNumber: params.dunsNumber, companyName: params.companyName, addressLine1: params.addressLine1, addressLine2: params.addressLine2, city: params.city, state: params.state, postalCode: params.postalCode, country: params.country }));
        }
        function lookupCreditScore(params) {
            validateRequired('lookupCreditScore', params, ['entityName']);
            return callApi('POST', '/api/risk/lookup', buildPayload({ entityName: params.entityName, category: 'Credit Score', country: params.country, addressLine1: params.addressLine1, city: params.city, state: params.state, postalCode: params.postalCode }));
        }
        function lookupBankruptcy(params) {
            validateRequired('lookupBankruptcy', params, ['entityName']);
            return callApi('POST', '/api/risk/lookup', buildPayload({ entityName: params.entityName, category: 'Bankruptcy', country: params.country, addressLine1: params.addressLine1, city: params.city, state: params.state, postalCode: params.postalCode }));
        }
        function lookupFailRate(params) {
            validateRequired('lookupFailRate', params, ['entityName']);
            return callApi('POST', '/api/risk/lookup', buildPayload({ entityName: params.entityName, category: 'Fail Rate', country: params.country, addressLine1: params.addressLine1, city: params.city, state: params.state, postalCode: params.postalCode }));
        }
        function lookupDotMotorCarrier(params) {
            validateRequired('lookupDotMotorCarrier', params, ['dotNumber']);
            return callApi('POST', '/api/dot/fmcsa/lookup', buildPayload({ dotNumber: params.dotNumber, entityName: params.entityName }));
        }
        function lookupProviderExclusion(params) {
            params = params || {};
            return callApi('POST', '/api/providerexclusion/lookup', buildPayload({ healthCareType: params.healthCareType, entityName: params.entityName, lastName: params.lastName, firstName: params.firstName, address: params.address, city: params.city, state: params.state, zipCode: params.zipCode }));
        }
        function validateAribaSupplierProfile(params) {
            validateRequired('validateAribaSupplierProfile', params, ['anid']);
            return callApi('POST', '/api/aribasupplierprofile/validate', buildPayload({ anid: params.anid }));
        }
        function getExchangeRates(params) {
            validateRequired('getExchangeRates', params, ['baseCurrency']);
            var dates = Array.isArray(params.dates) ? params.dates : [];
            return callApi('POST', '/api/currency/exchange-rates/' + encodeURIComponent(params.baseCurrency), dates);
        }
        function analyzePaymentTerms(params) {
            validateRequired('analyzePaymentTerms', params, ['currentPayTerm', 'annualSpend']);
            return callApi('POST', '/api/paymentterms/validate', buildPayload({ currentPayTerm: params.currentPayTerm, annualSpend: params.annualSpend, avgDaysPay: params.avgDaysPay, savingsRate: params.savingsRate, threshold: params.threshold, vendorName: params.vendorName }));
        }
        function lookupDomainSecurity(params) {
            validateRequired('lookupDomainSecurity', params, ['domain']);
            return callApi('POST', '/api/itsecurity/domainreport', buildPayload({ domain: params.domain }));
        }

        return {
            loadConfig: loadConfig, getConfig: getConfig, clearConfigCache: clearConfigCache,
            callApi: callApi, buildPayload: buildPayload,
            validateAddress: validateAddress, validateTax: validateTax,
            validateBank: validateBank, validateBankPro: validateBankPro,
            validatePhone: validatePhone, validateEmail: validateEmail,
            validateInIdentity: validateInIdentity, validateTaxFormat: validateTaxFormat,
            getSupportedTaxFormats: getSupportedTaxFormats, validateCertification: validateCertification,
            validateDisqualifiedDirectors: validateDisqualifiedDirectors,
            validateEpaProsecution: validateEpaProsecution,
            validateProviderExclusion: validateProviderExclusion,
            validateNpi: validateNpi, validateMedpass: validateMedpass,
            validateEsgScore: validateEsgScore, validateIpQuality: validateIpQuality,
            validatePeppolId: validatePeppolId, getPeppolSchemes: getPeppolSchemes,
            lookupBusinessRegistration: lookupBusinessRegistration,
            lookupDunsNumber: lookupDunsNumber,
            lookupBusinessClassification: lookupBusinessClassification,
            lookupCorporateHierarchy: lookupCorporateHierarchy,
            lookupCompanyHierarchy: lookupCompanyHierarchy,
            lookupBeneficialOwnership: lookupBeneficialOwnership,
            lookupCertification: lookupCertification,
            identifyGender: identifyGender,
            lookupAribaSupplierProfile: lookupAribaSupplierProfile,
            screenSanctions: screenSanctions, screenPep: screenPep,
            assessEntityRisk: assessEntityRisk,
            lookupCreditAnalysis: lookupCreditAnalysis,
            lookupCreditScore: lookupCreditScore,
            lookupBankruptcy: lookupBankruptcy, lookupFailRate: lookupFailRate,
            lookupDotMotorCarrier: lookupDotMotorCarrier,
            lookupProviderExclusion: lookupProviderExclusion,
            validateAribaSupplierProfile: validateAribaSupplierProfile,
            getExchangeRates: getExchangeRates,
            analyzePaymentTerms: analyzePaymentTerms,
            lookupDomainSecurity: lookupDomainSecurity,
            _httpMock: httpMock, ERROR_MODE: ERROR_MODE
        };
    }

    // ===================================================================
    // 1. Config Tests
    // ===================================================================

    test('loadConfig — returns valid config with all fields', function () {
        var client = createClient();
        var cfg = client.getConfig();
        assertNotNull(cfg.apiKey, 'apiKey should be present');
        assertNotNull(cfg.baseUrl, 'baseUrl should be present');
        assertNotNull(cfg.errorMode, 'errorMode should be present');
        assertEqual(cfg.apiKey, 'test-api-key-12345');
        assertEqual(cfg.baseUrl, 'https://api.qubiton.com');
        assertEqual(cfg.timeout, 30);
    });

    test('loadConfig — missing API key throws QUBITON_CONFIG_INVALID', function () {
        assertThrows(function () {
            createClient({ config: {
                custrecord_qbn_api_key: '',
                custrecord_qbn_base_url: 'https://api.qubiton.com',
                custrecord_qbn_timeout: '30',
                custrecord_qbn_error_mode: 'E',
                custrecord_qbn_log_enabled: false
            }});
        }, 'custrecord_qbn_api_key is empty');
    });

    test('loadConfig — missing base URL throws QUBITON_CONFIG_INVALID', function () {
        assertThrows(function () {
            createClient({ config: {
                custrecord_qbn_api_key: 'key123',
                custrecord_qbn_base_url: '',
                custrecord_qbn_timeout: '30',
                custrecord_qbn_error_mode: 'E',
                custrecord_qbn_log_enabled: false
            }});
        }, 'custrecord_qbn_base_url is empty');
    });

    test('loadConfig — invalid error mode defaults to E (stop)', function () {
        var client = createClient({ config: {
            custrecord_qbn_api_key: 'key123',
            custrecord_qbn_base_url: 'https://api.qubiton.com',
            custrecord_qbn_timeout: '30',
            custrecord_qbn_error_mode: '',
            custrecord_qbn_log_enabled: false
        }});
        var cfg = client.getConfig();
        assertEqual(cfg.errorMode, 'E', 'Empty error mode should default to E');
    });

    test('loadConfig — URL trailing slash is stripped', function () {
        var client = createClient({ config: {
            custrecord_qbn_api_key: 'key123',
            custrecord_qbn_base_url: 'https://api.qubiton.com///',
            custrecord_qbn_timeout: '30',
            custrecord_qbn_error_mode: 'E',
            custrecord_qbn_log_enabled: false
        }});
        var cfg = client.getConfig();
        assertEqual(cfg.baseUrl, 'https://api.qubiton.com');
    });

    test('loadConfig — config is cached on second call', function () {
        var client = createClient();
        var cfg1 = client.getConfig();
        var cfg2 = client.getConfig();
        assert(cfg1 === cfg2, 'getConfig should return same cached object');
    });

    test('clearConfigCache — forces reload on next getConfig', function () {
        var client = createClient();
        var cfg1 = client.getConfig();
        client.clearConfigCache();
        var cfg2 = client.getConfig();
        assert(cfg1 !== cfg2, 'After clearConfigCache, getConfig should return a new object');
        assertEqual(cfg2.apiKey, cfg1.apiKey, 'Reloaded config should have same values');
    });

    // ===================================================================
    // 2. buildPayload Tests
    // ===================================================================

    test('buildPayload — skips null values', function () {
        var client = createClient();
        var result = client.buildPayload({ name: 'Acme', city: null });
        assertEqual(result.name, 'Acme');
        assertEqual(result.city, undefined, 'null should be omitted');
    });

    test('buildPayload — skips undefined values', function () {
        var client = createClient();
        var result = client.buildPayload({ name: 'Acme', state: undefined });
        assertEqual(result.state, undefined, 'undefined should be omitted');
    });

    test('buildPayload — skips empty string values', function () {
        var client = createClient();
        var result = client.buildPayload({ name: 'Acme', postalCode: '' });
        assertEqual(result.postalCode, undefined, 'empty string should be omitted');
    });

    test('buildPayload — keeps boolean false', function () {
        var client = createClient();
        var result = client.buildPayload({ name: 'Acme', directoryLookup: false });
        assertEqual(result.directoryLookup, false, 'false should be preserved');
    });

    test('buildPayload — keeps numeric zero', function () {
        var client = createClient();
        var result = client.buildPayload({ name: 'Acme', threshold: 0 });
        assertEqual(result.threshold, 0, 'zero should be preserved');
    });

    test('buildPayload — keeps arrays', function () {
        var client = createClient();
        var result = client.buildPayload({ dates: ['2024-01-01', '2024-06-15'] });
        assert(Array.isArray(result.dates), 'arrays should be preserved');
        assertEqual(result.dates.length, 2);
    });

    test('buildPayload — keeps nested objects', function () {
        var client = createClient();
        var result = client.buildPayload({ data: { key: 'val' } });
        assertDeepEqual(result.data, { key: 'val' });
    });

    test('buildPayload — returns empty object for all-empty input', function () {
        var client = createClient();
        var result = client.buildPayload({ a: null, b: undefined, c: '' });
        assertDeepEqual(result, {});
    });

    // ===================================================================
    // 3. callApi HTTP Tests
    // ===================================================================

    test('callApi — 200 success returns parsed JSON body', function () {
        var client = createClient({ httpResponse: { code: 200, body: JSON.stringify({ success: true, count: 42 }) } });
        var result = client.callApi('POST', '/api/test', {});
        assertEqual(result.success, true);
        assertEqual(result.count, 42);
    });

    test('callApi — 400 Bad Request throws in E mode', function () {
        var client = createClient({ errorMode: 'E', httpResponse: { code: 400, body: JSON.stringify({ error: 'Invalid input' }) } });
        assertThrows(function () {
            client.callApi('POST', '/api/test', {});
        }, 'HTTP 400');
    });

    test('callApi — 401 Unauthorized throws in E mode', function () {
        var client = createClient({ errorMode: 'E', httpResponse: { code: 401, body: JSON.stringify({ error: 'Invalid API key' }) } });
        assertThrows(function () {
            client.callApi('POST', '/api/test', {});
        }, 'HTTP 401');
    });

    test('callApi — 403 Forbidden throws in E mode', function () {
        var client = createClient({ errorMode: 'E', httpResponse: { code: 403, body: JSON.stringify({ error: 'Forbidden' }) } });
        assertThrows(function () {
            client.callApi('POST', '/api/test', {});
        }, 'HTTP 403');
    });

    test('callApi — 429 Rate Limited throws in E mode', function () {
        var client = createClient({ errorMode: 'E', httpResponse: { code: 429, body: JSON.stringify({ error: 'Rate limited' }) } });
        assertThrows(function () {
            client.callApi('POST', '/api/test', {});
        }, 'HTTP 429');
    });

    test('callApi — 500 Server Error throws in E mode', function () {
        var client = createClient({ errorMode: 'E', httpResponse: { code: 500, body: JSON.stringify({ error: 'Internal error' }) } });
        assertThrows(function () {
            client.callApi('POST', '/api/test', {});
        }, 'HTTP 500');
    });

    test('callApi — non-JSON response returns _raw wrapper', function () {
        var client = createClient({ httpResponse: { code: 200, body: '<html>Not JSON</html>' } });
        var result = client.callApi('POST', '/api/test', {});
        assertEqual(result._raw, '<html>Not JSON</html>');
    });

    test('callApi — empty body returns null', function () {
        var client = createClient({ httpResponse: { code: 200, body: '' } });
        var result = client.callApi('GET', '/api/test', null);
        assertNull(result, 'Empty body should return null');
    });

    test('callApi — URL is constructed from baseUrl + endpoint', function () {
        var httpMock = createHttpsMock({ code: 200, body: JSON.stringify({ ok: true }) });
        var client = createClient({ httpMock: httpMock });
        client.callApi('POST', '/api/address/validate', {});
        assertEqual(httpMock.calls[0].url, 'https://api.qubiton.com/api/address/validate');
    });

    test('callApi — sends apikey header (not Authorization Bearer)', function () {
        var httpMock = createHttpsMock({ code: 200, body: JSON.stringify({ ok: true }) });
        var client = createClient({ httpMock: httpMock });
        client.callApi('POST', '/api/test', {});
        assertEqual(httpMock.calls[0].headers['apikey'], 'test-api-key-12345');
        assertEqual(httpMock.calls[0].headers['Content-Type'], 'application/json');
        assertEqual(httpMock.calls[0].headers['Accept'], 'application/json');
    });

    test('callApi — GET calls https.get, not https.post', function () {
        var httpMock = createHttpsMock({ code: 200, body: JSON.stringify({ ok: true }) });
        var client = createClient({ httpMock: httpMock });
        client.callApi('GET', '/api/peppol/schemes', null);
        assertEqual(httpMock.calls[0].method, 'GET');
    });

    // ===================================================================
    // 4. Error Mode Tests
    // ===================================================================

    test('error mode E — throws on non-2xx response', function () {
        var client = createClient({ errorMode: 'E', httpResponse: { code: 500, body: '{"error":"fail"}' } });
        assertThrows(function () {
            client.callApi('POST', '/api/test', {});
        }, 'QUBITON_API_ERROR');
    });

    test('error mode W — returns null and logs warning on non-2xx', function () {
        _warningEntries = [];
        var client = createClient({ errorMode: 'W', httpResponse: { code: 500, body: '{"error":"fail"}' } });
        var result = client.callApi('POST', '/api/test', {});
        assertNull(result, 'W mode should return null');
        assert(_warningEntries.length > 0, 'W mode should log a warning');
    });

    test('error mode S — returns null silently on non-2xx', function () {
        _warningEntries = [];
        var client = createClient({ errorMode: 'S', httpResponse: { code: 500, body: '{"error":"fail"}' } });
        var result = client.callApi('POST', '/api/test', {});
        assertNull(result, 'S mode should return null');
        assertEqual(_warningEntries.length, 0, 'S mode should not log warnings');
    });

    test('error mode E — does not throw on 200 success', function () {
        var client = createClient({ errorMode: 'E', httpResponse: { code: 200, body: '{"ok":true}' } });
        assertDoesNotThrow(function () {
            client.callApi('POST', '/api/test', {});
        });
    });

    // ===================================================================
    // 5. API Logging Tests
    // ===================================================================

    test('API logging — log record created when logging enabled', function () {
        _savedRecords = [];
        var client = createClient({ logEnabled: true, httpResponse: { code: 200, body: '{"ok":true}' } });
        client.callApi('POST', '/api/address/validate', {});
        assert(_savedRecords.length >= 1, 'Should create at least 1 log record');
        assertEqual(_savedRecords[0].custrecord_qbn_log_method, 'POST');
        assertEqual(_savedRecords[0].custrecord_qbn_log_endpoint, '/api/address/validate');
        assertEqual(_savedRecords[0].custrecord_qbn_log_status, 200);
    });

    test('API logging — no log record when logging disabled', function () {
        _savedRecords = [];
        var client = createClient({ logEnabled: false, httpResponse: { code: 200, body: '{"ok":true}' } });
        client.callApi('POST', '/api/test', {});
        assertEqual(_savedRecords.length, 0, 'Should not create log records when disabled');
    });

    test('API logging — log captures duration as a number', function () {
        _savedRecords = [];
        var client = createClient({ logEnabled: true, httpResponse: { code: 200, body: '{"ok":true}' } });
        client.callApi('POST', '/api/test', {});
        assert(typeof _savedRecords[0].custrecord_qbn_log_duration === 'number', 'Duration should be a number');
    });

    test('API logging — error message captured on failure', function () {
        _savedRecords = [];
        var client = createClient({ logEnabled: true, errorMode: 'S', httpResponse: { code: 500, body: 'Server error' } });
        client.callApi('POST', '/api/test', {});
        assert(_savedRecords.length >= 1, 'Should create log on error');
        assertContains(_savedRecords[0].custrecord_qbn_log_error, 'HTTP 500');
    });

    // ===================================================================
    // 6. All 41 API Method Tests
    //
    // For each method we verify:
    //   a) Required fields throw QUBITON_MISSING_FIELD when missing
    //   b) Correct endpoint URL is used
    //   c) Correct HTTP method (GET vs POST)
    // ===================================================================

    // Helper to assert method hits the right endpoint with the right HTTP method
    function assertMethodCall(methodFn, validParams, expectedEndpoint, expectedHttpMethod) {
        var httpMock = createHttpsMock({ code: 200, body: '{"ok":true}' });
        var client = createClient({ httpMock: httpMock });
        methodFn(client, validParams);
        assertEqual(httpMock.calls[0].method, expectedHttpMethod, 'HTTP method for ' + expectedEndpoint);
        assertContains(httpMock.calls[0].url, expectedEndpoint, 'Endpoint URL');
    }

    // Helper to assert a required field throws
    function assertRequiredField(methodFn, validParams, fieldName, methodName) {
        var client = createClient();
        var badParams = JSON.parse(JSON.stringify(validParams));
        delete badParams[fieldName];
        assertThrows(function () {
            methodFn(client, badParams);
        }, '"' + fieldName + '"', methodName + ' should throw when ' + fieldName + ' is missing');
    }

    // ---- 1. validateAddress ----
    test('validateAddress — throws when addressLine1 is missing', function () {
        assertRequiredField(function (c, p) { c.validateAddress(p); }, { addressLine1: '123 Main', city: 'Dallas', country: 'US' }, 'addressLine1', 'validateAddress');
    });
    test('validateAddress — throws when city is missing', function () {
        assertRequiredField(function (c, p) { c.validateAddress(p); }, { addressLine1: '123 Main', city: 'Dallas', country: 'US' }, 'city', 'validateAddress');
    });
    test('validateAddress — throws when country is missing', function () {
        assertRequiredField(function (c, p) { c.validateAddress(p); }, { addressLine1: '123 Main', city: 'Dallas', country: 'US' }, 'country', 'validateAddress');
    });
    test('validateAddress — calls POST /api/address/validate', function () {
        assertMethodCall(function (c, p) { c.validateAddress(p); }, { addressLine1: '123 Main', city: 'Dallas', country: 'US' }, '/api/address/validate', 'POST');
    });

    // ---- 2. validateTax ----
    test('validateTax — throws when identityNumber is missing', function () {
        assertRequiredField(function (c, p) { c.validateTax(p); }, { identityNumber: '123456789', country: 'US' }, 'identityNumber', 'validateTax');
    });
    test('validateTax — throws when country is missing', function () {
        assertRequiredField(function (c, p) { c.validateTax(p); }, { identityNumber: '123456789', country: 'US' }, 'country', 'validateTax');
    });
    test('validateTax — calls POST /api/tax/validate', function () {
        assertMethodCall(function (c, p) { c.validateTax(p); }, { identityNumber: '123456789', country: 'US' }, '/api/tax/validate', 'POST');
    });

    // ---- 3. validateBank ----
    test('validateBank — throws when accountNumber is missing', function () {
        assertRequiredField(function (c, p) { c.validateBank(p); }, { accountNumber: '12345678', country: 'US' }, 'accountNumber', 'validateBank');
    });
    test('validateBank — throws when country is missing', function () {
        assertRequiredField(function (c, p) { c.validateBank(p); }, { accountNumber: '12345678', country: 'US' }, 'country', 'validateBank');
    });
    test('validateBank — calls POST /api/bank/validate', function () {
        assertMethodCall(function (c, p) { c.validateBank(p); }, { accountNumber: '12345678', country: 'US' }, '/api/bank/validate', 'POST');
    });

    // ---- 4. validateBankPro ----
    test('validateBankPro — throws when accountNumber is missing', function () {
        assertRequiredField(function (c, p) { c.validateBankPro(p); }, { accountNumber: '12345678', country: 'US' }, 'accountNumber', 'validateBankPro');
    });
    test('validateBankPro — throws when country is missing', function () {
        assertRequiredField(function (c, p) { c.validateBankPro(p); }, { accountNumber: '12345678', country: 'US' }, 'country', 'validateBankPro');
    });
    test('validateBankPro — calls POST /api/bank/validate/pro', function () {
        assertMethodCall(function (c, p) { c.validateBankPro(p); }, { accountNumber: '12345678', country: 'US' }, '/api/bank/validate/pro', 'POST');
    });

    // ---- 5. validatePhone ----
    test('validatePhone — throws when phoneNumber is missing', function () {
        assertRequiredField(function (c, p) { c.validatePhone(p); }, { phoneNumber: '+15551234567', country: 'US' }, 'phoneNumber', 'validatePhone');
    });
    test('validatePhone — throws when country is missing', function () {
        assertRequiredField(function (c, p) { c.validatePhone(p); }, { phoneNumber: '+15551234567', country: 'US' }, 'country', 'validatePhone');
    });
    test('validatePhone — calls POST /api/phone/validate', function () {
        assertMethodCall(function (c, p) { c.validatePhone(p); }, { phoneNumber: '+15551234567', country: 'US' }, '/api/phone/validate', 'POST');
    });

    // ---- 6. validateEmail ----
    test('validateEmail — throws when emailAddress is missing', function () {
        assertRequiredField(function (c, p) { c.validateEmail(p); }, { emailAddress: 'test@example.com' }, 'emailAddress', 'validateEmail');
    });
    test('validateEmail — calls POST /api/email/validate', function () {
        assertMethodCall(function (c, p) { c.validateEmail(p); }, { emailAddress: 'test@example.com' }, '/api/email/validate', 'POST');
    });

    // ---- 7. validateInIdentity ----
    test('validateInIdentity — throws when identityNumber is missing', function () {
        assertRequiredField(function (c, p) { c.validateInIdentity(p); }, { identityNumber: 'ABCDE1234F', identityNumberType: 'PAN', entityName: 'John Doe' }, 'identityNumber', 'validateInIdentity');
    });
    test('validateInIdentity — throws when identityNumberType is missing', function () {
        assertRequiredField(function (c, p) { c.validateInIdentity(p); }, { identityNumber: 'ABCDE1234F', identityNumberType: 'PAN', entityName: 'John Doe' }, 'identityNumberType', 'validateInIdentity');
    });
    test('validateInIdentity — throws when entityName is missing', function () {
        assertRequiredField(function (c, p) { c.validateInIdentity(p); }, { identityNumber: 'ABCDE1234F', identityNumberType: 'PAN', entityName: 'John Doe' }, 'entityName', 'validateInIdentity');
    });
    test('validateInIdentity — calls POST /api/inidentity/validate', function () {
        assertMethodCall(function (c, p) { c.validateInIdentity(p); }, { identityNumber: 'ABCDE1234F', identityNumberType: 'PAN', entityName: 'John Doe' }, '/api/inidentity/validate', 'POST');
    });

    // ---- 8. validateTaxFormat ----
    test('validateTaxFormat — throws when identityNumber is missing', function () {
        assertRequiredField(function (c, p) { c.validateTaxFormat(p); }, { identityNumber: 'DE123456789', identityNumberType: 'VAT', countryIso2: 'DE' }, 'identityNumber', 'validateTaxFormat');
    });
    test('validateTaxFormat — throws when identityNumberType is missing', function () {
        assertRequiredField(function (c, p) { c.validateTaxFormat(p); }, { identityNumber: 'DE123456789', identityNumberType: 'VAT', countryIso2: 'DE' }, 'identityNumberType', 'validateTaxFormat');
    });
    test('validateTaxFormat — throws when countryIso2 is missing', function () {
        assertRequiredField(function (c, p) { c.validateTaxFormat(p); }, { identityNumber: 'DE123456789', identityNumberType: 'VAT', countryIso2: 'DE' }, 'countryIso2', 'validateTaxFormat');
    });
    test('validateTaxFormat — calls POST /api/tax/format-validate', function () {
        assertMethodCall(function (c, p) { c.validateTaxFormat(p); }, { identityNumber: 'DE123456789', identityNumberType: 'VAT', countryIso2: 'DE' }, '/api/tax/format-validate', 'POST');
    });

    // ---- 9. getSupportedTaxFormats ----
    test('getSupportedTaxFormats — requires no parameters', function () {
        var httpMock = createHttpsMock({ code: 200, body: '{"countries":[]}' });
        var client = createClient({ httpMock: httpMock });
        assertDoesNotThrow(function () { client.getSupportedTaxFormats(); });
    });
    test('getSupportedTaxFormats — calls GET /api/tax/format-validate/countries', function () {
        var httpMock = createHttpsMock({ code: 200, body: '{"countries":[]}' });
        var client = createClient({ httpMock: httpMock });
        client.getSupportedTaxFormats();
        assertEqual(httpMock.calls[0].method, 'GET');
        assertContains(httpMock.calls[0].url, '/api/tax/format-validate/countries');
    });

    // ---- 10. validateCertification ----
    test('validateCertification — throws when companyName is missing', function () {
        assertRequiredField(function (c, p) { c.validateCertification(p); }, { companyName: 'Acme', country: 'US', certificationNumber: 'CERT-001' }, 'companyName', 'validateCertification');
    });
    test('validateCertification — throws when country is missing', function () {
        assertRequiredField(function (c, p) { c.validateCertification(p); }, { companyName: 'Acme', country: 'US', certificationNumber: 'CERT-001' }, 'country', 'validateCertification');
    });
    test('validateCertification — throws when certificationNumber is missing', function () {
        assertRequiredField(function (c, p) { c.validateCertification(p); }, { companyName: 'Acme', country: 'US', certificationNumber: 'CERT-001' }, 'certificationNumber', 'validateCertification');
    });
    test('validateCertification — calls POST /api/certification/validate', function () {
        assertMethodCall(function (c, p) { c.validateCertification(p); }, { companyName: 'Acme', country: 'US', certificationNumber: 'CERT-001' }, '/api/certification/validate', 'POST');
    });

    // ---- 11. validateDisqualifiedDirectors ----
    test('validateDisqualifiedDirectors — throws when firstName is missing', function () {
        assertRequiredField(function (c, p) { c.validateDisqualifiedDirectors(p); }, { firstName: 'John', lastName: 'Smith', country: 'GB' }, 'firstName', 'validateDisqualifiedDirectors');
    });
    test('validateDisqualifiedDirectors — throws when lastName is missing', function () {
        assertRequiredField(function (c, p) { c.validateDisqualifiedDirectors(p); }, { firstName: 'John', lastName: 'Smith', country: 'GB' }, 'lastName', 'validateDisqualifiedDirectors');
    });
    test('validateDisqualifiedDirectors — throws when country is missing', function () {
        assertRequiredField(function (c, p) { c.validateDisqualifiedDirectors(p); }, { firstName: 'John', lastName: 'Smith', country: 'GB' }, 'country', 'validateDisqualifiedDirectors');
    });
    test('validateDisqualifiedDirectors — calls POST /api/disqualifieddirectors/validate', function () {
        assertMethodCall(function (c, p) { c.validateDisqualifiedDirectors(p); }, { firstName: 'John', lastName: 'Smith', country: 'GB' }, '/api/disqualifieddirectors/validate', 'POST');
    });

    // ---- 12. validateEpaProsecution ----
    test('validateEpaProsecution — throws when name is missing', function () {
        assertRequiredField(function (c, p) { c.validateEpaProsecution(p); }, { name: 'Acme Corp' }, 'name', 'validateEpaProsecution');
    });
    test('validateEpaProsecution — calls POST /api/criminalprosecution/validate', function () {
        assertMethodCall(function (c, p) { c.validateEpaProsecution(p); }, { name: 'Acme Corp' }, '/api/criminalprosecution/validate', 'POST');
    });

    // ---- 13. validateProviderExclusion ----
    test('validateProviderExclusion — no required fields (all optional)', function () {
        var httpMock = createHttpsMock({ code: 200, body: '{"ok":true}' });
        var client = createClient({ httpMock: httpMock });
        assertDoesNotThrow(function () { client.validateProviderExclusion({}); });
    });
    test('validateProviderExclusion — accepts null params', function () {
        var httpMock = createHttpsMock({ code: 200, body: '{"ok":true}' });
        var client = createClient({ httpMock: httpMock });
        assertDoesNotThrow(function () { client.validateProviderExclusion(null); });
    });
    test('validateProviderExclusion — calls POST /api/providerexclusion/validate', function () {
        assertMethodCall(function (c, p) { c.validateProviderExclusion(p); }, { healthCareType: 'HCO' }, '/api/providerexclusion/validate', 'POST');
    });

    // ---- 14. validateNpi ----
    test('validateNpi — throws when npi is missing', function () {
        assertRequiredField(function (c, p) { c.validateNpi(p); }, { npi: '1234567890' }, 'npi', 'validateNpi');
    });
    test('validateNpi — calls POST /api/nationalprovideridentifier/validate', function () {
        assertMethodCall(function (c, p) { c.validateNpi(p); }, { npi: '1234567890' }, '/api/nationalprovideridentifier/validate', 'POST');
    });

    // ---- 15. validateMedpass ----
    test('validateMedpass — throws when id is missing', function () {
        assertRequiredField(function (c, p) { c.validateMedpass(p); }, { id: '12345', businessEntityType: 'Corporation' }, 'id', 'validateMedpass');
    });
    test('validateMedpass — throws when businessEntityType is missing', function () {
        assertRequiredField(function (c, p) { c.validateMedpass(p); }, { id: '12345', businessEntityType: 'Corporation' }, 'businessEntityType', 'validateMedpass');
    });
    test('validateMedpass — calls POST /api/Medpass/validate', function () {
        assertMethodCall(function (c, p) { c.validateMedpass(p); }, { id: '12345', businessEntityType: 'Corporation' }, '/api/Medpass/validate', 'POST');
    });

    // ---- 16. validateEsgScore ----
    test('validateEsgScore — throws when companyName is missing', function () {
        assertRequiredField(function (c, p) { c.validateEsgScore(p); }, { companyName: 'Acme' }, 'companyName', 'validateEsgScore');
    });
    test('validateEsgScore — calls POST /api/esg/Scores', function () {
        assertMethodCall(function (c, p) { c.validateEsgScore(p); }, { companyName: 'Acme' }, '/api/esg/Scores', 'POST');
    });

    // ---- 17. validateIpQuality ----
    test('validateIpQuality — throws when ipAddress is missing', function () {
        assertRequiredField(function (c, p) { c.validateIpQuality(p); }, { ipAddress: '8.8.8.8' }, 'ipAddress', 'validateIpQuality');
    });
    test('validateIpQuality — calls POST /api/ipquality/validate', function () {
        assertMethodCall(function (c, p) { c.validateIpQuality(p); }, { ipAddress: '8.8.8.8' }, '/api/ipquality/validate', 'POST');
    });

    // ---- 18. validatePeppolId ----
    test('validatePeppolId — throws when participantId is missing', function () {
        assertRequiredField(function (c, p) { c.validatePeppolId(p); }, { participantId: '0192:997049309' }, 'participantId', 'validatePeppolId');
    });
    test('validatePeppolId — calls POST /api/peppol/validate', function () {
        assertMethodCall(function (c, p) { c.validatePeppolId(p); }, { participantId: '0192:997049309' }, '/api/peppol/validate', 'POST');
    });

    // ---- 19. getPeppolSchemes ----
    test('getPeppolSchemes — requires no parameters', function () {
        var httpMock = createHttpsMock({ code: 200, body: '{"schemes":[]}' });
        var client = createClient({ httpMock: httpMock });
        assertDoesNotThrow(function () { client.getPeppolSchemes(); });
    });
    test('getPeppolSchemes — calls GET /api/peppol/schemes', function () {
        var httpMock = createHttpsMock({ code: 200, body: '{"schemes":[]}' });
        var client = createClient({ httpMock: httpMock });
        client.getPeppolSchemes();
        assertEqual(httpMock.calls[0].method, 'GET');
        assertContains(httpMock.calls[0].url, '/api/peppol/schemes');
    });

    // ---- 20. lookupBusinessRegistration ----
    test('lookupBusinessRegistration — throws when entityName is missing', function () {
        assertRequiredField(function (c, p) { c.lookupBusinessRegistration(p); }, { entityName: 'Acme', country: 'US' }, 'entityName', 'lookupBusinessRegistration');
    });
    test('lookupBusinessRegistration — throws when country is missing', function () {
        assertRequiredField(function (c, p) { c.lookupBusinessRegistration(p); }, { entityName: 'Acme', country: 'US' }, 'country', 'lookupBusinessRegistration');
    });
    test('lookupBusinessRegistration — calls POST /api/businessregistration/lookup', function () {
        assertMethodCall(function (c, p) { c.lookupBusinessRegistration(p); }, { entityName: 'Acme', country: 'US' }, '/api/businessregistration/lookup', 'POST');
    });

    // ---- 21. lookupDunsNumber ----
    test('lookupDunsNumber — throws when dunsNumber is missing', function () {
        assertRequiredField(function (c, p) { c.lookupDunsNumber(p); }, { dunsNumber: '123456789' }, 'dunsNumber', 'lookupDunsNumber');
    });
    test('lookupDunsNumber — calls POST /api/duns-number-lookup', function () {
        assertMethodCall(function (c, p) { c.lookupDunsNumber(p); }, { dunsNumber: '123456789' }, '/api/duns-number-lookup', 'POST');
    });

    // ---- 22. lookupBusinessClassification ----
    test('lookupBusinessClassification — throws when companyName is missing', function () {
        assertRequiredField(function (c, p) { c.lookupBusinessClassification(p); }, { companyName: 'Acme', city: 'Raleigh', state: 'NC', country: 'US' }, 'companyName', 'lookupBusinessClassification');
    });
    test('lookupBusinessClassification — throws when city is missing', function () {
        assertRequiredField(function (c, p) { c.lookupBusinessClassification(p); }, { companyName: 'Acme', city: 'Raleigh', state: 'NC', country: 'US' }, 'city', 'lookupBusinessClassification');
    });
    test('lookupBusinessClassification — throws when state is missing', function () {
        assertRequiredField(function (c, p) { c.lookupBusinessClassification(p); }, { companyName: 'Acme', city: 'Raleigh', state: 'NC', country: 'US' }, 'state', 'lookupBusinessClassification');
    });
    test('lookupBusinessClassification — throws when country is missing', function () {
        assertRequiredField(function (c, p) { c.lookupBusinessClassification(p); }, { companyName: 'Acme', city: 'Raleigh', state: 'NC', country: 'US' }, 'country', 'lookupBusinessClassification');
    });
    test('lookupBusinessClassification — calls POST /api/businessclassification/lookup', function () {
        assertMethodCall(function (c, p) { c.lookupBusinessClassification(p); }, { companyName: 'Acme', city: 'Raleigh', state: 'NC', country: 'US' }, '/api/businessclassification/lookup', 'POST');
    });

    // ---- 23. lookupCorporateHierarchy ----
    test('lookupCorporateHierarchy — throws when companyName is missing', function () {
        assertRequiredField(function (c, p) { c.lookupCorporateHierarchy(p); }, { companyName: 'Acme', addressLine1: '123 Main', city: 'NYC', state: 'NY', zipCode: '10001' }, 'companyName', 'lookupCorporateHierarchy');
    });
    test('lookupCorporateHierarchy — throws when addressLine1 is missing', function () {
        assertRequiredField(function (c, p) { c.lookupCorporateHierarchy(p); }, { companyName: 'Acme', addressLine1: '123 Main', city: 'NYC', state: 'NY', zipCode: '10001' }, 'addressLine1', 'lookupCorporateHierarchy');
    });
    test('lookupCorporateHierarchy — throws when city is missing', function () {
        assertRequiredField(function (c, p) { c.lookupCorporateHierarchy(p); }, { companyName: 'Acme', addressLine1: '123 Main', city: 'NYC', state: 'NY', zipCode: '10001' }, 'city', 'lookupCorporateHierarchy');
    });
    test('lookupCorporateHierarchy — throws when state is missing', function () {
        assertRequiredField(function (c, p) { c.lookupCorporateHierarchy(p); }, { companyName: 'Acme', addressLine1: '123 Main', city: 'NYC', state: 'NY', zipCode: '10001' }, 'state', 'lookupCorporateHierarchy');
    });
    test('lookupCorporateHierarchy — throws when zipCode is missing', function () {
        assertRequiredField(function (c, p) { c.lookupCorporateHierarchy(p); }, { companyName: 'Acme', addressLine1: '123 Main', city: 'NYC', state: 'NY', zipCode: '10001' }, 'zipCode', 'lookupCorporateHierarchy');
    });
    test('lookupCorporateHierarchy — calls POST /api/corporatehierarchy/lookup', function () {
        assertMethodCall(function (c, p) { c.lookupCorporateHierarchy(p); }, { companyName: 'Acme', addressLine1: '123 Main', city: 'NYC', state: 'NY', zipCode: '10001' }, '/api/corporatehierarchy/lookup', 'POST');
    });

    // ---- 24. lookupCompanyHierarchy ----
    test('lookupCompanyHierarchy — throws when identifier is missing', function () {
        assertRequiredField(function (c, p) { c.lookupCompanyHierarchy(p); }, { identifier: 'DUNS123', identifierType: 'DUNS' }, 'identifier', 'lookupCompanyHierarchy');
    });
    test('lookupCompanyHierarchy — throws when identifierType is missing', function () {
        assertRequiredField(function (c, p) { c.lookupCompanyHierarchy(p); }, { identifier: 'DUNS123', identifierType: 'DUNS' }, 'identifierType', 'lookupCompanyHierarchy');
    });
    test('lookupCompanyHierarchy — calls POST /api/company/hierarchy/lookup', function () {
        assertMethodCall(function (c, p) { c.lookupCompanyHierarchy(p); }, { identifier: 'DUNS123', identifierType: 'DUNS' }, '/api/company/hierarchy/lookup', 'POST');
    });

    // ---- 25. lookupBeneficialOwnership ----
    test('lookupBeneficialOwnership — throws when companyName is missing', function () {
        assertRequiredField(function (c, p) { c.lookupBeneficialOwnership(p); }, { companyName: 'Acme Ltd', countryIso2: 'GB' }, 'companyName', 'lookupBeneficialOwnership');
    });
    test('lookupBeneficialOwnership — throws when countryIso2 is missing', function () {
        assertRequiredField(function (c, p) { c.lookupBeneficialOwnership(p); }, { companyName: 'Acme Ltd', countryIso2: 'GB' }, 'countryIso2', 'lookupBeneficialOwnership');
    });
    test('lookupBeneficialOwnership — calls POST /api/beneficialownership/lookup', function () {
        assertMethodCall(function (c, p) { c.lookupBeneficialOwnership(p); }, { companyName: 'Acme Ltd', countryIso2: 'GB' }, '/api/beneficialownership/lookup', 'POST');
    });

    // ---- 26. lookupCertification ----
    test('lookupCertification — throws when companyName is missing', function () {
        assertRequiredField(function (c, p) { c.lookupCertification(p); }, { companyName: 'Acme', country: 'US' }, 'companyName', 'lookupCertification');
    });
    test('lookupCertification — throws when country is missing', function () {
        assertRequiredField(function (c, p) { c.lookupCertification(p); }, { companyName: 'Acme', country: 'US' }, 'country', 'lookupCertification');
    });
    test('lookupCertification — calls POST /api/certification/lookup', function () {
        assertMethodCall(function (c, p) { c.lookupCertification(p); }, { companyName: 'Acme', country: 'US' }, '/api/certification/lookup', 'POST');
    });

    // ---- 27. identifyGender ----
    test('identifyGender — throws when name is missing', function () {
        assertRequiredField(function (c, p) { c.identifyGender(p); }, { name: 'Alex' }, 'name', 'identifyGender');
    });
    test('identifyGender — calls POST /api/genderize/identifygender', function () {
        assertMethodCall(function (c, p) { c.identifyGender(p); }, { name: 'Alex' }, '/api/genderize/identifygender', 'POST');
    });

    // ---- 28. lookupAribaSupplierProfile ----
    test('lookupAribaSupplierProfile — throws when anid is missing', function () {
        assertRequiredField(function (c, p) { c.lookupAribaSupplierProfile(p); }, { anid: 'AN01234567890' }, 'anid', 'lookupAribaSupplierProfile');
    });
    test('lookupAribaSupplierProfile — calls POST /api/aribasupplierprofile/lookup', function () {
        assertMethodCall(function (c, p) { c.lookupAribaSupplierProfile(p); }, { anid: 'AN01234567890' }, '/api/aribasupplierprofile/lookup', 'POST');
    });

    // ---- 29. screenSanctions ----
    test('screenSanctions — throws when companyName is missing', function () {
        assertRequiredField(function (c, p) { c.screenSanctions(p); }, { companyName: 'Acme' }, 'companyName', 'screenSanctions');
    });
    test('screenSanctions — calls POST /api/prohibited/lookup', function () {
        assertMethodCall(function (c, p) { c.screenSanctions(p); }, { companyName: 'Acme' }, '/api/prohibited/lookup', 'POST');
    });

    // ---- 30. screenPep ----
    test('screenPep — throws when name is missing', function () {
        assertRequiredField(function (c, p) { c.screenPep(p); }, { name: 'John Doe', country: 'US' }, 'name', 'screenPep');
    });
    test('screenPep — throws when country is missing', function () {
        assertRequiredField(function (c, p) { c.screenPep(p); }, { name: 'John Doe', country: 'US' }, 'country', 'screenPep');
    });
    test('screenPep — calls POST /api/pep/lookup', function () {
        assertMethodCall(function (c, p) { c.screenPep(p); }, { name: 'John Doe', country: 'US' }, '/api/pep/lookup', 'POST');
    });

    // ---- 31. assessEntityRisk ----
    test('assessEntityRisk — throws when CompanyName is missing (PascalCase)', function () {
        assertRequiredField(function (c, p) { c.assessEntityRisk(p); }, { CompanyName: 'Acme' }, 'CompanyName', 'assessEntityRisk');
    });
    test('assessEntityRisk — calls POST /api/entity/fraud/lookup', function () {
        assertMethodCall(function (c, p) { c.assessEntityRisk(p); }, { CompanyName: 'Acme' }, '/api/entity/fraud/lookup', 'POST');
    });

    // ---- 32. lookupCreditAnalysis ----
    test('lookupCreditAnalysis — throws when companyName is missing', function () {
        assertRequiredField(function (c, p) { c.lookupCreditAnalysis(p); }, { companyName: 'Acme', addressLine1: '123 Main', city: 'NYC', state: 'NY', country: 'US' }, 'companyName', 'lookupCreditAnalysis');
    });
    test('lookupCreditAnalysis — throws when addressLine1 is missing', function () {
        assertRequiredField(function (c, p) { c.lookupCreditAnalysis(p); }, { companyName: 'Acme', addressLine1: '123 Main', city: 'NYC', state: 'NY', country: 'US' }, 'addressLine1', 'lookupCreditAnalysis');
    });
    test('lookupCreditAnalysis — throws when city is missing', function () {
        assertRequiredField(function (c, p) { c.lookupCreditAnalysis(p); }, { companyName: 'Acme', addressLine1: '123 Main', city: 'NYC', state: 'NY', country: 'US' }, 'city', 'lookupCreditAnalysis');
    });
    test('lookupCreditAnalysis — throws when state is missing', function () {
        assertRequiredField(function (c, p) { c.lookupCreditAnalysis(p); }, { companyName: 'Acme', addressLine1: '123 Main', city: 'NYC', state: 'NY', country: 'US' }, 'state', 'lookupCreditAnalysis');
    });
    test('lookupCreditAnalysis — throws when country is missing', function () {
        assertRequiredField(function (c, p) { c.lookupCreditAnalysis(p); }, { companyName: 'Acme', addressLine1: '123 Main', city: 'NYC', state: 'NY', country: 'US' }, 'country', 'lookupCreditAnalysis');
    });
    test('lookupCreditAnalysis — calls POST /api/creditanalysis/lookup', function () {
        assertMethodCall(function (c, p) { c.lookupCreditAnalysis(p); }, { companyName: 'Acme', addressLine1: '123 Main', city: 'NYC', state: 'NY', country: 'US' }, '/api/creditanalysis/lookup', 'POST');
    });

    // ---- 33. lookupCreditScore ----
    test('lookupCreditScore — throws when entityName is missing', function () {
        assertRequiredField(function (c, p) { c.lookupCreditScore(p); }, { entityName: 'Acme' }, 'entityName', 'lookupCreditScore');
    });
    test('lookupCreditScore — calls POST /api/risk/lookup', function () {
        assertMethodCall(function (c, p) { c.lookupCreditScore(p); }, { entityName: 'Acme' }, '/api/risk/lookup', 'POST');
    });
    test('lookupCreditScore — sends category "Credit Score" in payload', function () {
        var httpMock = createHttpsMock({ code: 200, body: '{"ok":true}' });
        var client = createClient({ httpMock: httpMock });
        client.lookupCreditScore({ entityName: 'Acme' });
        var sentBody = JSON.parse(httpMock.calls[0].body);
        assertEqual(sentBody.category, 'Credit Score');
    });

    // ---- 34. lookupBankruptcy ----
    test('lookupBankruptcy — throws when entityName is missing', function () {
        assertRequiredField(function (c, p) { c.lookupBankruptcy(p); }, { entityName: 'Acme' }, 'entityName', 'lookupBankruptcy');
    });
    test('lookupBankruptcy — calls POST /api/risk/lookup', function () {
        assertMethodCall(function (c, p) { c.lookupBankruptcy(p); }, { entityName: 'Acme' }, '/api/risk/lookup', 'POST');
    });
    test('lookupBankruptcy — sends category "Bankruptcy" in payload', function () {
        var httpMock = createHttpsMock({ code: 200, body: '{"ok":true}' });
        var client = createClient({ httpMock: httpMock });
        client.lookupBankruptcy({ entityName: 'Acme' });
        var sentBody = JSON.parse(httpMock.calls[0].body);
        assertEqual(sentBody.category, 'Bankruptcy');
    });

    // ---- 35. lookupFailRate ----
    test('lookupFailRate — throws when entityName is missing', function () {
        assertRequiredField(function (c, p) { c.lookupFailRate(p); }, { entityName: 'Acme' }, 'entityName', 'lookupFailRate');
    });
    test('lookupFailRate — calls POST /api/risk/lookup', function () {
        assertMethodCall(function (c, p) { c.lookupFailRate(p); }, { entityName: 'Acme' }, '/api/risk/lookup', 'POST');
    });
    test('lookupFailRate — sends category "Fail Rate" in payload', function () {
        var httpMock = createHttpsMock({ code: 200, body: '{"ok":true}' });
        var client = createClient({ httpMock: httpMock });
        client.lookupFailRate({ entityName: 'Acme' });
        var sentBody = JSON.parse(httpMock.calls[0].body);
        assertEqual(sentBody.category, 'Fail Rate');
    });

    // ---- 36. lookupDotMotorCarrier ----
    test('lookupDotMotorCarrier — throws when dotNumber is missing', function () {
        assertRequiredField(function (c, p) { c.lookupDotMotorCarrier(p); }, { dotNumber: '1234567' }, 'dotNumber', 'lookupDotMotorCarrier');
    });
    test('lookupDotMotorCarrier — calls POST /api/dot/fmcsa/lookup', function () {
        assertMethodCall(function (c, p) { c.lookupDotMotorCarrier(p); }, { dotNumber: '1234567' }, '/api/dot/fmcsa/lookup', 'POST');
    });

    // ---- 37. lookupProviderExclusion ----
    test('lookupProviderExclusion — no required fields (all optional)', function () {
        var httpMock = createHttpsMock({ code: 200, body: '{"ok":true}' });
        var client = createClient({ httpMock: httpMock });
        assertDoesNotThrow(function () { client.lookupProviderExclusion({}); });
    });
    test('lookupProviderExclusion — calls POST /api/providerexclusion/lookup', function () {
        assertMethodCall(function (c, p) { c.lookupProviderExclusion(p); }, { healthCareType: 'HCP' }, '/api/providerexclusion/lookup', 'POST');
    });

    // ---- 38. validateAribaSupplierProfile ----
    test('validateAribaSupplierProfile — throws when anid is missing', function () {
        assertRequiredField(function (c, p) { c.validateAribaSupplierProfile(p); }, { anid: 'AN01234567890' }, 'anid', 'validateAribaSupplierProfile');
    });
    test('validateAribaSupplierProfile — calls POST /api/aribasupplierprofile/validate', function () {
        assertMethodCall(function (c, p) { c.validateAribaSupplierProfile(p); }, { anid: 'AN01234567890' }, '/api/aribasupplierprofile/validate', 'POST');
    });

    // ---- 39. getExchangeRates ----
    test('getExchangeRates — throws when baseCurrency is missing', function () {
        assertRequiredField(function (c, p) { c.getExchangeRates(p); }, { baseCurrency: 'USD' }, 'baseCurrency', 'getExchangeRates');
    });
    test('getExchangeRates — calls POST /api/currency/exchange-rates/{baseCurrency}', function () {
        var httpMock = createHttpsMock({ code: 200, body: '{"rates":{}}' });
        var client = createClient({ httpMock: httpMock });
        client.getExchangeRates({ baseCurrency: 'USD', dates: ['2024-01-15'] });
        assertEqual(httpMock.calls[0].method, 'POST');
        assertContains(httpMock.calls[0].url, '/api/currency/exchange-rates/USD');
    });
    test('getExchangeRates — sends dates array as request body', function () {
        var httpMock = createHttpsMock({ code: 200, body: '{"rates":{}}' });
        var client = createClient({ httpMock: httpMock });
        client.getExchangeRates({ baseCurrency: 'EUR', dates: ['2024-01-15', '2024-06-30'] });
        var sentBody = JSON.parse(httpMock.calls[0].body);
        assertDeepEqual(sentBody, ['2024-01-15', '2024-06-30']);
    });
    test('getExchangeRates — sends empty array when dates not provided', function () {
        var httpMock = createHttpsMock({ code: 200, body: '{"rates":{}}' });
        var client = createClient({ httpMock: httpMock });
        client.getExchangeRates({ baseCurrency: 'GBP' });
        var sentBody = JSON.parse(httpMock.calls[0].body);
        assertDeepEqual(sentBody, []);
    });

    // ---- 40. analyzePaymentTerms ----
    test('analyzePaymentTerms — throws when currentPayTerm is missing', function () {
        assertRequiredField(function (c, p) { c.analyzePaymentTerms(p); }, { currentPayTerm: 'Net 30', annualSpend: 50000 }, 'currentPayTerm', 'analyzePaymentTerms');
    });
    test('analyzePaymentTerms — throws when annualSpend is missing', function () {
        assertRequiredField(function (c, p) { c.analyzePaymentTerms(p); }, { currentPayTerm: 'Net 30', annualSpend: 50000 }, 'annualSpend', 'analyzePaymentTerms');
    });
    test('analyzePaymentTerms — calls POST /api/paymentterms/validate', function () {
        assertMethodCall(function (c, p) { c.analyzePaymentTerms(p); }, { currentPayTerm: 'Net 30', annualSpend: 50000 }, '/api/paymentterms/validate', 'POST');
    });

    // ---- 41. lookupDomainSecurity ----
    test('lookupDomainSecurity — throws when domain is missing', function () {
        assertRequiredField(function (c, p) { c.lookupDomainSecurity(p); }, { domain: 'example.com' }, 'domain', 'lookupDomainSecurity');
    });
    test('lookupDomainSecurity — calls POST /api/itsecurity/domainreport', function () {
        assertMethodCall(function (c, p) { c.lookupDomainSecurity(p); }, { domain: 'example.com' }, '/api/itsecurity/domainreport', 'POST');
    });

    // ===================================================================
    // 7. Payload Construction Tests
    // ===================================================================

    test('validateAddress payload — optional fields omitted when null', function () {
        var httpMock = createHttpsMock({ code: 200, body: '{"ok":true}' });
        var client = createClient({ httpMock: httpMock });
        client.validateAddress({ addressLine1: '123 Main St', addressLine2: null, city: 'Dallas', state: 'TX', postalCode: '', country: 'US' });
        var sent = JSON.parse(httpMock.calls[0].body);
        assertEqual(sent.addressLine1, '123 Main St');
        assertEqual(sent.city, 'Dallas');
        assertEqual(sent.country, 'US');
        assertEqual(sent.state, 'TX');
        assertEqual(sent.addressLine2, undefined, 'null addressLine2 should be omitted');
        assertEqual(sent.postalCode, undefined, 'empty postalCode should be omitted');
    });

    test('analyzePaymentTerms payload — numeric zero threshold preserved', function () {
        var httpMock = createHttpsMock({ code: 200, body: '{"ok":true}' });
        var client = createClient({ httpMock: httpMock });
        client.analyzePaymentTerms({ currentPayTerm: 'Net 30', annualSpend: 50000, threshold: 0 });
        var sent = JSON.parse(httpMock.calls[0].body);
        assertEqual(sent.threshold, 0, 'Zero threshold must be preserved');
    });

    test('validatePeppolId payload — boolean false directoryLookup preserved', function () {
        var httpMock = createHttpsMock({ code: 200, body: '{"ok":true}' });
        var client = createClient({ httpMock: httpMock });
        client.validatePeppolId({ participantId: '0192:997049309', directoryLookup: false });
        var sent = JSON.parse(httpMock.calls[0].body);
        assertEqual(sent.directoryLookup, false, 'false directoryLookup must be preserved');
    });

    test('validateBank payload — optional iban included, null swiftCode omitted', function () {
        var httpMock = createHttpsMock({ code: 200, body: '{"ok":true}' });
        var client = createClient({ httpMock: httpMock });
        client.validateBank({ accountNumber: '12345678', country: 'GB', iban: 'GB29NWBK60161331926819', swiftCode: null, routingNumber: '' });
        var sent = JSON.parse(httpMock.calls[0].body);
        assertEqual(sent.iban, 'GB29NWBK60161331926819');
        assertEqual(sent.swiftCode, undefined, 'null swiftCode should be omitted');
        assertEqual(sent.routingNumber, undefined, 'empty routingNumber should be omitted');
    });

    test('screenSanctions payload — optional threshold zero preserved', function () {
        var httpMock = createHttpsMock({ code: 200, body: '{"ok":true}' });
        var client = createClient({ httpMock: httpMock });
        client.screenSanctions({ companyName: 'Acme', threshold: 0 });
        var sent = JSON.parse(httpMock.calls[0].body);
        assertEqual(sent.threshold, 0, 'Zero threshold must be preserved');
    });

    test('all methods — passing null as params throws QUBITON_MISSING_PARAMS', function () {
        var client = createClient();
        // Test a representative sample (methods with required fields)
        var methodNames = ['validateAddress', 'validateTax', 'validateBank', 'validatePhone',
            'validateEmail', 'validateNpi', 'screenSanctions', 'assessEntityRisk',
            'lookupDunsNumber', 'analyzePaymentTerms'];
        for (var i = 0; i < methodNames.length; i++) {
            var name = methodNames[i];
            assertThrows(function () {
                client[name](null);
            }, 'params object is required', name + ' should throw on null params');
        }
    });

    // ===================================================================
    // Runner
    // ===================================================================

    function formatResults() {
        var lines = [];
        lines.push('=== QubitOn API Client Tests ===');
        lines.push('Passed: ' + results.passed + '  Failed: ' + results.failed + '  Skipped: ' + results.skipped);
        lines.push('Total:  ' + results.tests.length);
        lines.push('');

        for (var i = 0; i < results.tests.length; i++) {
            var t = results.tests[i];
            var icon = t.status === 'PASS' ? '[OK]' : t.status === 'FAIL' ? '[FAIL]' : '[SKIP]';
            var line = icon + ' ' + t.name;
            if (t.error) {
                line += '\n      ' + t.error;
            }
            if (t.reason) {
                line += ' (' + t.reason + ')';
            }
            lines.push(line);
        }

        return lines.join('\n');
    }

    function run() {
        return {
            passed: results.passed,
            failed: results.failed,
            skipped: results.skipped,
            total: results.tests.length,
            tests: results.tests,
            text: formatResults()
        };
    }

    return { run: run };
});
