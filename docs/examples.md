# Code Examples

Complete SuiteScript 2.1 examples for all 42 QubitOn API methods. Each example shows the exact method name and parameters as exported by the API client.

## Prerequisites

All examples assume the QubitOn connector is installed and configured. Import the API client module:

```javascript
/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['/SuiteScripts/QubitOn/qubiton_api_client'], function (api) {

    api.loadConfig();

    // Examples below use the `api` reference
});
```

---

## Validation (18 methods)

### 1. validateAddress

Address validation across 249 countries. USPS-certified for US addresses.

```javascript
var result = api.validateAddress({
    addressLine1: '1600 Pennsylvania Ave NW',
    addressLine2: '',
    city: 'Washington',
    state: 'DC',
    postalCode: '20500',
    country: 'US'
});

log.debug('Valid', result.isValid);
log.debug('Standardized', result.standardizedAddress);
```

**Required fields**: `addressLine1`, `city`, `country`

### 2. validateTax

Tax ID validation against government registries.

```javascript
var result = api.validateTax({
    identityNumber: 'DE123456789',
    identityNumberType: 'VAT',
    country: 'DE',
    entityName: 'Acme GmbH',
    businessEntityType: 'Corporation'
});

log.debug('Valid', result.isValid);
log.debug('Registered name', result.registeredName);
```

**Required fields**: `identityNumber`, `country`

### 3. validateBank

Bank account validation (routing numbers, IBANs, SWIFT/BIC).

```javascript
var result = api.validateBank({
    accountNumber: '123456789',
    routingNumber: '021000021',
    iban: '',
    swiftCode: '',
    bankCode: '',
    bankAccountHolder: 'Acme Corp',
    bankNumberType: '',
    businessEntityType: '',
    country: 'US'
});

log.debug('Valid', result.isValid);
log.debug('Bank name', result.bankName);
```

**Required fields**: `accountNumber`, `country`

### 4. validateBankPro

Enhanced bank validation with account name matching.

```javascript
var result = api.validateBankPro({
    accountNumber: '31926819',
    iban: 'GB29NWBK60161331926819',
    swiftCode: 'NWBKGB2L',
    bankAccountHolder: 'Acme Corp Ltd',
    country: 'GB'
});

log.debug('Valid', result.isValid);
log.debug('Name match', result.nameMatch);
```

**Required fields**: `accountNumber`, `country`

### 5. validatePhone

Phone number validation and formatting.

```javascript
var result = api.validatePhone({
    phoneNumber: '+1-555-123-4567',
    country: 'US',
    phoneExtension: '100'
});

log.debug('Valid', result.isValid);
log.debug('Line type', result.lineType);
log.debug('Formatted', result.internationalFormat);
```

**Required fields**: `phoneNumber`, `country`

### 6. validateEmail

Email deliverability and domain validation.

```javascript
var result = api.validateEmail({
    emailAddress: 'john.doe@example.com'
});

log.debug('Deliverable', result.isDeliverable);
log.debug('Disposable', result.isDisposable);
log.debug('Role-based', result.isRoleBased);
```

**Required fields**: `emailAddress`

### 7. validateInIdentity

Indian identity number validation (PAN, Aadhaar, GSTIN).

```javascript
var result = api.validateInIdentity({
    identityNumber: '22AAAAA0000A1Z5',
    identityNumberType: 'GSTIN',
    entityName: 'Acme India Pvt Ltd',
    dob: '1990-01-15'
});

log.debug('Valid', result.isValid);
log.debug('Entity name', result.entityName);
```

**Required fields**: `identityNumber`, `identityNumberType`, `entityName`

### 8. validateTaxFormat

Tax ID format-only validation (structure check, no live registry lookup). Fast -- suitable for Client Scripts.

```javascript
var result = api.validateTaxFormat({
    identityNumber: '12-3456789',
    identityNumberType: 'EIN',
    countryIso2: 'US'
});

log.debug('Format valid', result.isValid);
log.debug('Expected format', result.expectedFormat);
```

**Required fields**: `identityNumber`, `identityNumberType`, `countryIso2`

### 9. getSupportedTaxFormats

Returns all countries with supported tax ID format validation. No parameters.

```javascript
var result = api.getSupportedTaxFormats();

log.debug('Countries supported', JSON.stringify(result));
```

### 10. validateCertification

Business certification validation.

```javascript
var result = api.validateCertification({
    companyName: 'Acme Corp',
    country: 'US',
    certificationNumber: 'MBE-2024-12345',
    certificationType: 'MBE',
    certificationGroup: 'Diversity',
    identityType: 'EIN'
});

log.debug('Valid', result.isValid);
log.debug('Expiry', result.expiryDate);
```

**Required fields**: `companyName`, `country`, `certificationNumber`

### 11. validateDisqualifiedDirectors

Disqualified director screening against government databases.

```javascript
var result = api.validateDisqualifiedDirectors({
    firstName: 'Robert',
    lastName: 'Johnson',
    country: 'GB',
    middleName: 'A'
});

log.debug('Disqualified', result.isDisqualified);
log.debug('Details', JSON.stringify(result.disqualifications));
```

**Required fields**: `firstName`, `lastName`, `country`

### 12. validateEpaProsecution

EPA criminal prosecution records check.

```javascript
var result = api.validateEpaProsecution({
    name: 'Industrial Corp',
    state: 'TX',
    fiscalYear: '2024'
});

log.debug('Has violations', result.hasViolations);
```

**Required fields**: `name`

### 13. validateProviderExclusion

Healthcare provider exclusion status check (OIG/GSA).

```javascript
var result = api.validateProviderExclusion({
    healthCareType: 'HCP',
    lastName: 'Smith',
    firstName: 'John',
    entityName: '',
    address: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    zipCode: '62701'
});

log.debug('Excluded', result.isExcluded);
```

**Required fields**: none (all optional, but at least one name field recommended)

### 14. validateNpi

National Provider Identifier (NPI) validation.

```javascript
var result = api.validateNpi({
    npi: '1234567890',
    organizationName: 'Springfield Medical',
    lastName: 'Smith',
    firstName: 'John',
    middleName: 'A'
});

log.debug('Valid', result.isValid);
log.debug('Provider name', result.providerName);
log.debug('Specialty', result.specialty);
```

**Required fields**: `npi`

### 15. validateMedpass

MEDPASS (Medicare/Medicaid provider screening) validation.

```javascript
var result = api.validateMedpass({
    id: '1234567890',
    businessEntityType: 'HCP',
    companyName: 'Springfield Medical',
    country: 'US'
});

log.debug('Found', result.isFound);
log.debug('Status', result.status);
```

**Required fields**: `id`, `businessEntityType`

### 16. validateEsgScore

ESG (Environmental, Social, Governance) score retrieval.

```javascript
var result = api.validateEsgScore({
    companyName: 'Acme Corp',
    esgId: 12345
});

log.debug('Overall', result.overallScore);
log.debug('Environmental', result.environmentalScore);
log.debug('Social', result.socialScore);
log.debug('Governance', result.governanceScore);
```

**Required fields**: `companyName`

### 17. validateIpQuality

IP address quality and reputation check.

```javascript
var result = api.validateIpQuality({
    ipAddress: '203.0.113.42'
});

log.debug('Risk score', result.riskScore);
log.debug('Is proxy', result.isProxy);
log.debug('Is VPN', result.isVpn);
```

**Required fields**: `ipAddress`

### 18. validatePeppolId

Peppol participant ID validation for e-invoicing.

```javascript
var result = api.validatePeppolId({
    participantId: '0007:5567321707',
    directoryLookup: true
});

log.debug('Registered', result.isRegistered);
log.debug('Endpoint', result.endpointUrl);
```

**Required fields**: `participantId`

---

## Enrichment / Lookup (10 methods)

### 19. getPeppolSchemes

Returns available Peppol identifier schemes. No parameters.

```javascript
var result = api.getPeppolSchemes();

log.debug('Schemes', result.schemes.length);
result.schemes.forEach(function (scheme) {
    log.debug('Scheme', scheme.id + ': ' + scheme.name + ' (' + scheme.country + ')');
});
```

### 20. lookupBusinessRegistration

Company registration lookup.

```javascript
var result = api.lookupBusinessRegistration({
    entityName: 'Acme Corporation',
    country: 'GB',
    state: 'London',
    city: 'London'
});

log.debug('Status', result.registrationStatus);
log.debug('Incorporation date', result.incorporationDate);
```

**Required fields**: `entityName`, `country`

### 21. lookupDunsNumber

D-U-N-S number lookup.

```javascript
var result = api.lookupDunsNumber({
    dunsNumber: '123456789'
});

log.debug('Company', result.companyName);
log.debug('DUNS', result.dunsNumber);
log.debug('Tradestyle', result.tradestyle);
```

**Required fields**: `dunsNumber`

### 22. lookupBusinessClassification

SIC/NAICS/UNSPSC classification lookup.

```javascript
var result = api.lookupBusinessClassification({
    companyName: 'Acme Corp',
    city: 'New York',
    state: 'NY',
    country: 'US',
    address1: '123 Main St',
    address2: 'Suite 100',
    phone: '555-123-4567',
    postalCode: '10001'
});

log.debug('SIC', result.sicCode);
log.debug('NAICS', result.naicsCode);
log.debug('Industry', result.industryDescription);
```

**Required fields**: `companyName`, `city`, `state`, `country`

### 23. lookupCorporateHierarchy

Corporate parent/subsidiary structure lookup.

```javascript
var result = api.lookupCorporateHierarchy({
    companyName: 'Acme Corp',
    addressLine1: '123 Main St',
    city: 'New York',
    state: 'NY',
    zipCode: '10001'
});

log.debug('Parent', result.ultimateParent);
log.debug('Subsidiaries', result.subsidiaries.length);
```

**Required fields**: `companyName`, `addressLine1`, `city`, `state`, `zipCode`

### 24. lookupCompanyHierarchy

Company hierarchy lookup by identifier (DUNS, EIN, etc.).

```javascript
var result = api.lookupCompanyHierarchy({
    identifier: '123456789',
    identifierType: 'DUNS',
    country: 'US',
    options: ''
});

log.debug('Tree depth', result.depth);
log.debug('Family members', result.familyMembers.length);
```

**Required fields**: `identifier`, `identifierType`

### 25. lookupBeneficialOwnership

Beneficial ownership information.

```javascript
var result = api.lookupBeneficialOwnership({
    companyName: 'Acme Corp',
    countryIso2: 'GB',
    uboThreshold: '25',
    maxLayers: '3'
});

log.debug('Owners', JSON.stringify(result.beneficialOwners));
```

**Required fields**: `companyName`, `countryIso2`

### 26. lookupCertification

Certification search by company.

```javascript
var result = api.lookupCertification({
    companyName: 'Acme Corp',
    country: 'US',
    identityType: 'EIN'
});

log.debug('Certifications found', result.certifications.length);
```

**Required fields**: `companyName`, `country`

### 27. identifyGender

Gender identification from name.

```javascript
var result = api.identifyGender({
    name: 'Andrea',
    country: 'IT'
});

log.debug('Gender', result.gender);
log.debug('Probability', result.probability);
```

**Required fields**: `name`

### 28. lookupAribaSupplierProfile

Ariba supplier profile lookup by ANID.

```javascript
var result = api.lookupAribaSupplierProfile({
    anid: 'AN01234567890'
});

log.debug('Profile', result.companyProfile);
log.debug('Revenue range', result.revenueRange);
log.debug('Employee count', result.employeeCount);
```

**Required fields**: `anid`

---

## Risk & Compliance (7 methods)

### 29. screenSanctions

Global sanctions screening against OFAC, EU, UN, and UK HMT lists.

```javascript
var result = api.screenSanctions({
    companyName: 'Acme Corp',
    businessEntityType: 'Corporation',
    country: 'US',
    firstName: '',
    middleName: '',
    lastName: '',
    identityNumber: '',
    addressLine1: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62701',
    threshold: 0.8
});

log.debug('Match found', result.hasMatch);
log.debug('Matches', JSON.stringify(result.matches));
```

**Required fields**: `companyName`

### 30. screenPep

Politically Exposed Person (PEP) screening.

```javascript
var result = api.screenPep({
    name: 'Jane Doe',
    country: 'US'
});

log.debug('PEP match', result.hasMatch);
log.debug('Risk level', result.riskLevel);
```

**Required fields**: `name`, `country`

### 31. assessEntityRisk

Entity fraud / risk assessment. **Note**: This endpoint uses PascalCase field names.

```javascript
var result = api.assessEntityRisk({
    CompanyName: 'Acme Corp',
    CountryOfIncorporation: 'US',
    BusinessEntityType: 'Corporation'
});

log.debug('Overall risk', result.overallRisk);
log.debug('Risk factors', JSON.stringify(result.riskFactors));
```

**Required fields**: `CompanyName` (PascalCase)

### 32. lookupCreditAnalysis

Detailed credit analysis report.

```javascript
var result = api.lookupCreditAnalysis({
    companyName: 'Acme Corp',
    addressLine1: '123 Main St',
    addressLine2: 'Suite 100',
    city: 'New York',
    state: 'NY',
    postalCode: '10001',
    country: 'US',
    dunsNumber: '123456789'
});

log.debug('Credit limit', result.suggestedCreditLimit);
log.debug('Payment index', result.paymentIndex);
```

**Required fields**: `companyName`, `addressLine1`, `city`, `state`, `country`

### 33. lookupCreditScore

Company credit score lookup. Uses `/api/risk/lookup` with category `"Credit Score"` (auto-set by the client).

```javascript
var result = api.lookupCreditScore({
    entityName: 'Acme Corp',
    country: 'US',
    addressLine1: '123 Main St',
    city: 'New York',
    state: 'NY',
    postalCode: '10001'
});

log.debug('Credit score', result.score);
log.debug('Risk rating', result.riskRating);
```

**Required fields**: `entityName`

### 34. lookupBankruptcy

Bankruptcy records lookup. Uses `/api/risk/lookup` with category `"Bankruptcy"` (auto-set by the client).

```javascript
var result = api.lookupBankruptcy({
    entityName: 'Acme Corp',
    country: 'US',
    addressLine1: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62701'
});

log.debug('Bankruptcy found', result.hasBankruptcy);
log.debug('Chapter', result.chapter);
```

**Required fields**: `entityName`

### 35. lookupFailRate

Payment failure rate lookup. Uses `/api/risk/lookup` with category `"Fail Rate"` (auto-set by the client).

```javascript
var result = api.lookupFailRate({
    entityName: 'Acme Corp',
    country: 'US',
    addressLine1: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62701'
});

log.debug('Fail rate', result.failRate);
log.debug('Industry average', result.industryAverage);
```

**Required fields**: `entityName`

---

## Industry (3 methods)

### 36. lookupDotMotorCarrier

DOT/FMCSA motor carrier information lookup.

```javascript
var result = api.lookupDotMotorCarrier({
    dotNumber: '123456',
    entityName: 'Acme Trucking Inc'
});

log.debug('Legal name', result.legalName);
log.debug('Operating status', result.operatingStatus);
log.debug('Safety rating', result.safetyRating);
```

**Required fields**: `dotNumber`

### 37. lookupProviderExclusion

Healthcare provider exclusion records lookup.

```javascript
var result = api.lookupProviderExclusion({
    healthCareType: 'HCO',
    entityName: 'Springfield Medical Group',
    lastName: '',
    firstName: '',
    address: '456 Oak Ave',
    city: 'Springfield',
    state: 'IL',
    zipCode: '62701'
});

log.debug('Exclusion details', JSON.stringify(result.exclusions));
```

**Required fields**: none (all optional, but at least one identifier recommended)

### 38. validateAribaSupplierProfile

Ariba supplier profile validation by ANID.

```javascript
var result = api.validateAribaSupplierProfile({
    anid: 'AN01234567890'
});

log.debug('Match confidence', result.confidence);
log.debug('Discrepancies', JSON.stringify(result.discrepancies));
```

**Required fields**: `anid`

---

## Financial (4 methods)

### 39. getExchangeRates

Currency exchange rates (current and historical). The `baseCurrency` is used as a URL path parameter; `dates` is an array of date strings sent as the request body.

```javascript
var result = api.getExchangeRates({
    baseCurrency: 'USD',
    dates: ['2024-01-15', '2024-06-15', '2024-12-15']
});

log.debug('Rates', JSON.stringify(result.rates));
log.debug('As of', result.asOfDate);
```

**Required fields**: `baseCurrency`

### 40. analyzePaymentTerms

Payment terms analysis for early-pay discount optimization.

```javascript
var result = api.analyzePaymentTerms({
    currentPayTerm: 'Net 30',
    annualSpend: 500000,
    avgDaysPay: 35,
    savingsRate: 0.02,
    threshold: 0.01,
    vendorName: 'Acme Corp'
});

log.debug('Standard terms', result.standardTerms);
log.debug('Discount opportunity', result.earlyPaymentDiscount);
```

**Required fields**: `currentPayTerm`, `annualSpend`

### 41. lookupDomainSecurity

Domain cybersecurity report.

```javascript
var result = api.lookupDomainSecurity({
    domain: 'example.com'
});

log.debug('Security grade', result.grade);
log.debug('SSL valid', result.sslValid);
log.debug('Threats detected', result.threatsDetected);
```

**Required fields**: `domain`

---

## Utility

### 42. callApi

Generic API call for endpoints not covered by a dedicated method, or for advanced usage.

```javascript
var result = api.callApi('POST', '/api/some/endpoint', {
    key: 'value'
});

log.debug('Response', JSON.stringify(result));
```

---

## Advanced Patterns

### RESTlet -- External System Integration

Expose QubitOn validations as a RESTlet for external systems:

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['/SuiteScripts/QubitOn/qubiton_api_client'], function (api) {

    function post(requestBody) {
        api.loadConfig();

        var method = requestBody.method;
        var params = requestBody.params;

        if (typeof api[method] !== 'function') {
            return { error: 'Unknown method: ' + method };
        }

        try {
            return { success: true, result: api[method](params) };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    return { post: post };
});
```

**Calling from external system:**

```json
POST /restlet?script=123&deploy=1
Content-Type: application/json

{
    "method": "validateAddress",
    "params": {
        "addressLine1": "123 Main St",
        "city": "Springfield",
        "state": "IL",
        "postalCode": "62701",
        "country": "US"
    }
}
```

### Map/Reduce -- Full Batch Validation

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define([
    '/SuiteScripts/QubitOn/qubiton_api_client',
    'N/search',
    'N/record',
    'N/runtime'
], function (api, search, record, runtime) {

    function getInputData() {
        return search.create({
            type: 'vendor',
            filters: [
                ['isinactive', 'is', 'F'],
                'AND',
                ['custentity_qbn_last_validated', 'isempty', '']
            ],
            columns: ['entityid', 'companyname']
        });
    }

    function map(context) {
        var script = runtime.getCurrentScript();
        if (script.getRemainingUsage() < 100) {
            log.audit('Low governance', 'Yielding');
            return;
        }

        api.loadConfig();

        var searchResult = JSON.parse(context.value);
        var vendorId = searchResult.id;

        try {
            var vendorRec = record.load({ type: 'vendor', id: vendorId, isDynamic: false });
            var country = vendorRec.getValue('billcountry') || 'US';
            var companyName = vendorRec.getValue('companyname');

            // Address validation
            var addrResult = api.validateAddress({
                addressLine1: vendorRec.getValue('addr1') || '',
                city: vendorRec.getValue('city') || '',
                state: vendorRec.getValue('state') || '',
                postalCode: vendorRec.getValue('zip') || '',
                country: country
            });

            // Sanctions screening
            var sanctionsResult = api.screenSanctions({
                companyName: companyName,
                country: country
            });

            context.write({
                key: vendorId,
                value: JSON.stringify({
                    status: 'success',
                    addressValid: addrResult && addrResult.isValid,
                    sanctionsMatch: sanctionsResult && sanctionsResult.hasMatch
                })
            });
        } catch (e) {
            log.error('Validation failed for vendor ' + vendorId, e.message);
            context.write({
                key: vendorId,
                value: JSON.stringify({ status: 'error', message: e.message })
            });
        }
    }

    function reduce(context) {
        var vendorId = context.key;
        var data = JSON.parse(context.values[0]);

        if (data.status === 'success') {
            record.submitFields({
                type: 'vendor',
                id: vendorId,
                values: { custentity_qbn_last_validated: new Date() }
            });
        }
    }

    function summarize(summary) {
        log.audit('Batch validation complete', {
            inputCount: summary.inputSummary.toString(),
            mapErrors: summary.mapSummary.errors.length,
            reduceErrors: summary.reduceSummary.errors.length
        });
    }

    return { getInputData: getInputData, map: map, reduce: reduce, summarize: summarize };
});
```

### Workflow Action -- Sanctions Screening

Use in SuiteFlow workflows for conditional branching:

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 */
define(['/SuiteScripts/QubitOn/qubiton_api_client'], function (api) {

    function onAction(context) {
        api.loadConfig();

        var rec = context.newRecord;
        var companyName = rec.getValue('companyname') || rec.getValue('entityid');
        var country = rec.getValue('billcountry') || 'US';

        try {
            var result = api.screenSanctions({
                companyName: companyName,
                country: country
            });

            return result.hasMatch ? 'MATCH' : 'CLEAR';
        } catch (e) {
            log.error('Sanctions check failed', e.message);
            return 'ERROR';
        }
    }

    return { onAction: onAction };
});
```

### Suitelet -- Manual Validation Dashboard

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
    '/SuiteScripts/QubitOn/qubiton_api_client',
    'N/ui/serverWidget'
], function (api, serverWidget) {

    function onRequest(context) {
        if (context.request.method === 'GET') {
            var form = serverWidget.createForm({ title: 'QubitOn Address Validation' });
            form.addField({ id: 'custpage_addr1', type: 'text', label: 'Address Line 1' });
            form.addField({ id: 'custpage_city', type: 'text', label: 'City' });
            form.addField({ id: 'custpage_state', type: 'text', label: 'State' });
            form.addField({ id: 'custpage_zip', type: 'text', label: 'Postal Code' });
            form.addField({ id: 'custpage_country', type: 'text', label: 'Country (ISO 2)' });
            form.addSubmitButton({ label: 'Validate' });
            context.response.writePage(form);
        } else {
            api.loadConfig();

            var params = context.request.parameters;
            var result = api.validateAddress({
                addressLine1: params.custpage_addr1,
                city: params.custpage_city,
                state: params.custpage_state,
                postalCode: params.custpage_zip,
                country: params.custpage_country
            });

            context.response.write(JSON.stringify(result, null, 2));
        }
    }

    return { onRequest: onRequest };
});
```

### Error Handling with Error Modes

Use the `ERROR_MODE` constants to control failure behavior:

```javascript
api.loadConfig();

// Default behavior from config — typically 'W' (warn)
var result = api.validateAddress({
    addressLine1: '123 Bad Address',
    city: 'Nowhere',
    country: 'US'
});
// If config error mode is 'W', returns null on failure with a logged warning
// If config error mode is 'E', throws an error
// If config error mode is 'S', returns null silently

// Override at the config level
log.debug('Error modes', JSON.stringify(api.ERROR_MODE));
// { STOP: 'E', WARN: 'W', SILENT: 'S' }
```
