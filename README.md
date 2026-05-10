# QubitOn API -- NetSuite SuiteScript Connector

[![NetSuite](https://img.shields.io/badge/NetSuite-All%20Editions-0073E6)](https://www.netsuite.com)
[![SuiteScript](https://img.shields.io/badge/SuiteScript-2.1-00A1E0)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_4387172221.html)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![API Methods](https://img.shields.io/badge/API%20Methods-42-green)](https://www.qubiton.com)

Native SuiteScript 2.1 connector for calling the QubitOn API from NetSuite. Full API coverage with **42 methods** across address validation, tax ID verification, bank account checks, sanctions screening, compliance, risk assessment, and more -- all from within your NetSuite account.

## Quick Start

```javascript
// 1. Deploy the connector (SDF or manual upload)
// 2. Create a QubitOn Configuration record with your API key
// 3. Call any of the 42 API methods

/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['/SuiteScripts/QubitOn/qubiton_api_client'], function (api) {

    api.loadConfig();

    var result = api.validateAddress({
        addressLine1: '1600 Pennsylvania Ave NW',
        city: 'Washington',
        state: 'DC',
        postalCode: '20500',
        country: 'US'
    });

    log.debug('Valid', result.isValid);
    log.debug('Standardized', result.standardizedAddress);
});
```

Get your free API key at [www.qubiton.com](https://www.qubiton.com/auth/register).

## Why This Connector

| Benefit | Details |
|---------|---------|
| **Native SuiteScript** | Pure SuiteScript 2.1 -- no middleware, external runtimes, or SuiteCloud Plus required |
| **Zero-code configuration** | Toggle validations per record type via point-and-click custom records |
| **3-layer architecture** | API client, validation orchestrator, and record-type hooks -- use any layer independently |
| **Configurable error handling** | Stop, warn, or silently log validation failures per record type |
| **Full audit trail** | Every API call logged to a custom record with method, endpoint, status, and duration |
| **Address correction accept/reject** | Client Script prompts users to accept or reject standardized addresses with side-by-side comparison |
| **Governance-aware** | Map/Reduce batch scripts respect NetSuite governance limits |
| **SDF-deployable** | Full SuiteCloud Development Framework project for one-command deployment |
| **All NetSuite editions** | Works on Standard, Premium, OneWorld, and SuiteSuccess |

## Architecture

```
+------------------------------------------------------------------+
|  Layer 3: Record Hooks                                           |
|  User Event Scripts (vendor, customer)                           |
|  Client Scripts (real-time UI validation + address correction)   |
|  Map/Reduce (batch processing)                                   |
|  Suitelet (configuration dashboard)                              |
+------------------------------------------------------------------+
|  Layer 2: Validation Orchestrator (qubiton_validation.js)        |
|  Config-driven rules, per-record-type toggles, country filters   |
|  Error mode routing (stop / warn / silent)                       |
|  Address correction detection (original vs corrected diff)       |
+------------------------------------------------------------------+
|  Layer 1: API Client (qubiton_api_client.js)                     |
|  42 methods, N/https module, JSON serialization, error handling  |
+------------------------------------------------------------------+
|  Shared: Config loader, API logging, constants                   |
+------------------------------------------------------------------+
          |                                          |
          v                                          v
   QubitOn Configuration                    QubitOn API Log
   (custom record)                          (custom record)
          |
          v
   https://api.qubiton.com
```

**Layer 1 -- API Client**: Direct HTTP calls to the QubitOn API. Use standalone for ad-hoc queries, RESTlets, or Suitelets.

**Layer 2 -- Validation Orchestrator**: Reads rules from the Validation Config custom record and dispatches validations with per-record-type error modes and country filters. Detects address corrections and flags them for the accept/reject UI flow.

**Layer 3 -- Record Hooks**: Pre-built User Event, Client, Map/Reduce, and Suitelet scripts for common NetSuite record types. The Client Script presents an accept/reject dialog when the API returns a corrected address.

## Features

- **Address validation** across 249 countries with USPS-certified US validation
- **Address correction accept/reject** -- Client Script shows a side-by-side comparison when the API returns a corrected address; user can accept (auto-update the record) or reject (keep original)
- **Tax ID verification** against government registries worldwide
- **Tax ID format validation** for structure checks without live registry lookups
- **Bank account validation** for routing numbers, IBANs, and SWIFT/BIC codes (standard and Pro)
- **Sanctions screening** against OFAC, EU, UN, and UK HMT lists
- **PEP screening** for Politically Exposed Persons
- **Entity risk assessment** for fraud and risk scoring
- **Credit analysis, credit scoring, and bankruptcy lookups** for vendor due diligence
- **Payment failure rate** lookups
- **ESG scoring** for environmental, social, and governance reporting
- **Healthcare provider exclusion** checks (validate and lookup)
- **NPI and MEDPASS** validation for healthcare providers
- **EPA enforcement** action lookups
- **Corporate hierarchy** and beneficial ownership research
- **Company hierarchy** lookup by identifier (DUNS, EIN)
- **DUNS number** lookup
- **Business classification** (SIC, NAICS) lookup
- **Peppol e-invoicing** participant validation and scheme lookup
- **Diversity certification** validation and lookup
- **Ariba supplier profile** lookup and validation
- **Gender identification** from name
- **IP address quality** and reputation checks
- **Domain security** reports
- **Currency exchange rates** with historical date support
- **Payment terms analysis** for early-pay discount optimization
- **Indian identity** validation (PAN, Aadhaar, GSTIN)
- **Disqualified directors** screening
- **DOT/FMCSA motor carrier** lookups
- **Real-time UI validation** via Client Scripts with field-level feedback
- **Batch processing** via governance-aware Map/Reduce scripts

## API Method Catalog

### Validation (18 methods)

| # | Method | HTTP | Endpoint | Description |
|---|--------|------|----------|-------------|
| 1 | `validateAddress` | POST | `/api/address/validate` | Address validation across 249 countries; USPS-certified for US |
| 2 | `validateTax` | POST | `/api/tax/validate` | Tax ID validation against government registries |
| 3 | `validateBank` | POST | `/api/bank/validate` | Bank account validation (routing, IBAN, SWIFT/BIC) |
| 4 | `validateBankPro` | POST | `/api/bankaccount/pro/validate` | Enhanced bank validation with account name matching |
| 5 | `validatePhone` | POST | `/api/phone/validate` | Phone number validation and formatting |
| 6 | `validateEmail` | POST | `/api/email/validate` | Email deliverability and domain validation |
| 7 | `validateInIdentity` | POST | `/api/inidentity/validate` | Indian identity validation (PAN, Aadhaar, GSTIN) |
| 8 | `validateTaxFormat` | POST | `/api/tax/format-validate` | Tax ID format-only validation (no registry lookup) |
| 9 | `getSupportedTaxFormats` | GET | `/api/tax/format-validate/countries` | Supported tax ID format countries |
| 10 | `validateCertification` | POST | `/api/certification/validate` | Business certification validation |
| 11 | `validateDisqualifiedDirectors` | POST | `/api/disqualifieddirectors/validate` | Disqualified director screening |
| 12 | `validateEpaProsecution` | POST | `/api/criminalprosecution/validate` | EPA criminal prosecution check |
| 13 | `validateProviderExclusion` | POST | `/api/providerexclusion/validate` | Healthcare provider exclusion check (OIG/GSA) |
| 14 | `validateNpi` | POST | `/api/nationalprovideridentifier/validate` | National Provider Identifier validation |
| 15 | `validateMedpass` | POST | `/api/Medpass/validate` | MEDPASS provider screening |
| 16 | `validateEsgScore` | POST | `/api/esg/Scores` | ESG score retrieval |
| 17 | `validateIpQuality` | POST | `/api/ipquality/validate` | IP address quality and reputation check |
| 18 | `validatePeppolId` | POST | `/api/peppol/validate` | Peppol participant ID validation |

### Enrichment / Lookup (10 methods)

| # | Method | HTTP | Endpoint | Description |
|---|--------|------|----------|-------------|
| 19 | `getPeppolSchemes` | GET | `/api/peppol/schemes` | Peppol identifier scheme list |
| 20 | `lookupBusinessRegistration` | POST | `/api/businessregistration/lookup` | Company registration lookup |
| 21 | `lookupDunsNumber` | POST | `/api/duns-number-lookup` | D-U-N-S number lookup |
| 22 | `lookupBusinessClassification` | POST | `/api/businessclassification/lookup` | SIC/NAICS classification lookup |
| 23 | `lookupCorporateHierarchy` | POST | `/api/corporatehierarchy/lookup` | Corporate parent/subsidiary structure |
| 24 | `lookupCompanyHierarchy` | POST | `/api/company/hierarchy/lookup` | Company hierarchy by identifier (DUNS, EIN) |
| 25 | `lookupBeneficialOwnership` | POST | `/api/beneficialownership/lookup` | Beneficial ownership information |
| 26 | `lookupCertification` | POST | `/api/certification/lookup` | Certification search by company |
| 27 | `identifyGender` | POST | `/api/genderize/identifygender` | Gender identification from name |
| 28 | `lookupAribaSupplierProfile` | POST | `/api/aribasupplierprofile/lookup` | Ariba supplier profile lookup by ANID |

### Risk & Compliance (7 methods)

| # | Method | HTTP | Endpoint | Description |
|---|--------|------|----------|-------------|
| 29 | `screenSanctions` | POST | `/api/prohibited/lookup` | Global sanctions screening (OFAC, EU, UN, UK HMT) |
| 30 | `screenPep` | POST | `/api/pep/lookup` | Politically Exposed Person screening |
| 31 | `assessEntityRisk` | POST | `/api/entity/fraud/lookup` | Entity fraud / risk assessment |
| 32 | `lookupCreditAnalysis` | POST | `/api/creditanalysis/lookup` | Detailed credit analysis report |
| 33 | `lookupCreditScore` | POST | `/api/risk/lookup` | Company credit score (category: Credit Score) |
| 34 | `lookupBankruptcy` | POST | `/api/risk/lookup` | Bankruptcy records (category: Bankruptcy) |
| 35 | `lookupFailRate` | POST | `/api/risk/lookup` | Payment failure rate (category: Fail Rate) |

### Industry (3 methods)

| # | Method | HTTP | Endpoint | Description |
|---|--------|------|----------|-------------|
| 36 | `lookupDotMotorCarrier` | POST | `/api/dot/fmcsa/lookup` | DOT/FMCSA motor carrier lookup |
| 37 | `lookupProviderExclusion` | POST | `/api/providerexclusion/lookup` | Healthcare provider exclusion records |
| 38 | `validateAribaSupplierProfile` | POST | `/api/aribasupplierprofile/validate` | Ariba supplier profile validation |

### Financial (4 methods)

| # | Method | HTTP | Endpoint | Description |
|---|--------|------|----------|-------------|
| 39 | `getExchangeRates` | POST | `/api/currency/exchange-rates/{baseCurrency}` | Currency exchange rates (current and historical) |
| 40 | `analyzePaymentTerms` | POST | `/api/paymentterms/validate` | Payment terms early-pay discount analysis |
| 41 | `lookupDomainSecurity` | POST | `/api/itsecurity/domainreport` | Domain cybersecurity report |

### Utility (1 method)

| # | Method | HTTP | Endpoint | Description |
|---|--------|------|----------|-------------|
| 42 | `callApi` | * | (any) | Generic API call for advanced usage |

> Methods 33-35 (`lookupCreditScore`, `lookupBankruptcy`, `lookupFailRate`) share the same endpoint (`/api/risk/lookup`) and are differentiated by the `category` field in the request payload.

## Installation

### SDF Deployment (Recommended)

```bash
# Clone the repository
git clone https://github.com/qubitonhq/qubiton-netsuite.git
cd qubiton-netsuite

# Authenticate with your NetSuite account
suitecloud account:setup

# Validate and deploy
suitecloud project:validate
suitecloud project:deploy
```

### Manual Deployment

1. Upload all files from `src/FileCabinet/SuiteScripts/QubitOn/` to your File Cabinet under `SuiteScripts/QubitOn/`
2. Import custom record XML files from `Objects/` or create them manually
3. Create script records and deployments for each script type

See the [Setup Guide](docs/setup.md) for detailed step-by-step instructions.

### Configure

1. Navigate to **Customization > Lists, Records, & Fields > Record Types > QubitOn Configuration**
2. Create a new record and enter your API key
3. Set error mode to **W** (Warning) for initial rollout
4. Create Validation Config records for each record type you want to validate

## SuiteApp Marketplace Readiness

This connector is built to meet Oracle NetSuite SuiteApp marketplace certification requirements:

| Requirement | Status |
|-------------|--------|
| **SDF project structure** | manifest.xml, deploy.xml, Objects/, FileCabinet/ |
| **BundleInstallationScript** | `qubiton_install.js` — afterInstall seeds config, afterUpdate preserves existing, beforeUninstall cleans logs |
| **Governance compliance** | All scripts check `getRemainingUsage()` before API calls (thresholds: API client 20, UE 100, MR map 200/reduce 50, Suitelet 100) |
| **Custom role** | QubitOn Administrator role with scoped permissions (custom records, Suitelets, script deployments) |
| **Script record deployments** | All 7 scripts have XML script records with proper deployment targets |
| **Data cleanup utility** | Admin Suitelet for purging old API logs with date filter and governance-aware batch deletion |
| **No hardcoded credentials** | API key stored in encrypted custom record field; base URL configurable |
| **Audit trail** | Every API call logged with method, endpoint, status, duration, user |
| **Error isolation** | Configurable error modes (Stop/Warn/Silent) per record type |
| **Uninstall support** | beforeUninstall cleans up API log records older than 90 days |

## Project Structure

```
qubiton-netsuite/
  manifest.xml                                     -- SDF project manifest (publisher, version, deps)
  deploy.xml                                       -- SDF deployment configuration
  Objects/
    customrecord_qubiton_config.xml                 -- Configuration custom record
    customrecord_qubiton_val_cfg.xml                -- Validation config custom record
    customrecord_qubiton_api_log.xml                -- API log custom record
    customscript_qbn_vendor_ue.xml                  -- Vendor UE script record + deployment
    customscript_qbn_customer_ue.xml                -- Customer UE script record + deployment
    customscript_qbn_batch_mr.xml                   -- Map/Reduce script record + deployment
    customscript_qbn_config_sl.xml                  -- Config Suitelet script record + deployment
    customscript_qbn_client.xml                     -- Client Script record + deployments (vendor + customer)
    customscript_qbn_install.xml                    -- Bundle Installation script record
    customscript_qbn_cleanup_sl.xml                 -- Cleanup Suitelet script record + deployment
    customrole_qbn_admin.xml                        -- QubitOn Administrator custom role
  src/FileCabinet/SuiteScripts/QubitOn/
    qubiton_api_client.js                           -- Layer 1: API client (42 methods)
    qubiton_validation.js                           -- Layer 2: Validation orchestrator
    qubiton_vendor_ue.js                            -- Vendor User Event script
    qubiton_customer_ue.js                          -- Customer User Event script
    qubiton_client.js                               -- Client Script (UI validation + address correction)
    qubiton_batch_mr.js                             -- Map/Reduce batch validation
    qubiton_config_sl.js                            -- Configuration Suitelet (dashboard + connection test)
    qubiton_install.js                              -- Bundle Installation script (install/update/uninstall)
    qubiton_cleanup_sl.js                           -- Data cleanup Suitelet (admin maintenance)
  tests/
    qubiton_api_client_test.js                      -- API client unit tests (160 tests)
  docs/
    setup.md                                        -- Installation guide
    configuration.md                                -- Configuration reference
    examples.md                                     -- Code examples for all 42 methods
    netsuite-integration.md                         -- NetSuite integration patterns
  LICENSE                                           -- MIT License
  README.md                                         -- This file
```

## NetSuite Compatibility

| Edition | SuiteScript | Support Level |
|---------|-------------|---------------|
| NetSuite Standard | 2.1 | Full |
| NetSuite Premium | 2.1 | Full |
| NetSuite OneWorld | 2.1 | Full (multi-subsidiary) |
| NetSuite SuiteSuccess | 2.1 | Full |
| NetSuite Sandbox | 2.1 | Full |

### Script Type Support

| Script Type | Use Case | Layer |
|-------------|----------|-------|
| User Event | Vendor/customer validation on save | 2 + 3 |
| Client Script | Real-time UI validation + address correction accept/reject | 1 + 3 |
| Map/Reduce | Batch validation | 1 + 2 |
| Suitelet | Configuration dashboard, manual checks | 1 |
| RESTlet | External system integration | 1 |
| Workflow Action | SuiteFlow conditional branching | 1 |
| Scheduled | Recurring batch jobs | 1 + 2 |

### Module Dependencies

The connector uses only standard SuiteScript 2.1 modules:

| Module | Purpose |
|--------|---------|
| `N/https` | HTTP calls to QubitOn API |
| `N/record` | Record operations (load, save, submit) |
| `N/search` | Saved Search and ad-hoc queries |
| `N/runtime` | Script parameters, current user, governance |
| `N/error` | Custom error creation |
| `N/ui/serverWidget` | Suitelet forms |
| `N/ui/dialog` | Client Script dialogs (address correction accept/reject) |
| `N/log` | Server-side logging |

No external libraries or SuiteCloud Plus are required.

## MCP Protocol Support

The QubitOn API is also available as a [Model Context Protocol](https://modelcontextprotocol.io/) server with tools mapped 1:1 to API endpoints, workflow prompts, and reference data resources. Connect your AI assistant directly to QubitOn for natural-language data validation.

MCP Manifest: [mcp.qubiton.com](https://mcp.qubiton.com)

## Documentation

| Document | Description |
|----------|-------------|
| [Setup Guide](docs/setup.md) | Prerequisites, SDF deployment, manual install, troubleshooting |
| [Configuration](docs/configuration.md) | Config records, validation rules, error modes, logging |
| [API Examples](docs/examples.md) | SuiteScript code examples for all 42 methods |
| [NetSuite Integration](docs/netsuite-integration.md) | Vendor/customer hooks, batch, workflows, address correction |

## Contributing

Contributions are welcome. Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`feat/your-feature`)
3. Write tests for new functionality
4. Ensure all existing tests pass
5. Submit a pull request with a clear description

### Development Setup

```bash
# Clone your fork
git clone https://github.com/your-username/qubiton-netsuite.git
cd qubiton-netsuite

# Install SuiteCloud CLI
npm install -g @oracle/suitecloud-cli

# Set up your sandbox account
suitecloud account:setup

# Deploy to sandbox for testing
suitecloud project:deploy
```

### Coding Standards

- SuiteScript 2.1 with JSDoc annotations
- `@NApiVersion 2.1` and `@NModuleScope SameAccount` on all scripts
- camelCase for method and variable names
- Descriptive error messages with context
- No external dependencies beyond standard SuiteScript modules

## Other Integrations

QubitOn provides native connectors and SDKs for other platforms:

| Connector | Platform | Language | Repo |
|-----------|----------|----------|------|
| **Go SDK** | Any platform | Go | [qubiton-go](https://github.com/qubitonhq/qubiton-go) |
| **SAP S/4HANA** | SAP ECC, S/4HANA, BTP | ABAP | [qubiton-sap](https://github.com/qubitonhq/qubiton-sap) |
| **Oracle** | Oracle DB 11g+, EBS, Fusion | PL/SQL | [qubiton-oracle](https://github.com/qubitonhq/qubiton-oracle) |
| **QuickBooks Online** | QuickBooks Online | TypeScript | [qubiton-quickbooks](https://github.com/qubitonhq/qubiton-quickbooks) |

Plus 30+ pre-built integrations for Salesforce, HubSpot, Snowflake, Databricks, Zapier, Make, and more at [www.qubiton.com/integrations](https://www.qubiton.com/integrations).

## License

[MIT](LICENSE) -- Copyright (c) 2026 [apexanalytix, Inc.](https://www.apexanalytix.com)
