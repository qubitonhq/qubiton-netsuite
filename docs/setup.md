# Setup Guide

This guide covers installing the QubitOn NetSuite Connector and configuring it for first use.

## Prerequisites

- NetSuite account with Administrator role or SuiteCloud Developer role
- SuiteScript 2.1 enabled (Setup > Company > Enable Features > SuiteCloud > Client SuiteScript, Server SuiteScript)
- QubitOn API key — obtain one free at [www.qubiton.com](https://www.qubiton.com/auth/register)
- Network access to `api.qubiton.com` port 443 (HTTPS)

## Installation Methods

### Method 1: SDF Deployment (Recommended)

SuiteCloud Development Framework deployment handles custom records, scripts, and file uploads in a single operation.

1. **Install SuiteCloud CLI** (if not already installed):

   ```bash
   npm install -g @oracle/suitecloud-cli
   ```

2. **Clone the repository**:

   ```bash
   git clone https://github.com/qubitonhq/qubiton-netsuite.git
   cd qubiton-netsuite
   ```

3. **Set up authentication**:

   ```bash
   suitecloud account:setup
   ```

   Follow the prompts to select your account and role. Use the Administrator role or a custom role with SuiteCloud Developer permissions.

4. **Validate the project**:

   ```bash
   suitecloud project:validate
   ```

5. **Deploy**:

   ```bash
   suitecloud project:deploy
   ```

   This deploys all custom records (configuration, validation config, API log) and uploads all SuiteScript files to the File Cabinet.

6. **Verify deployment** by navigating to:
   - Customization > Lists, Records, & Fields > Record Types — confirm the three QubitOn records exist
   - Documents > Files > SuiteScripts > QubitOn — confirm all script files are present

### Method 2: Manual Deployment

For environments where SDF is not available or when you need granular control over the deployment.

#### Step 1: Upload Script Files

1. Navigate to **Documents > Files > SuiteScripts**
2. Create a folder named `QubitOn`
3. Upload files from `src/FileCabinet/SuiteScripts/QubitOn/` to the folder:

   | Local Path | File Cabinet Path |
   |------------|-------------------|
   | `qubiton_api_client.js` | SuiteScripts/QubitOn/qubiton_api_client.js |
   | `qubiton_validation.js` | SuiteScripts/QubitOn/qubiton_validation.js |
   | `qubiton_vendor_ue.js` | SuiteScripts/QubitOn/qubiton_vendor_ue.js |
   | `qubiton_customer_ue.js` | SuiteScripts/QubitOn/qubiton_customer_ue.js |
   | `qubiton_client.js` | SuiteScripts/QubitOn/qubiton_client.js |
   | `qubiton_batch_mr.js` | SuiteScripts/QubitOn/qubiton_batch_mr.js |
   | `qubiton_config_sl.js` | SuiteScripts/QubitOn/qubiton_config_sl.js |

#### Step 2: Create Custom Records

1. Navigate to **Customization > Lists, Records, & Fields > Record Types > New**
2. Create each custom record type by importing the XML definition or manually creating the fields:

   **QubitOn Configuration** (`customrecord_qubiton_config`):
   - See `Objects/customrecord_qubiton_config.xml` for field definitions
   - Fields: API Key (password), Base URL (text), Timeout (integer), Error Mode (list), Enable Logging (checkbox)

   **QubitOn Validation Config** (`customrecord_qubiton_val_cfg`):
   - See `Objects/customrecord_qubiton_val_cfg.xml` for field definitions
   - Fields: Record Type (list), Error Mode Override (list), Country Filter (textarea), plus validation toggle checkboxes

   **QubitOn API Log** (`customrecord_qubiton_api_log`):
   - See `Objects/customrecord_qubiton_api_log.xml` for field definitions
   - Fields: Method (list), Endpoint (text), Status Code (integer), Duration (integer), User (employee), Error Message (textarea), Request Date (datetime)

#### Step 3: Create Script Records

1. Navigate to **Customization > Scripting > Scripts > New**
2. Create script records for each script type:

   | Script Type | Script File | Deployment Record Type |
   |-------------|-------------|----------------------|
   | User Event | qubiton_vendor_ue.js | Vendor |
   | User Event | qubiton_customer_ue.js | Customer |
   | Client Script | qubiton_client.js | Vendor, Customer |
   | Map/Reduce | qubiton_batch_mr.js | (scheduled) |
   | Suitelet | qubiton_config_sl.js | (standalone) |

3. For each script, create a deployment and set the status to **Released**.

## Configure API Key

1. Navigate to **Customization > Lists, Records, & Fields > Record Types**
2. Click **QubitOn Configuration**
3. Click **New** to create a configuration record
4. Enter your QubitOn API key in the **API Key** field
5. Review the default settings:
   - **Base URL**: `https://api.qubiton.com` (leave as default for production)
   - **Timeout**: `30` seconds
   - **Error Mode**: `W` (Warning) recommended for initial rollout
   - **Enable API Logging**: checked (recommended)
6. Click **Save**

## Network Access

NetSuite requires outbound HTTPS access to `api.qubiton.com`. In most accounts, this is available by default. If your account has restricted outbound access:

1. Contact NetSuite Support to allow outbound HTTPS traffic to:
   - Host: `api.qubiton.com`
   - Port: 443
   - Protocol: HTTPS (TLS 1.2+)

2. For sandbox accounts, the same network rules apply. No separate sandbox API endpoint is needed — use your development API key with the production URL.

## Deploy Scripts to Records

After installation, deploy the User Event and Client Scripts to the target record types:

### Vendor Validation

1. Navigate to **Customization > Scripting > Scripts**
2. Find **QubitOn Vendor UE** and click **Deployments**
3. Verify the deployment is set to:
   - **Record Type**: Vendor
   - **Status**: Released
   - **Execute As Role**: Administrator (or a role with API access)
   - **Event Type**: Before Submit (for blocking validation)

### Customer Validation

1. Same as above, but for the **QubitOn Customer UE** script
2. Deploy to **Record Type**: Customer

### Batch Validation

1. Find **QubitOn Batch Validate MR** script
2. Set up a scheduled deployment or trigger manually via **Customization > Scripting > Script Deployments**

## Verify Installation

Run a quick test to confirm everything is working:

1. Navigate to a vendor record
2. Edit the record and save
3. If validations are configured, you should see validation results (warnings or errors depending on error mode)
4. Check the **QubitOn API Log** records to verify API calls are being logged

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "SSS_MISSING_REQD_ARGUMENT" error | Ensure the QubitOn Configuration record exists with a valid API key |
| "SSS_REQUEST_TIME_EXCEEDED" | NetSuite caps server-side requests at ~5 min and does not expose a timeout option. Reduce payload size, or split the workload across a Map/Reduce script. |
| "UNEXPECTED_ERROR" on API call | Check network access to api.qubiton.com; verify API key is valid |
| Scripts not firing on record save | Verify script deployment status is "Released" and applies to the correct record type |
| No log records created | Confirm "Enable API Logging" is checked in QubitOn Configuration |
| "INVALID_API_KEY" response | Verify your API key at www.qubiton.com/dashboard; ensure no leading/trailing spaces |

## Next Steps

- [Configuration Guide](configuration.md) — fine-tune validation rules per record type
- [Examples](examples.md) — code examples for all 42 API methods
- [NetSuite Integration Patterns](netsuite-integration.md) — advanced integration patterns
