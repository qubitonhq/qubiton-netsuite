# NetSuite Integration Patterns

This guide covers production-ready integration patterns for the QubitOn connector within NetSuite.

## 1. Vendor Validation (User Event Script)

The most common integration: validate vendor data on create and edit.

### Architecture

```
Vendor Form → beforeSubmit (User Event) → QubitOn API
                                           ↓
                                     Validation Result
                                           ↓
                               Error Mode: E → Block save
                               Error Mode: W → Log warning
                               Error Mode: S → Log silently
```

### User Event Script

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define([
    '/SuiteScripts/QubitOn/qubiton_validation',
    '/SuiteScripts/QubitOn/qubiton_api_client',
    'N/log',
    'N/runtime',
    'N/error'
], (validate, apiClient, log, runtime, error) => {

    function beforeSubmit(context) {
        // Skip on delete
        if (context.type === context.UserEventType.DELETE) return;

        // Skip if disabled via script parameter
        const script = runtime.getCurrentScript();
        if (script.getParameter('custscript_qbn_enabled') === false) return;

        // Skip for specific roles (e.g., data import role)
        const skipRoles = script.getParameter('custscript_qbn_skip_roles') || '';
        const currentRole = runtime.getCurrentUser().role;
        if (skipRoles.split(',').includes(String(currentRole))) return;

        const vendorRec = context.newRecord;
        const cfg = apiClient.getConfig();

        if (!cfg) return;

        const results = validate.runForRecord(vendorRec, 'vendor', cfg);
        const failures = results.filter(r => !r.isValid);

        if (failures.length === 0) return;

        const errorMode = cfg.errorMode || 'W';

        switch (errorMode) {
            case 'E':
                // Block save with error details
                const messages = failures.map(f =>
                    `${f.validationType}: ${f.message}`
                ).join('\n');
                throw error.create({
                    name: 'QBN_VALIDATION_FAILED',
                    message: `Validation failed:\n${messages}`,
                    notifyOff: false
                });

            case 'W':
                // Log warnings — Client Script handles UI notification
                failures.forEach(f => {
                    logger.warn(`Vendor ${vendorRec.id}: ${f.validationType} — ${f.message}`);
                });
                break;

            case 'S':
                // Silent — log only
                failures.forEach(f => {
                    logger.info(`Vendor ${vendorRec.id}: ${f.validationType} — ${f.message}`);
                });
                break;
        }
    }

    function afterSubmit(context) {
        if (context.type === context.UserEventType.DELETE) return;

        // Update validation timestamp
        const vendorRec = context.newRecord;
        record.submitFields({
            type: 'vendor',
            id: vendorRec.id,
            values: {
                custentity_qbn_last_validated: new Date()
            },
            options: { enableSourcing: false, ignoreMandatoryFields: true }
        });
    }

    return { beforeSubmit, afterSubmit };
});
```

### Deployment Settings

| Setting | Value |
|---------|-------|
| Record Type | Vendor |
| Event Type | Before Submit, After Submit |
| Status | Released |
| Execute As Role | Administrator |
| Log Level | Debug (development) / Error (production) |

---

## 2. Customer Validation (User Event Script)

Same pattern as vendor validation, applied to customer records.

### Key Differences from Vendor

| Aspect | Vendor | Customer |
|--------|--------|----------|
| Typical validations | Address, Tax, Bank, Sanctions | Address, Email, Phone |
| Error mode | E (strict compliance) | W (customer-friendly) |
| Batch frequency | Monthly | Quarterly |
| Country filter | All | May filter by subsidiary |

### Customer-Specific Field Mapping

```javascript
function getCustomerFields(customerRec) {
    return {
        companyName: customerRec.getValue('companyname') ||
                     `${customerRec.getValue('firstname')} ${customerRec.getValue('lastname')}`,
        email: customerRec.getValue('email'),
        phone: customerRec.getValue('phone'),
        country: customerRec.getValue('billcountry'),
        addressLine1: customerRec.getSublistValue({
            sublistId: 'addressbook',
            fieldId: 'addr1',
            line: 0
        }),
        city: customerRec.getSublistValue({
            sublistId: 'addressbook',
            fieldId: 'city',
            line: 0
        }),
        state: customerRec.getSublistValue({
            sublistId: 'addressbook',
            fieldId: 'state',
            line: 0
        }),
        postalCode: customerRec.getSublistValue({
            sublistId: 'addressbook',
            fieldId: 'zip',
            line: 0
        })
    };
}
```

---

## 3. Batch Validation (Map/Reduce Script)

For processing large volumes of records without impacting UI performance.

### When to Use Batch vs. Real-Time

| Scenario | Approach |
|----------|----------|
| New vendor creation | Real-time (User Event) |
| Annual vendor re-validation | Batch (Map/Reduce) |
| Data migration / import | Batch (Map/Reduce, Silent mode) |
| Sanctions re-screening (regulatory) | Batch (Map/Reduce, scheduled) |
| Ad-hoc spot checks | RESTlet or Suitelet |

### Governance-Aware Batch Processing

NetSuite Map/Reduce scripts have governance limits. The connector handles this gracefully:

```javascript
function map(context) {
    const script = runtime.getCurrentScript();

    // Check remaining governance units
    if (script.getRemainingUsage() < 100) {
        log.audit('Low governance', 'Yielding to avoid timeout');
        return; // Map/Reduce will reschedule
    }

    const searchResult = JSON.parse(context.value);
    const vendorId = searchResult.id;

    try {
        const vendorRec = record.load({
            type: 'vendor',
            id: vendorId,
            isDynamic: false
        });

        const results = validate.runForRecord(vendorRec, 'vendor');

        context.write({
            key: vendorId,
            value: JSON.stringify({
                status: 'success',
                validations: results.length,
                failures: results.filter(r => !r.isValid).length
            })
        });
    } catch (e) {
        context.write({
            key: vendorId,
            value: JSON.stringify({ status: 'error', message: e.message })
        });
    }
}
```

### Scheduling

Set up recurring batch validation via **Customization > Scripting > Script Deployments**:

| Schedule | Use Case |
|----------|----------|
| Daily at 2 AM | Sanctions re-screening for active vendors |
| Weekly (Sunday) | Full address re-validation |
| Monthly (1st) | Comprehensive vendor validation suite |
| On-demand | Data migration validation |

---

## 4. Client Script UI Validation

Provide real-time validation feedback in the NetSuite UI before the form is submitted.

### Client Script Pattern

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define([
    '/SuiteScripts/QubitOn/qubiton_api_client',
    'N/ui/dialog',
    'N/currentRecord'
], (apiClient, dialog, currentRecord) => {

    function saveRecord(context) {
        const rec = currentRecord.get();

        // Quick tax ID format check before save
        const taxId = rec.getValue('taxidnum');
        const country = rec.getValue('billcountry');

        if (taxId && country) {
            try {
                apiClient.loadConfig();
                const result = apiClient.validateTaxFormat({
                    identityNumber: taxId,
                    identityNumberType: 'VAT',
                    countryIso2: country
                });

                if (!result.isValid) {
                    dialog.alert({
                        title: 'Tax ID Format Warning',
                        message: `The tax ID "${taxId}" does not match the expected format for ${country}.\n\nExpected: ${result.expectedFormat}\n\nDo you want to continue?`
                    });
                    // Note: dialog.alert is non-blocking in Client Scripts
                    // For blocking confirmation, use dialog.confirm
                }
            } catch (e) {
                // Don't block save on API errors
                log.error('Tax validation failed', e.message);
            }
        }

        return true; // Allow save
    }

    function fieldChanged(context) {
        if (context.fieldId === 'email') {
            const email = context.currentRecord.getValue('email');
            if (email && email.includes('@')) {
                try {
                    apiClient.loadConfig();
                    const result = apiClient.validateEmail({ emailAddress: email });
                    if (!result.isDeliverable) {
                        dialog.alert({
                            title: 'Email Warning',
                            message: `The email "${email}" may not be deliverable. Please verify.`
                        });
                    }
                } catch (e) {
                    // Silent failure — don't interrupt user workflow
                }
            }
        }
    }

    return { saveRecord, fieldChanged };
});
```

### Important: Client Script Governance

Client Scripts have limited governance units. Keep API calls minimal:

- Use `validateTaxFormat` (format-only, fast) instead of `validateTax` (full registry lookup) in Client Scripts
- The `validateTaxFormat` method requires `identityNumber`, `identityNumberType`, and `countryIso2`
- Avoid calling multiple API methods in `saveRecord` — defer to the User Event beforeSubmit
- Use `fieldChanged` sparingly — only for fields where instant feedback is critical

---

## 5. Workflow Integration

Integrate QubitOn validations into SuiteFlow workflows.

### Workflow Action Script

Create a custom Workflow Action that calls QubitOn and returns a result for workflow branching:

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 */
define(['/SuiteScripts/QubitOn/qubiton_api_client'], (apiClient) => {

    function onAction(context) {
        const rec = context.newRecord;
        const name = rec.getValue('companyname') || rec.getValue('entityid');
        const country = rec.getValue('billcountry') || 'US';

        try {
            const sanctionsResult = apiClient.screenSanctions({
                companyName: name,
                country: country
            });

            if (sanctionsResult.hasMatch) {
                return 'MATCH';
            }
            return 'CLEAR';
        } catch (e) {
            log.error('Workflow sanctions check failed', e.message);
            return 'ERROR';
        }
    }

    return { onAction };
});
```

### Workflow Design

```
[Vendor Created] → [QubitOn screenSanctions]
                          ↓
              ┌───── CLEAR ─────┐
              ↓                 ↓
     [Auto-Approve]     ┌── MATCH ──┐
                         ↓          ↓
                  [Route to       [Route to
                   Compliance]     Manager]
                         ↓
                  [Manual Review]
                         ↓
              ┌── Approved ──┐── Rejected ──┐
              ↓              ↓              ↓
        [Activate]    [Flag for        [Deactivate
         Vendor]       Review]          Vendor]
```

### Setting Up the Workflow

1. Create a new workflow on the Vendor record type
2. Add a Custom Action state using the Workflow Action Script above
3. Configure transitions based on the return value (CLEAR, MATCH, ERROR)
4. Set the workflow to trigger on **Before Record Submit** or **After Record Submit**

---

## 6. Saved Search for Validation Results

Create Saved Searches to monitor validation activity and identify issues.

### API Call Summary (Last 30 Days)

| Field | Summary | Label |
|-------|---------|-------|
| Endpoint (`custrecord_qbn_log_endpoint`) | Group | Endpoint |
| Internal ID | Count | Total Calls |
| Duration (`custrecord_qbn_log_duration`) | Average | Avg Duration (ms) |
| Status Code (`custrecord_qbn_log_status`) | Count | (filter: >= 400) Error Count |

**Criteria:**
- Request Date is within last 30 days

### Failed Validations by Vendor

```
Type: Custom Record — QubitOn API Log
Criteria:
  - Status Code >= 400
  - Request Date = last 7 days

Results:
  - Source Record Type (Group)
  - Source Record ID (Group) → Formula: link to record
  - Endpoint (Group)
  - Status Code (Group)
  - Internal ID (Count)
```

### Vendors Never Validated

```
Type: Vendor
Criteria:
  - Is Inactive = No
  - Last Validated (custentity_qbn_last_validated) is empty

Results:
  - Entity ID
  - Company Name
  - Date Created
  - Country
```

### Sanctions Matches (Requires Immediate Review)

```
Type: Custom Record — QubitOn API Log
Criteria:
  - Endpoint contains "prohibited"
  - Status Code = 200
  - Error Message is not empty (indicates a match was found)
  - Request Date = today

Results:
  - Source Record Type
  - Source Record ID
  - User
  - Request Date
  - Error Message (shows match details)
```

---

## 7. SuiteAnalytics Workbook Patterns

For advanced analytics beyond Saved Searches.

### API Usage Dashboard

Create a SuiteAnalytics Workbook with the QubitOn API Log as the data source:

**Pivot Table: Calls by Endpoint and Day**

| Rows | Columns | Values |
|------|---------|--------|
| Endpoint | Request Date (by day) | Count of Internal ID |

**Chart: Response Time Trend**

| X-Axis | Y-Axis | Series |
|--------|--------|--------|
| Request Date (by week) | Average Duration (ms) | Endpoint |

**Table: Error Rate by Endpoint**

| Columns | Calculation |
|---------|-------------|
| Endpoint | Group |
| Total Calls | Count |
| Errors (Status >= 400) | Count with filter |
| Error Rate | Formula: Errors / Total * 100 |

### Validation Coverage Report

Create a workbook joining Vendor records with API Log records:

```
Data Sources:
  - Vendor (primary)
  - QubitOn API Log (linked via Source Record ID)

Metrics:
  - Total active vendors
  - Vendors validated in last 30 days
  - Vendors never validated
  - Average validations per vendor
  - Most common validation failures
```

### Cost Tracking

Track API usage against your QubitOn plan:

```
Pivot: Monthly API Calls by Category

Rows: Request Date (by month)
Columns: Endpoint (grouped by category — address, tax, bank, compliance)
Values: Count of calls

Add calculated field: Estimated cost = Count * per-call rate
```

---

## Field Mapping Reference

Standard NetSuite fields mapped to QubitOn API parameters:

### Vendor Fields

| NetSuite Field | Field ID | QubitOn Parameter | API Method |
|---------------|----------|-------------------|-----------|
| Company Name | `companyname` | `companyName` | Most methods |
| Tax ID | `taxidnum` | `identityNumber` | `validateTax` |
| Address Line 1 | `addr1` (addressbook) | `addressLine1` | `validateAddress` |
| City | `city` (addressbook) | `city` | `validateAddress` |
| State | `state` (addressbook) | `state` | `validateAddress` |
| Zip | `zip` (addressbook) | `postalCode` | `validateAddress` |
| Country | `country` (addressbook) | `country` | Multiple |
| Email | `email` | `emailAddress` | `validateEmail` |
| Phone | `phone` | `phoneNumber` | `validatePhone` |

### Customer Fields

| NetSuite Field | Field ID | QubitOn Parameter | API Method |
|---------------|----------|-------------------|-----------|
| Company Name | `companyname` | `companyName` | Most methods |
| First Name | `firstname` | `firstName` | `identifyGender` |
| Last Name | `lastname` | `lastName` | Multiple |
| Email | `email` | `emailAddress` | `validateEmail` |
| Phone | `phone` | `phoneNumber` | `validatePhone` |
| Bill Country | `billcountry` | `country` | Multiple |

### Address Sublist

Vendors and customers store addresses in the `addressbook` sublist. To access:

```javascript
const lineCount = rec.getLineCount({ sublistId: 'addressbook' });
for (let i = 0; i < lineCount; i++) {
    const addrRec = rec.getSublistSubrecord({
        sublistId: 'addressbook',
        fieldId: 'addressbookaddress',
        line: i
    });
    const addr1 = addrRec.getValue('addr1');
    const city = addrRec.getValue('city');
    const state = addrRec.getValue('state');
    const zip = addrRec.getValue('zip');
    const country = addrRec.getValue('country');
}
```

---

## 8. Address Correction Accept/Reject

When the QubitOn API returns a standardized/corrected address that differs from the original, the connector supports an interactive accept/reject flow in the Client Script.

### How It Works

1. **Layer 2 (Validation Orchestrator)** calls `validateAddress` and compares the API response fields (`addressLine1`, `addressLine2`, `city`, `state`, `postalCode`, `country`) against the original address on the record
2. If any field differs (case-insensitive comparison), the result is flagged with `addressCorrected: true` and includes both `original` and `corrected` objects
3. **Layer 3 (Client Script)** detects the `addressCorrected` flag and presents a confirmation dialog with a side-by-side comparison table
4. Changed fields are highlighted in green for easy identification
5. The user chooses:
   - **OK (Accept)** -- the corrected address is written back to the record's address fields automatically
   - **Cancel (Reject)** -- the original address is kept unchanged

### Flow Diagram

```
User saves record
        ↓
Client Script calls validation Suitelet
        ↓
Suitelet runs validateAddress via Layer 2
        ↓
Layer 2 compares original vs API response
        ↓
   addressCorrected = true?
        ↓ Yes                    ↓ No
Show accept/reject dialog     Continue normally
   ↓ Accept    ↓ Reject
Update record  Keep original
address fields address
```

### Customization

The address correction feature is automatic when address validation is enabled for a record type. To disable the accept/reject prompt while keeping address validation active, you can modify the Client Script (`qubiton_client.js`) to skip the `checkAddressCorrectionPrompt` call.

The comparison dialog uses standard NetSuite `N/ui/dialog.confirm` and works in all NetSuite editions without additional dependencies.
