# Configuration Guide

All QubitOn connector configuration is stored in NetSuite custom records. No external config files or environment variables are needed.

## QubitOn Configuration Record

Navigate to **Customization > Lists, Records, & Fields > Record Types > QubitOn Configuration** to manage global settings.

### Fields

| Field | Script ID | Type | Default | Description |
|-------|-----------|------|---------|-------------|
| API Key | `custrecord_qbn_api_key` | Password | (required) | Your QubitOn API key. Masked in the UI for security. |
| Base URL | `custrecord_qbn_base_url` | Text | `https://api.qubiton.com` | API base URL. Change only for testing or on-prem. |
| Timeout | `custrecord_qbn_timeout` | Integer | `30` | HTTP timeout in seconds (5-300). |
| Error Mode | `custrecord_qbn_error_mode` | Select | `W` | Global error handling: E, W, or S. |
| Enable Logging | `custrecord_qbn_log_enabled` | Checkbox | Checked | Log all API calls to the API Log record. |

### Reading Configuration in SuiteScript

```javascript
/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search'], (record, search) => {

    function getConfig() {
        const results = [];
        search.create({
            type: 'customrecord_qubiton_config',
            columns: [
                'custrecord_qbn_base_url',
                'custrecord_qbn_timeout',
                'custrecord_qbn_error_mode',
                'custrecord_qbn_log_enabled'
            ]
        }).run().each((result) => {
            results.push({
                baseUrl: result.getValue('custrecord_qbn_base_url'),
                timeout: parseInt(result.getValue('custrecord_qbn_timeout'), 10) || 30,
                errorMode: result.getValue('custrecord_qbn_error_mode') || 'W',
                logEnabled: result.getValue('custrecord_qbn_log_enabled')
            });
            return false; // first record only
        });
        return results[0] || null;
    }

    return { getConfig };
});
```

> **Note**: The API Key field uses the PASSWORD field type, which cannot be read via SuiteScript search. The `qubiton_api_client.js` module reads it using `N/record.load()` with field-level access.

## Validation Config Records

Navigate to **Customization > Lists, Records, & Fields > Record Types > QubitOn Validation Config** to manage per-record-type validation rules.

### Creating a Validation Config

1. Click **New** under the QubitOn Validation Config record type
2. Select the **Record Type** (vendor, customer, partner, employee, or contact)
3. Configure the **Error Mode Override** (or leave blank to use the global setting)
4. Optionally set **Country Filter** to restrict validations to specific countries
5. Check the validation toggles for the validations you want to run
6. Set **Active** to checked
7. Click **Save**

### Example Configurations

**Vendor — Full Compliance (US only)**:

| Field | Value |
|-------|-------|
| Record Type | vendor |
| Error Mode Override | E (Error) |
| Country Filter | US |
| Validate Address | Yes |
| Validate Tax ID | Yes |
| Validate Bank Account | Yes |
| Sanctions Screening | Yes |
| PEP Screening | Yes |
| Bankruptcy Check | Yes |
| Business Registration | Yes |
| EPA Prosecution Check | Yes |

**Customer — Basic Validation (All countries)**:

| Field | Value |
|-------|-------|
| Record Type | customer |
| Error Mode Override | W (Warning) |
| Country Filter | (blank — all countries) |
| Validate Address | Yes |
| Validate Email | Yes |
| Validate Phone | Yes |

**Vendor — Silent Batch (Global)**:

| Field | Value |
|-------|-------|
| Record Type | vendor |
| Error Mode Override | S (Silent) |
| Country Filter | (blank) |
| Validate Address | Yes |
| Validate Tax ID | Yes |
| Sanctions Screening | Yes |
| Active | Yes |

### Validation Toggle Fields

| Field | Script ID | Validation | Endpoint |
|-------|-----------|-----------|----------|
| Validate Address | `custrecord_qbn_vc_address` | Address validation (249 countries) | POST /api/address/validate |
| Validate Tax ID | `custrecord_qbn_vc_tax` | Tax ID validation | POST /api/tax/validate |
| Validate Bank Account | `custrecord_qbn_vc_bank` | Bank account validation | POST /api/bank/validate |
| Validate Email | `custrecord_qbn_vc_email` | Email deliverability | POST /api/email/validate |
| Validate Phone | `custrecord_qbn_vc_phone` | Phone validation | POST /api/phone/validate |
| Sanctions Screening | `custrecord_qbn_vc_sanctions` | OFAC/EU/UN/UK HMT screening | POST /api/prohibited/lookup |
| PEP Screening | `custrecord_qbn_vc_pep` | Politically exposed persons | POST /api/pep/lookup |
| Bankruptcy Check | `custrecord_qbn_vc_bankruptcy` | Bankruptcy filings | POST /api/risk/lookup |
| Business Registration | `custrecord_qbn_vc_bizreg` | Company registration lookup | POST /api/businessregistration/lookup |
| Disqualified Director | `custrecord_qbn_vc_directors` | Director disqualification | POST /api/disqualifieddirectors/validate |
| Healthcare Exclusion | `custrecord_qbn_vc_healthcare` | OIG/GSA exclusion lists | POST /api/providerexclusion/validate |
| EPA Prosecution | `custrecord_qbn_vc_epa` | EPA enforcement actions | POST /api/criminalprosecution/validate |
| ESG Score | `custrecord_qbn_vc_esg` | ESG score lookup | POST /api/esg/Scores |
| Risk Assessment | `custrecord_qbn_vc_risk` | Entity risk assessment | POST /api/entity/fraud/lookup |
| Peppol Validation | `custrecord_qbn_vc_peppol` | Peppol participant ID | POST /api/peppol/validate |

### Multiple Configs per Record Type

You can create multiple validation configs for the same record type with different country filters. The orchestrator evaluates them in order and applies the first matching config based on the record's country.

Example: strict US validation (Error mode) + relaxed international validation (Warning mode):

| Config | Record Type | Country Filter | Error Mode |
|--------|-------------|---------------|------------|
| Config 1 | vendor | US | E |
| Config 2 | vendor | (blank — catch-all) | W |

## Error Modes Explained

Error mode controls what happens when a validation fails:

### E — Error (Stop)

- The record save is **blocked** and the user sees an error dialog
- Use for critical validations where invalid data must not enter the system
- Best for: sanctions screening, tax ID validation in regulated industries
- Implementation: throws `error.UserError` in the beforeSubmit User Event

### W — Warning (Warn)

- The user sees a **warning message** but can choose to proceed with the save
- Use for validations where you want to flag issues without blocking workflow
- Best for: address validation, email validation, initial rollout of new validations
- Implementation: displays a warning dialog via Client Script; logs to API Log
- **Recommended as the starting error mode** during initial deployment

### S — Silent (Log Only)

- No user-facing message; the validation result is **logged silently** to the API Log
- Use for background monitoring, batch processing, or gradual rollout
- Best for: Map/Reduce batch validation, analytics-only use cases
- Implementation: calls API and writes to API Log without any UI interaction

### Error Mode Priority

1. Validation Config record-level override (if set)
2. Global Configuration record setting
3. Default: `W` (Warning) if neither is configured

## API Logging

When **Enable API Logging** is checked, every API call creates a record in the QubitOn API Log:

| Logged Field | Description |
|-------------|-------------|
| HTTP Method | GET or POST |
| Endpoint | API path (e.g., /api/address/validate) |
| Status Code | HTTP response status (200, 400, 401, 500, etc.) |
| Duration (ms) | Round-trip time in milliseconds |
| User | NetSuite user who triggered the call |
| Error Message | Error details (empty for successful calls) |
| Request Date | Timestamp with timezone |
| Source Record Type | Record type that triggered the call |
| Source Record ID | Internal ID of the source record |

### Viewing Logs

- Navigate to **Customization > Lists, Records, & Fields > Record Types > QubitOn API Log**
- Use the list view to filter by date, status code, endpoint, or user
- Create a Saved Search for custom reporting (see [NetSuite Integration Patterns](netsuite-integration.md))

### Log Retention

API Log records are standard custom records and follow your account's data retention policies. For high-volume accounts, consider:

- Creating a scheduled script to purge logs older than 90 days
- Using a Saved Search to archive logs to CSV before purging
- Setting up SuiteAnalytics Workbooks for long-term trend analysis

## Script Parameters

Individual script deployments support parameters for deployment-level overrides:

| Parameter | Type | Description |
|-----------|------|-------------|
| `custscript_qbn_enabled` | Checkbox | Enable/disable this specific deployment |
| `custscript_qbn_error_mode` | Text | Override error mode for this deployment |
| `custscript_qbn_skip_roles` | Text | Comma-separated role IDs to skip validation |

These parameters are set on the **Script Deployment** record (not the Script record) and allow different behavior per deployment — for example, disabling validation for the Administrator role during data imports.

### Setting Script Parameters

1. Navigate to **Customization > Scripting > Script Deployments**
2. Find the deployment for the script you want to configure
3. Click **Edit**
4. Set the parameter values in the **Parameters** subtab
5. Click **Save**

## Next Steps

- [Examples](examples.md) — code examples for all 42 API methods
- [NetSuite Integration Patterns](netsuite-integration.md) — advanced patterns for vendors, customers, batch processing
