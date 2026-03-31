/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * QubitOn Validation Orchestrator (Layer 2)
 *
 * Config-driven validation engine for NetSuite records.
 * Reads validation rules from customrecord_qubiton_val_cfg and orchestrates
 * calls to the QubitOn API via the Layer 1 API client.
 *
 * Supported record types: vendor, customer, employee, partner, contact
 *
 * Architecture:
 *   Layer 1 — qubiton_api_client.js  (HTTP transport, auth, retries)
 *   Layer 2 — qubiton_validation.js  (this file: config, mapping, orchestration)
 *   Layer 3 — qubiton_ue.js / qubiton_sl.js  (NetSuite entry points)
 */
define(['N/record', 'N/search', 'N/log', 'N/runtime', './qubiton_api_client'],
function (record, search, log, runtime, api) {

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    const MODULE = 'QubitOn.Validation';

    const CONFIG_RECORD_TYPE = 'customrecord_qubiton_val_cfg';

    /**
     * Cache lifetime in milliseconds. Config records rarely change so we hold
     * them for 5 minutes to avoid repeated searches within a single execution
     * context (scheduled script batches, mass-update, etc.).
     */
    const CACHE_TTL_MS = 5 * 60 * 1000;

    // -------------------------------------------------------------------------
    // Validation config cache
    // -------------------------------------------------------------------------

    /**
     * In-memory cache keyed by record type.
     * Structure: { [recordType]: { config: {...}, loadedAt: Date.now() } }
     */
    let _configCache = {};

    /**
     * Load (or return cached) validation configuration for a given record type.
     *
     * @param {string} recordType - NetSuite record type internal ID
     *     (vendor, customer, employee, partner, contact)
     * @returns {Object|null} Parsed config object, or null if none found / inactive
     */
    function loadValidationConfig(recordType) {
        const now = Date.now();
        const cached = _configCache[recordType];

        if (cached && (now - cached.loadedAt) < CACHE_TTL_MS) {
            return cached.config;
        }

        try {
            const results = search.create({
                type: CONFIG_RECORD_TYPE,
                filters: [
                    ['custrecord_qbn_vc_record_type', 'is', recordType],
                    'AND',
                    ['custrecord_qbn_vc_active', 'is', 'T']
                ],
                columns: [
                    'custrecord_qbn_vc_tax',
                    'custrecord_qbn_vc_bank',
                    'custrecord_qbn_vc_address',
                    'custrecord_qbn_vc_sanctions',
                    'custrecord_qbn_vc_directors',
                    'custrecord_qbn_vc_email',
                    'custrecord_qbn_vc_phone',
                    'custrecord_qbn_vc_risk',
                    'custrecord_qbn_vc_stop_on_fail',
                    'custrecord_qbn_vc_active'
                ]
            }).run().getRange({ start: 0, end: 1 });

            if (!results || results.length === 0) {
                log.debug({ title: MODULE, details: `No active config for record type: ${recordType}` });
                _configCache[recordType] = { config: null, loadedAt: now };
                return null;
            }

            const row = results[0];
            const config = {
                validateTax:        row.getValue('custrecord_qbn_vc_tax') === true || row.getValue('custrecord_qbn_vc_tax') === 'T',
                validateBank:       row.getValue('custrecord_qbn_vc_bank') === true || row.getValue('custrecord_qbn_vc_bank') === 'T',
                validateAddress:    row.getValue('custrecord_qbn_vc_address') === true || row.getValue('custrecord_qbn_vc_address') === 'T',
                validateSanctions:  row.getValue('custrecord_qbn_vc_sanctions') === true || row.getValue('custrecord_qbn_vc_sanctions') === 'T',
                validateDirectors:  row.getValue('custrecord_qbn_vc_directors') === true || row.getValue('custrecord_qbn_vc_directors') === 'T',
                validateEmail:      row.getValue('custrecord_qbn_vc_email') === true || row.getValue('custrecord_qbn_vc_email') === 'T',
                validatePhone:      row.getValue('custrecord_qbn_vc_phone') === true || row.getValue('custrecord_qbn_vc_phone') === 'T',
                validateRisk:       row.getValue('custrecord_qbn_vc_risk') === true || row.getValue('custrecord_qbn_vc_risk') === 'T',
                stopOnFail:         row.getValue('custrecord_qbn_vc_stop_on_fail') === true || row.getValue('custrecord_qbn_vc_stop_on_fail') === 'T'
            };

            _configCache[recordType] = { config: config, loadedAt: now };
            log.debug({ title: MODULE, details: `Loaded config for ${recordType}: ${JSON.stringify(config)}` });
            return config;

        } catch (e) {
            log.error({ title: MODULE, details: `Failed to load config for ${recordType}: ${e.message}` });
            return null;
        }
    }

    /**
     * Clear the config cache. Useful when a config record is updated via
     * a User Event on the config record itself.
     *
     * @param {string} [recordType] - Optional record type to clear; omit to flush all.
     */
    function clearConfigCache(recordType) {
        if (recordType) {
            delete _configCache[recordType];
        } else {
            _configCache = {};
        }
    }

    // -------------------------------------------------------------------------
    // Field mappings: NetSuite internal IDs per record type
    // -------------------------------------------------------------------------

    /**
     * Maps QubitOn API parameter names to NetSuite field internal IDs.
     * Address and bank details are extracted separately from sublists.
     */
    const FIELD_MAP = {
        vendor: {
            companyName:  'companyname',
            taxId:        'vatregnumber',
            phone:        'phone',
            altPhone:     'altphone',
            fax:          'fax',
            email:        'email',
            url:          'url',
            entityId:     'entityid',
            legalName:    'legalname'
        },
        customer: {
            companyName:  'companyname',
            taxId:        'vatregnumber',
            phone:        'phone',
            altPhone:     'altphone',
            fax:          'fax',
            email:        'email',
            url:          'url',
            entityId:     'entityid',
            legalName:    'legalname'
        },
        employee: {
            firstName:    'firstname',
            lastName:     'lastname',
            phone:        'phone',
            mobilePhone:  'mobilephone',
            email:        'email',
            socialSecNum: 'socialsecuritynumber',
            entityId:     'entityid'
        },
        partner: {
            companyName:  'companyname',
            taxId:        'vatregnumber',
            phone:        'phone',
            email:        'email',
            url:          'url',
            entityId:     'entityid',
            legalName:    'legalname'
        },
        contact: {
            firstName:    'firstname',
            lastName:     'lastname',
            phone:        'phone',
            mobilePhone:  'mobilephone',
            email:        'email',
            entityId:     'entityid'
        }
    };

    // -------------------------------------------------------------------------
    // Tax type detection by country (matches SAP/Oracle connector patterns)
    // -------------------------------------------------------------------------

    /**
     * Map ISO 3166-1 alpha-2 country codes to the most common tax identifier
     * type used in that jurisdiction.
     */
    const TAX_TYPE_BY_COUNTRY = {
        // North America
        US: 'EIN',
        CA: 'BN',
        MX: 'RFC',

        // United Kingdom & Ireland
        GB: 'VAT',
        IE: 'TIN',

        // Western Europe
        DE: 'STEUERNUMMER',
        FR: 'TVA',
        IT: 'PARTITAIVA',
        ES: 'NIF',
        PT: 'NIF',
        NL: 'BTW',
        BE: 'BCE',
        LU: 'TVA',
        AT: 'ATU',
        CH: 'UID',

        // Nordics
        SE: 'MOMSREG',
        NO: 'MVA',
        DK: 'CVR',
        FI: 'ALV',

        // Eastern Europe
        PL: 'NIP',
        CZ: 'DIC',
        SK: 'DIC',
        HU: 'ANUM',
        RO: 'CUI',
        BG: 'EIK',
        HR: 'OIB',
        SI: 'DDV',

        // Asia-Pacific
        AU: 'ABN',
        NZ: 'IRD',
        JP: 'CORPORATE_NUMBER',
        KR: 'BRN',
        CN: 'USCC',
        IN: 'GSTIN',
        SG: 'UEN',
        HK: 'BRN',
        MY: 'SST',
        TH: 'TIN',
        PH: 'TIN',
        ID: 'NPWP',
        TW: 'UBN',
        VN: 'MST',

        // Middle East
        AE: 'TRN',
        SA: 'TIN',
        IL: 'TIN',

        // South America
        BR: 'CNPJ',
        AR: 'CUIT',
        CL: 'RUT',
        CO: 'NIT',
        PE: 'RUC',

        // Africa
        ZA: 'TIN',
        NG: 'TIN',
        KE: 'PIN'
    };

    /**
     * Detect the appropriate tax identifier type for a given country code.
     *
     * @param {string} country - ISO 3166-1 alpha-2 country code (e.g. 'US', 'GB')
     * @returns {string} Tax type code, defaults to 'VAT' if country not mapped
     */
    function detectTaxType(country) {
        if (!country) return 'VAT';
        return TAX_TYPE_BY_COUNTRY[country.toUpperCase()] || 'VAT';
    }

    // -------------------------------------------------------------------------
    // Country resolution
    // -------------------------------------------------------------------------

    /**
     * Resolve the country for a record. Strategy:
     *   1. Default shipping or billing address country from the addressbook sublist
     *   2. Subsidiary's country (for OneWorld accounts)
     *   3. Company-level default from runtime preferences
     *
     * @param {N/record.Record} rec - The loaded NetSuite record
     * @param {string} recordType - Record type internal ID
     * @returns {string} Two-letter ISO country code (e.g. 'US'), or empty string
     */
    function resolveCountry(rec, recordType) {
        // Try address sublist first (vendor, customer, partner have addressbook)
        if (['vendor', 'customer', 'partner'].indexOf(recordType) !== -1) {
            try {
                const addrCount = rec.getLineCount({ sublistId: 'addressbook' });
                for (let i = 0; i < addrCount; i++) {
                    const isDefault = rec.getSublistValue({
                        sublistId: 'addressbook',
                        fieldId: 'defaultbilling',
                        line: i
                    });
                    if (isDefault === true || isDefault === 'T') {
                        const addrSubrec = rec.getSublistSubrecord({
                            sublistId: 'addressbook',
                            fieldId: 'addressbookaddress',
                            line: i
                        });
                        const country = addrSubrec.getValue({ fieldId: 'country' });
                        if (country) return String(country);
                    }
                }
                // Fall back to first address line if no default billing
                if (addrCount > 0) {
                    const addrSubrec = rec.getSublistSubrecord({
                        sublistId: 'addressbook',
                        fieldId: 'addressbookaddress',
                        line: 0
                    });
                    const country = addrSubrec.getValue({ fieldId: 'country' });
                    if (country) return String(country);
                }
            } catch (e) {
                log.debug({ title: MODULE, details: `Address country lookup failed: ${e.message}` });
            }
        }

        // Try subsidiary country (OneWorld)
        try {
            const subId = rec.getValue({ fieldId: 'subsidiary' });
            if (subId) {
                const subCountry = search.lookupFields({
                    type: 'subsidiary',
                    id: subId,
                    columns: ['country']
                });
                if (subCountry && subCountry.country) {
                    // subsidiary country is returned as [{value: 'US', text: 'United States'}]
                    let countryVal;
                    if (Array.isArray(subCountry.country) && subCountry.country.length > 0) {
                        countryVal = subCountry.country[0].value;
                    } else if (!Array.isArray(subCountry.country)) {
                        countryVal = subCountry.country;
                    }
                    if (countryVal) return String(countryVal);
                }
            }
        } catch (e) {
            log.debug({ title: MODULE, details: `Subsidiary country lookup failed: ${e.message}` });
        }

        // Fallback: runtime preference (company country)
        try {
            const companyCountry = runtime.getCurrentUser().getPreference({ name: 'COUNTRY' });
            if (companyCountry) return String(companyCountry);
        } catch (e) {
            // Ignore
        }

        return '';
    }

    // -------------------------------------------------------------------------
    // Address extraction from addressbook sublist
    // -------------------------------------------------------------------------

    /**
     * Extract address details from the addressbook sublist.
     * Prefers the default billing address; falls back to the first address line.
     *
     * @param {N/record.Record} rec - The loaded NetSuite record
     * @returns {Object|null} Address object with standardized field names, or null
     */
    function extractAddress(rec) {
        try {
            const addrCount = rec.getLineCount({ sublistId: 'addressbook' });
            if (addrCount <= 0) return null;

            // Find default billing address; fall back to line 0
            let targetLine = 0;
            for (let i = 0; i < addrCount; i++) {
                const isDefault = rec.getSublistValue({
                    sublistId: 'addressbook',
                    fieldId: 'defaultbilling',
                    line: i
                });
                if (isDefault === true || isDefault === 'T') {
                    targetLine = i;
                    break;
                }
            }

            const addrSubrec = rec.getSublistSubrecord({
                sublistId: 'addressbook',
                fieldId: 'addressbookaddress',
                line: targetLine
            });

            const addr = {
                addressLine1: addrSubrec.getValue({ fieldId: 'addr1' }) || '',
                addressLine2: addrSubrec.getValue({ fieldId: 'addr2' }) || '',
                addressLine3: addrSubrec.getValue({ fieldId: 'addr3' }) || '',
                city:         addrSubrec.getValue({ fieldId: 'city' }) || '',
                state:        addrSubrec.getValue({ fieldId: 'state' }) || '',
                postalCode:   addrSubrec.getValue({ fieldId: 'zip' }) || '',
                country:      addrSubrec.getValue({ fieldId: 'country' }) || '',
                addressee:    addrSubrec.getValue({ fieldId: 'addressee' }) || '',
                attention:    addrSubrec.getValue({ fieldId: 'attention' }) || ''
            };

            // Only return if we have at least one meaningful field
            if (addr.addressLine1 || addr.city || addr.postalCode || addr.country) {
                return addr;
            }
            return null;

        } catch (e) {
            log.debug({ title: MODULE, details: `Address extraction failed: ${e.message}` });
            return null;
        }
    }

    /**
     * Extract all addresses from the addressbook sublist (for bulk validation).
     *
     * @param {N/record.Record} rec - The loaded NetSuite record
     * @returns {Array<Object>} Array of address objects
     */
    function extractAllAddresses(rec) {
        const addresses = [];
        try {
            const addrCount = rec.getLineCount({ sublistId: 'addressbook' });
            for (let i = 0; i < addrCount; i++) {
                const addrSubrec = rec.getSublistSubrecord({
                    sublistId: 'addressbook',
                    fieldId: 'addressbookaddress',
                    line: i
                });

                const addr = {
                    line:         i,
                    label:        rec.getSublistValue({ sublistId: 'addressbook', fieldId: 'label', line: i }) || `Address ${i + 1}`,
                    defaultBill:  (function(v) { return v === true || v === 'T'; })(rec.getSublistValue({ sublistId: 'addressbook', fieldId: 'defaultbilling', line: i })),
                    defaultShip:  (function(v) { return v === true || v === 'T'; })(rec.getSublistValue({ sublistId: 'addressbook', fieldId: 'defaultshipping', line: i })),
                    addressLine1: addrSubrec.getValue({ fieldId: 'addr1' }) || '',
                    addressLine2: addrSubrec.getValue({ fieldId: 'addr2' }) || '',
                    addressLine3: addrSubrec.getValue({ fieldId: 'addr3' }) || '',
                    city:         addrSubrec.getValue({ fieldId: 'city' }) || '',
                    state:        addrSubrec.getValue({ fieldId: 'state' }) || '',
                    postalCode:   addrSubrec.getValue({ fieldId: 'zip' }) || '',
                    country:      addrSubrec.getValue({ fieldId: 'country' }) || ''
                };

                if (addr.addressLine1 || addr.city || addr.postalCode) {
                    addresses.push(addr);
                }
            }
        } catch (e) {
            log.debug({ title: MODULE, details: `All-address extraction failed: ${e.message}` });
        }
        return addresses;
    }

    // -------------------------------------------------------------------------
    // Bank details extraction
    // -------------------------------------------------------------------------

    /**
     * Extract bank account details from a vendor record.
     * NetSuite stores bank details on vendor records via the Electronic Funds
     * Transfer (EFT) fields or custom fields, depending on the account setup.
     *
     * Standard EFT fields on vendor:
     *   - accountnumber (body field for primary account)
     *   - routingnumber (body field for primary routing)
     *
     * For multi-bank setups, bank details may be on a custom sublist or
     * custom fields. This function handles the standard body fields.
     *
     * @param {N/record.Record} rec - The loaded NetSuite record
     * @param {string} recordType - Record type internal ID
     * @returns {Object|null} Bank details object, or null if none found
     */
    function extractBankDetails(rec, recordType) {
        // Bank details are primarily relevant for vendors
        if (['vendor', 'customer'].indexOf(recordType) === -1) {
            return null;
        }

        try {
            const bankDetails = {};

            // Standard vendor bank fields
            const accountNumber = rec.getValue({ fieldId: 'accountnumber' });
            const routingNumber = rec.getValue({ fieldId: 'routingnumber' });

            if (accountNumber) bankDetails.accountNumber = String(accountNumber);
            if (routingNumber) bankDetails.routingNumber = String(routingNumber);

            // IBAN field (used in many international setups)
            try {
                const iban = rec.getValue({ fieldId: 'custentity_iban' });
                if (iban) bankDetails.iban = String(iban);
            } catch (e) {
                // Custom field may not exist in all accounts
            }

            // SWIFT/BIC code
            try {
                const swift = rec.getValue({ fieldId: 'custentity_swift_bic' });
                if (swift) bankDetails.swiftBic = String(swift);
            } catch (e) {
                // Custom field may not exist
            }

            // Bank name
            try {
                const bankName = rec.getValue({ fieldId: 'custentity_bank_name' });
                if (bankName) bankDetails.bankName = String(bankName);
            } catch (e) {
                // Custom field may not exist
            }

            if (Object.keys(bankDetails).length > 0) {
                return bankDetails;
            }
            return null;

        } catch (e) {
            log.debug({ title: MODULE, details: `Bank details extraction failed: ${e.message}` });
            return null;
        }
    }

    // -------------------------------------------------------------------------
    // Record field extraction helper
    // -------------------------------------------------------------------------

    /**
     * Extract mapped body fields from a record according to FIELD_MAP.
     *
     * @param {N/record.Record} rec - The loaded NetSuite record
     * @param {string} recordType - Record type internal ID
     * @returns {Object} Key-value pairs of extracted field values
     */
    function extractFields(rec, recordType) {
        const mapping = FIELD_MAP[recordType];
        if (!mapping) return {};

        const fields = {};
        for (const [apiField, nsField] of Object.entries(mapping)) {
            try {
                const val = rec.getValue({ fieldId: nsField });
                if (val !== null && val !== undefined && val !== '') {
                    fields[apiField] = String(val);
                }
            } catch (e) {
                // Field may not exist on all record types or editions
                log.debug({ title: MODULE, details: `Field ${nsField} not available: ${e.message}` });
            }
        }
        return fields;
    }

    // -------------------------------------------------------------------------
    // Entity name resolution
    // -------------------------------------------------------------------------

    /**
     * Build a display-friendly entity name from record fields.
     *
     * @param {Object} fields - Extracted fields from extractFields()
     * @param {string} recordType - Record type internal ID
     * @returns {string} Entity name
     */
    function resolveEntityName(fields, recordType) {
        if (['employee', 'contact'].indexOf(recordType) !== -1) {
            const parts = [fields.firstName, fields.lastName].filter(Boolean);
            return parts.join(' ') || fields.entityId || '';
        }
        return fields.companyName || fields.legalName || fields.entityId || '';
    }

    // -------------------------------------------------------------------------
    // Individual validation runners
    // -------------------------------------------------------------------------

    /**
     * Run tax ID validation.
     * @returns {Object} Validation result entry
     */
    function runTaxValidation(fields, country) {
        const result = { type: 'tax', passed: false, skipped: false, error: null, response: null };

        const taxId = fields.taxId;
        if (!taxId) {
            result.skipped = true;
            result.reason = 'No tax ID on record';
            return result;
        }

        try {
            const taxType = detectTaxType(country);
            const response = api.validateTax({
                identityNumber: taxId,
                identityNumberType: taxType,
                country:        country,
                entityName:     fields.companyName || fields.entityId || ''
            });

            result.response = response;
            result.passed = response && response.isValid === true;
            if (!result.passed && response) {
                result.reason = response.message || response.statusMessage || 'Tax validation failed';
            }
        } catch (e) {
            result.error = e.message;
            log.error({ title: MODULE, details: `Tax validation error: ${e.message}` });
        }

        return result;
    }

    /**
     * Run bank account validation.
     * @returns {Object} Validation result entry
     */
    function runBankValidation(bankDetails, country) {
        const result = { type: 'bank', passed: false, skipped: false, error: null, response: null };

        if (!bankDetails) {
            result.skipped = true;
            result.reason = 'No bank details on record';
            return result;
        }

        try {
            const params = { country: country };

            if (bankDetails.accountNumber) {
                params.accountNumber = bankDetails.accountNumber;
                if (bankDetails.routingNumber) {
                    params.routingNumber = bankDetails.routingNumber;
                }
            }
            if (bankDetails.iban) {
                params.iban = bankDetails.iban;
            }
            if (!bankDetails.accountNumber && !bankDetails.iban) {
                result.skipped = true;
                result.reason = 'No account number or IBAN available';
                return result;
            }

            if (bankDetails.swiftBic) params.swiftCode = bankDetails.swiftBic;

            const response = api.validateBank(params);
            result.response = response;
            result.passed = response && response.isValid === true;
            if (!result.passed && response) {
                result.reason = response.message || response.statusMessage || 'Bank validation failed';
            }
        } catch (e) {
            result.error = e.message;
            log.error({ title: MODULE, details: `Bank validation error: ${e.message}` });
        }

        return result;
    }

    /**
     * Run address validation.
     * @returns {Object} Validation result entry
     */
    function runAddressValidation(address) {
        const result = { type: 'address', passed: false, skipped: false, error: null, response: null };

        if (!address) {
            result.skipped = true;
            result.reason = 'No address on record';
            return result;
        }

        // Capture the original address for comparison by the client script
        result.original = {
            addr1:    address.addressLine1,
            addr2:    address.addressLine2,
            addr3:    address.addressLine3,
            city:     address.city,
            state:    address.state,
            zip:      address.postalCode,
            country:  address.country
        };

        try {
            const response = api.validateAddress({
                addressLine1: address.addressLine1,
                addressLine2: address.addressLine2,
                city:         address.city,
                state:        address.state,
                postalCode:   address.postalCode,
                country:      address.country
            });

            result.response = response;
            result.passed = response && (response.isValid === true || response.verificationLevel === 'verified');
            if (!result.passed && response) {
                result.reason = response.message || response.statusMessage || 'Address validation failed';
            }
            // Include suggested address if available
            if (response && response.suggestedAddress) {
                result.suggestedAddress = response.suggestedAddress;
            }

            // Build corrected address from the API response for accept/reject flow
            if (response) {
                result.corrected = {
                    addr1:    response.addressLine1 || '',
                    addr2:    response.addressLine2 || '',
                    addr3:    response.addressLine3 || '',
                    city:     response.city || '',
                    state:    response.state || '',
                    zip:      response.postalCode || '',
                    country:  response.country || address.country || ''
                };

                // Determine if the corrected address differs from the original
                const orig = result.original;
                const corr = result.corrected;
                result.addressCorrected = (
                    (orig.addr1 || '').toUpperCase()   !== (corr.addr1 || '').toUpperCase() ||
                    (orig.addr2 || '').toUpperCase()   !== (corr.addr2 || '').toUpperCase() ||
                    (orig.addr3 || '').toUpperCase()   !== (corr.addr3 || '').toUpperCase() ||
                    (orig.city || '').toUpperCase()     !== (corr.city || '').toUpperCase() ||
                    (orig.state || '').toUpperCase()    !== (corr.state || '').toUpperCase() ||
                    (orig.zip || '').toUpperCase()      !== (corr.zip || '').toUpperCase() ||
                    (orig.country || '').toUpperCase()  !== (corr.country || '').toUpperCase()
                );
            } else {
                result.addressCorrected = false;
            }
        } catch (e) {
            result.error = e.message;
            result.addressCorrected = false;
            log.error({ title: MODULE, details: `Address validation error: ${e.message}` });
        }

        return result;
    }

    /**
     * Run sanctions screening.
     * @returns {Object} Validation result entry
     */
    function runSanctionsScreening(fields, recordType) {
        const result = { type: 'sanctions', passed: false, skipped: false, error: null, response: null };

        const entityName = resolveEntityName(fields, recordType);
        if (!entityName) {
            result.skipped = true;
            result.reason = 'No entity name for sanctions screening';
            return result;
        }

        try {
            const params = { companyName: entityName };

            // Add individual name fields for person record types
            if (['employee', 'contact'].indexOf(recordType) !== -1) {
                if (fields.firstName) params.firstName = fields.firstName;
                if (fields.lastName) params.lastName = fields.lastName;
                params.businessEntityType = 'individual';
            } else {
                params.businessEntityType = 'organization';
            }

            const response = api.screenSanctions(params);
            result.response = response;
            // Passed means no matches found
            result.passed = response && (response.matchCount === 0 || response.matches === null || (Array.isArray(response.matches) && response.matches.length === 0));
            if (!result.passed && response) {
                result.reason = `${response.matchCount || 'Unknown number of'} potential sanctions match(es) found`;
                result.matches = response.matches;
            }
        } catch (e) {
            result.error = e.message;
            log.error({ title: MODULE, details: `Sanctions screening error: ${e.message}` });
        }

        return result;
    }

    /**
     * Run disqualified directors check.
     * @returns {Object} Validation result entry
     */
    function runDirectorsCheck(fields, recordType, country, rec) {
        const result = { type: 'directors', passed: false, skipped: false, error: null, response: null };

        if (!country) {
            result.skipped = true;
            result.reason = 'Country required for directors check';
            return result;
        }

        // For employee/contact records, use firstName/lastName from FIELD_MAP.
        // For vendor/customer/partner (company types), try reading firstname/lastname
        // from the record directly — these exist on individual/person-type records
        // in NetSuite (e.g. individual vendors).
        let firstName = fields.firstName || '';
        let lastName  = fields.lastName  || '';

        if (!firstName && !lastName && rec) {
            try {
                const fn = rec.getValue({ fieldId: 'firstname' });
                const ln = rec.getValue({ fieldId: 'lastname' });
                if (fn) firstName = String(fn);
                if (ln) lastName = String(ln);
            } catch (e) {
                // firstname/lastname fields not present on this record type — expected for company records
            }
        }

        // Directors check requires individual names, not company names
        if (!firstName && !lastName) {
            result.skipped = true;
            result.reason = 'No individual name available for directors check (requires firstName + lastName)';
            return result;
        }

        try {
            const response = api.validateDisqualifiedDirectors({
                firstName:  firstName,
                lastName:   lastName,
                country:    country
            });

            result.response = response;
            result.passed = response && (response.isDisqualified === false || response.matchCount === 0);
            if (!result.passed && response) {
                result.reason = response.message || 'Disqualified directors found';
            }
        } catch (e) {
            result.error = e.message;
            log.error({ title: MODULE, details: `Directors check error: ${e.message}` });
        }

        return result;
    }

    /**
     * Run email validation.
     * @returns {Object} Validation result entry
     */
    function runEmailValidation(fields) {
        const result = { type: 'email', passed: false, skipped: false, error: null, response: null };

        const email = fields.email;
        if (!email) {
            result.skipped = true;
            result.reason = 'No email address on record';
            return result;
        }

        try {
            const response = api.validateEmail({ emailAddress: email });

            result.response = response;
            result.passed = response && response.isValid === true;
            if (!result.passed && response) {
                result.reason = response.message || response.statusMessage || 'Email validation failed';
            }
            if (response && response.isDisposable) {
                result.warnings = result.warnings || [];
                result.warnings.push('Disposable email address detected');
            }
        } catch (e) {
            result.error = e.message;
            log.error({ title: MODULE, details: `Email validation error: ${e.message}` });
        }

        return result;
    }

    /**
     * Run phone number validation.
     * @returns {Object} Validation result entry
     */
    function runPhoneValidation(fields, country) {
        const result = { type: 'phone', passed: false, skipped: false, error: null, response: null };

        const phone = fields.phone || fields.mobilePhone;
        if (!phone) {
            result.skipped = true;
            result.reason = 'No phone number on record';
            return result;
        }
        if (!country) {
            result.skipped = true;
            result.reason = 'Country required for phone validation';
            return result;
        }

        try {
            const response = api.validatePhone({
                phoneNumber: phone,
                country:     country
            });

            result.response = response;
            result.passed = response && response.isValid === true;
            if (!result.passed && response) {
                result.reason = response.message || response.statusMessage || 'Phone validation failed';
            }
        } catch (e) {
            result.error = e.message;
            log.error({ title: MODULE, details: `Phone validation error: ${e.message}` });
        }

        return result;
    }

    /**
     * Run entity risk assessment.
     * @returns {Object} Validation result entry
     */
    function runRiskAssessment(fields, recordType, country) {
        const result = { type: 'risk', passed: false, skipped: false, error: null, response: null };

        const entityName = resolveEntityName(fields, recordType);
        if (!entityName) {
            result.skipped = true;
            result.reason = 'No entity name for risk assessment';
            return result;
        }

        try {
            const params = {
                companyName: entityName,
                CountryOfIncorporation: country
            };

            if (fields.businessEntityType) params.businessEntityType = fields.businessEntityType;

            const response = api.assessEntityRisk(params);
            result.response = response;
            // Risk assessment passes if risk level is low or medium (configurable)
            result.passed = response && ['low', 'medium'].indexOf((response.riskLevel || '').toLowerCase()) !== -1;
            if (!result.passed && response) {
                result.reason = `Risk level: ${response.riskLevel || 'unknown'}`;
                result.riskScore = response.riskScore;
            }
        } catch (e) {
            result.error = e.message;
            log.error({ title: MODULE, details: `Risk assessment error: ${e.message}` });
        }

        return result;
    }

    // -------------------------------------------------------------------------
    // Main orchestration
    // -------------------------------------------------------------------------

    /**
     * Validate a NetSuite record against all enabled QubitOn validation rules.
     *
     * This is the main entry point for Layer 3 scripts (User Event, Suitelet,
     * Scheduled Script). It loads config, extracts data, runs each enabled
     * validation in sequence, and returns a consolidated result.
     *
     * @param {N/record.Record} rec - The loaded NetSuite record
     * @param {string} recordType - Record type internal ID
     *     (vendor, customer, employee, partner, contact)
     * @returns {Object} Consolidated validation result:
     *   {
     *     validated: boolean,    // Whether validation was attempted
     *     passed: boolean,       // True if all enabled validations passed
     *     stopSave: boolean,     // True if record save should be blocked
     *     recordType: string,    // Echo back the record type
     *     country: string,       // Resolved country code
     *     entityName: string,    // Resolved entity name
     *     validations: Array,    // Per-validation results
     *     summary: {             // Counts
     *       total: number,
     *       passed: number,
     *       failed: number,
     *       skipped: number,
     *       errors: number
     *     }
     *   }
     */
    function validateRecord(rec, recordType) {
        const startTime = Date.now();

        const output = {
            validated:   false,
            passed:      true,
            stopSave:    false,
            recordType:  recordType,
            country:     '',
            entityName:  '',
            validations: [],
            summary:     { total: 0, passed: 0, failed: 0, skipped: 0, errors: 0 },
            durationMs:  0
        };

        // Load config
        const config = loadValidationConfig(recordType);
        if (!config) {
            output.reason = 'No config found for this record type';
            log.debug({ title: MODULE, details: output.reason });
            return output;
        }

        output.validated = true;

        // Extract data from record
        const fields      = extractFields(rec, recordType);
        const country     = resolveCountry(rec, recordType);
        const address     = extractAddress(rec);
        const bankDetails = extractBankDetails(rec, recordType);

        output.country    = country;
        output.entityName = resolveEntityName(fields, recordType);

        log.audit({
            title: MODULE,
            details: `Validating ${recordType} "${output.entityName}" (country: ${country || 'unknown'})`
        });

        // Run each enabled validation
        const validationRuns = [];

        if (config.validateTax) {
            validationRuns.push(function () { return runTaxValidation(fields, country); });
        }
        if (config.validateBank) {
            validationRuns.push(function () { return runBankValidation(bankDetails, country); });
        }
        if (config.validateAddress) {
            validationRuns.push(function () { return runAddressValidation(address); });
        }
        if (config.validateSanctions) {
            validationRuns.push(function () { return runSanctionsScreening(fields, recordType); });
        }
        if (config.validateDirectors) {
            validationRuns.push(function () { return runDirectorsCheck(fields, recordType, country, rec); });
        }
        if (config.validateEmail) {
            validationRuns.push(function () { return runEmailValidation(fields); });
        }
        if (config.validatePhone) {
            validationRuns.push(function () { return runPhoneValidation(fields, country); });
        }
        if (config.validateRisk) {
            validationRuns.push(function () { return runRiskAssessment(fields, recordType, country); });
        }

        // Execute validations sequentially; one failure does not block others
        for (const runFn of validationRuns) {
            try {
                const valResult = runFn();
                output.validations.push(valResult);
                output.summary.total++;

                if (valResult.skipped) {
                    output.summary.skipped++;
                } else if (valResult.error) {
                    output.summary.errors++;
                    output.passed = false;
                } else if (valResult.passed) {
                    output.summary.passed++;
                } else {
                    output.summary.failed++;
                    output.passed = false;
                }
            } catch (e) {
                // Defensive: should not happen since each runner has its own try/catch
                log.error({ title: MODULE, details: `Unexpected validation error: ${e.message}` });
                output.validations.push({
                    type: 'unknown',
                    passed: false,
                    error: e.message
                });
                output.summary.total++;
                output.summary.errors++;
            }
        }

        // Determine whether to block record save
        if (config.stopOnFail && !output.passed) {
            output.stopSave = true;
        }

        output.durationMs = Date.now() - startTime;

        log.audit({
            title: MODULE,
            details: `Validation complete for ${recordType} "${output.entityName}": ` +
                     `passed=${output.passed}, total=${output.summary.total}, ` +
                     `failed=${output.summary.failed}, skipped=${output.summary.skipped}, ` +
                     `errors=${output.summary.errors}, duration=${output.durationMs}ms`
        });

        return output;
    }

    // -------------------------------------------------------------------------
    // Convenience methods
    // -------------------------------------------------------------------------

    /**
     * Validate a vendor record.
     * @param {N/record.Record} rec - Loaded vendor record
     * @returns {Object} Validation result
     */
    function validateVendor(rec) {
        return validateRecord(rec, 'vendor');
    }

    /**
     * Validate a customer record.
     * @param {N/record.Record} rec - Loaded customer record
     * @returns {Object} Validation result
     */
    function validateCustomer(rec) {
        return validateRecord(rec, 'customer');
    }

    /**
     * Validate an employee record.
     * @param {N/record.Record} rec - Loaded employee record
     * @returns {Object} Validation result
     */
    function validateEmployee(rec) {
        return validateRecord(rec, 'employee');
    }

    /**
     * Validate a partner record.
     * @param {N/record.Record} rec - Loaded partner record
     * @returns {Object} Validation result
     */
    function validatePartner(rec) {
        return validateRecord(rec, 'partner');
    }

    /**
     * Validate a contact record.
     * @param {N/record.Record} rec - Loaded contact record
     * @returns {Object} Validation result
     */
    function validateContact(rec) {
        return validateRecord(rec, 'contact');
    }

    /**
     * Load a record by type/ID and validate it. Convenience for Suitelets,
     * scheduled scripts, and RESTlets that receive record identifiers rather
     * than loaded record objects.
     *
     * @param {string} recordType - NetSuite record type internal ID
     * @param {number|string} recordId - Internal ID of the record
     * @returns {Object} Validation result
     */
    function validateAll(recordType, recordId) {
        const rec = record.load({
            type: recordType,
            id:   recordId,
            isDynamic: false
        });
        return validateRecord(rec, recordType);
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    return {
        // Main orchestration
        validateRecord:     validateRecord,
        validateAll:        validateAll,

        // Per-type convenience
        validateVendor:     validateVendor,
        validateCustomer:   validateCustomer,
        validateEmployee:   validateEmployee,
        validatePartner:    validatePartner,
        validateContact:    validateContact,

        // Config
        loadValidationConfig: loadValidationConfig,
        clearConfigCache:     clearConfigCache,

        // Utilities (exported for Layer 3 / testing)
        detectTaxType:      detectTaxType,
        resolveCountry:     resolveCountry,
        extractAddress:     extractAddress,
        extractAllAddresses: extractAllAddresses,
        extractBankDetails: extractBankDetails,
        extractFields:      extractFields,
        resolveEntityName:  resolveEntityName,

        // Constants
        FIELD_MAP:            FIELD_MAP,
        TAX_TYPE_BY_COUNTRY:  TAX_TYPE_BY_COUNTRY
    };
});
