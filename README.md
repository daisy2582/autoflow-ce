# Autoflow Chrome Extension (autoflow-ce)

## Overview

Autoflow Chrome Extension is an automated order processing system for Supago dashboard that handles withdrawal request processing. It automates the entire workflow from detecting pending orders, sending them to GatewayHub API, saving to database, and processing status mismatches.

### What It Does

1. **Pending Order Processing**: Scrapes pending withdrawal orders from Supago dashboard, sends them to GatewayHub API, and marks them as "In Process"
2. **Mismatch Order Processing**: Processes orders where the Supago status doesn't match GatewayHub webhook status (e.g., GatewayHub says "success" but order is still pending in Supago)
3. **Database Management**: Maintains a local database of all processed orders for duplicate detection and tracking
4. **Automated Login**: Handles Supago dashboard login automatically using stored credentials
5. **Status Synchronization**: Ensures Supago dashboard status matches GatewayHub webhook responses

---

## Project Structure

```
autoflow-ce/
├── manifest.json              # Chrome Extension manifest (Manifest V3)
├── background.js              # Background service worker (handles CORS proxy)
├── content.js                 # Main content script (runs on Supago dashboard)
├── popup/                     # Extension popup UI
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── utils/                     # Utility modules
│   ├── api.js                 # API communication (GatewayHub & Database)
│   ├── crypto.js              # Encryption & hashing utilities
│   ├── storage.js             # Chrome storage management
│   └── scraper.js             # DOM scraping utilities
├── backend/                   # Node.js backend API server
│   ├── server.js              # Express API server
│   ├── package.json
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── init.sql               # Database schema
├── icons/                     # Extension icons
├── kubernetes/                # Kubernetes deployment configs
│   ├── staging/
│   └── prod/
└── WORKFLOW.md                # Detailed workflow documentation

```

---

## Architecture

### Components

#### 1. **Content Script** (`content.js`)
- Runs on `https://dashboard.supago.online/*`
- Handles all UI interaction and automation logic
- Scrapes orders from dashboard tables
- Processes pending and in-process orders
- Manages login and navigation

#### 2. **Background Script** (`background.js`)
- Chrome Extension service worker
- Proxies API requests to bypass CORS restrictions
- Handles GatewayHub API calls from content script

#### 3. **Backend API** (`backend/server.js`)
- Express.js REST API server
- Connects to PostgreSQL database (shared with Autoflow main backend)
- Provides endpoints for order management:
  - Order existence checks
  - Order creation
  - Status updates
  - Mismatch order queries

#### 4. **Utilities**
- **`utils/api.js`**: Handles all API calls (GatewayHub, database)
- **`utils/crypto.js`**: Order hash generation (SHA-256), HMAC signing
- **`utils/storage.js`**: Chrome storage wrapper for settings/credentials
- **`utils/scraper.js`**: DOM parsing utilities for extracting order data

---

## Setup & Installation

### Prerequisites

- Node.js 16+ and npm
- PostgreSQL database (shared with Autoflow main backend)
- Chrome browser
- Supago dashboard access credentials

### 1. Install Chrome Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the `autoflow-ce` directory
5. Extension should appear in your extensions list

### 2. Configure Extension Settings

1. Click the extension icon in Chrome toolbar
2. Fill in the popup form:
   - **Username**: Your Supago dashboard username
   - **Password**: Your Supago dashboard password
   - **Website Name**: `WINFIX` or `AUTOEXCHANGE` (depends on your Supago account)
   - **Database API URL**: 
     - Local: `http://localhost:3000`
     - Staging: `https://autoflow-ce-api-staging.botauto.online`
     - Production: `https://autoflow-ce-api.botauto.online`
   - **Automation Mode**: 
     - `pending`: Only process pending orders
     - `in_process`: Only process mismatch orders
     - `both`: Process both (recommended)
3. Click "Save Settings"
4. Credentials are encrypted and stored locally in Chrome storage

### 3. Setup Backend API

```bash
cd autoflow-ce/backend

# Install dependencies
npm install

# Configure environment variables
# Create .env file or use .env.example for staging
cp .env.example .env

# Edit .env with your database credentials:
# DB_USER=postgres
# DB_PASSWORD=your_password
# DB_HOST=localhost
# DB_PORT=5433
# DB_NAME=supago_bot
# DB_SSL=false  # Set to 'true' for AWS RDS

# Start backend server
npm start
# Or for development with auto-reload:
npm run dev
```

### 4. Database Setup

The extension uses the same PostgreSQL database as the Autoflow main backend (`supago_bot`). Ensure:

1. Database is running and accessible
2. `transactions` table exists (shared with Autoflow)
3. Backend API can connect to database

**Database Schema** (shared with Autoflow):
- Table: `transactions`
- Key columns:
  - `order_id`: Unique order identifier (format: `UUID_loginTag`)
  - `order_hash`: SHA-256 hash for duplicate detection
  - `status`: Order status (`pending`, `in_process`, `success`, `failed`)
  - `gateway_status`: Status from GatewayHub webhook (`pending`, `success`, `failed`)
  - `final_action`: Final action taken (`accept`, `reject`)
  - `login_group_key`: Group key for filtering orders
  - `utr`: UTR (Unique Transaction Reference) from GatewayHub
  - `supago_withdrawal_hash`: Hash to match orders in Supago dashboard

---

## How It Works

### Workflow Overview

```
┌─────────────────────────────────────────────────────────┐
│ 1. Extension Initializes                                │
│    - Checks if user is logged into Supago               │
│    - Performs login if needed                           │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 2. Navigate to Withdrawal Requests Page                 │
│    - Finds "Manual Withdrawal Requests" menu            │
│    - Clicks to navigate                                 │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 3. Process Pending Orders (Phase 1)                     │
│    - Scrapes orders from "Pending" view                 │
│    - For each order:                                    │
│      * Generate order hash (duplicate detection)        │
│      * Check if order exists in database                │
│      * Send to GatewayHub API                           │
│      * Save to database                                 │
│      * Click "In Process" button if API success         │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 4. Process Mismatch Orders (Phase 2)                    │
│    - Switches to "In-process" view                      │
│    - Queries database for orders with status mismatch   │
│    - For each mismatch:                                 │
│      * Search for order on Supago dashboard             │
│      * Enter UTR in remark field                        │
│      * Click Accept (if gateway_status='success')       │
│      * OR Click Reject (if gateway_status='failed')     │
│      * Update database                                  │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ 5. Polling & Continuous Operation                       │
│    - Pending polling: Every 2 seconds (click Load)      │
│    - Mismatch polling: Every 60 seconds                 │
│    - Login config polling: Every 180 seconds            │
└─────────────────────────────────────────────────────────┘
```

### Key Features

#### 1. **Pending Order Processing**
- Detects new pending withdrawal orders on Supago dashboard
- Generates unique order hash for duplicate detection
- Sends order to GatewayHub API with HMAC authentication
- Saves order to database immediately after reading
- Clicks "In Process" button after successful API call

#### 2. **Mismatch Order Processing**
- Finds orders where `status ≠ gateway_status`
- Examples:
  - Order is `pending` but GatewayHub webhook says `success`
  - Order is `success` but GatewayHub webhook says `failed`
- Processes mismatch orders by clicking Accept/Reject buttons
- Enters UTR (Unique Transaction Reference) in remark field before clicking

#### 3. **Timeout Management**
- 5-minute timeout per view (pending/in-process)
- If timeout occurs:
  - Switches to other view and processes those orders
  - Switches back to continue remaining orders
- Prevents single slow operation from blocking everything

#### 4. **Group Filtering**
- Filters orders by `login_group_key` to prevent conflicts
- Ensures Chrome Extension only processes orders from its own group
- Prevents duplicate processing when multiple extensions/autobots run

#### 5. **Duplicate Prevention**
- Uses SHA-256 hash of `amount|date|username|acc_number|ifsc`
- Checks database before processing each order
- Skips orders that already exist

---

## Configuration

### Extension Settings (Chrome Storage)

| Setting | Type | Description | Default |
|---------|------|-------------|---------|
| `websiteName` | string | `WINFIX` or `AUTOEXCHANGE` | `WINFIX` |
| `dbApiUrl` | string | Backend API URL | `https://autoflow-ce-api.botauto.online` |
| `automationMode` | string | `pending`, `in_process`, or `both` | `both` |
| `credentials` | object | Encrypted username/password | - |

### Backend Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_USER` | PostgreSQL username | `postgres` |
| `DB_PASSWORD` | PostgreSQL password | - |
| `DB_HOST` | Database host | `localhost` |
| `DB_PORT` | Database port | `5433` |
| `DB_NAME` | Database name | `supago_bot` |
| `DB_SSL` | Enable SSL (`true`/`false`) | `false` |
| `PORT` | Backend API port | `3000` |
| `NODE_ENV` | Environment (`staging`/`production`) | `production` |

### GatewayHub API Configuration

- **Endpoint**: `https://api-prod.gatewayhub.live/withdraw/bot`
- **Authentication**: HMAC-SHA256 using public/private key pair
- **Keys**: Configured per website in `utils/api.js`

---

## Backend API Endpoints

### Order Management

#### `GET /api/orders/exists/:orderHash`
Check if an order with given hash exists in database.

**Response:**
```json
{
  "exists": true,
  "order": {
    "order_id": "uuid_loginTag",
    "status": "pending",
    "gateway_status": "success",
    ...
  }
}
```

#### `POST /api/orders`
Create a new order in database.

**Request Body:**
```json
{
  "order_hash": "sha256_hash",
  "order_id": "uuid_loginTag",
  "username": "username",
  "amount": 1000,
  "acc_number": "1234567890",
  "bank_name": "HDFC",
  "ifsc": "HDFC0001234",
  "acc_holder_name": "John Doe",
  "status": "pending"
}
```

#### `GET /api/orders/with-mismatch?login_group_key=xxx`
Get orders with status mismatch (for mismatch processing).

**Query Parameters:**
- `login_group_key` (optional): Filter by group key

**Response:**
```json
{
  "orders": [...],
  "count": 5
}
```

#### `PUT /api/orders/hash/:orderHash/status`
Update order status.

**Request Body:**
```json
{
  "finalAction": "accept" | "reject",
  "statusDetail": "Optional message"
}
```

#### `GET /api/login-config/:username`
Get login configuration (execution channel, permissions).

**Response:**
```json
{
  "found": true,
  "login": {
    "id": 7,
    "username": "agve11",
    "is_active": true,
    "execution_channel": "chrome_extension",
    "login_group_key": "gagve11",
    "handles_pending": true,
    "handles_in_process": true
  }
}
```

---

## Development

### Running Locally

1. **Start Backend:**
```bash
cd autoflow-ce/backend
npm install
npm run dev  # Starts with nodemon (auto-reload)
```

2. **Load Extension:**
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" → Select `autoflow-ce` directory
   - Extension should load

3. **Test:**
   - Navigate to Supago dashboard
   - Open Chrome DevTools (F12)
   - Check Console for extension logs (prefixed with `[Supago]`)

### Debugging

**Content Script Logs:**
- Open Chrome DevTools on Supago dashboard
- Check Console tab
- All logs are prefixed with `[Supago]`

**Background Script Logs:**
- Go to `chrome://extensions/`
- Find "Supago Order Automation" extension
- Click "Inspect views: service worker"
- Check Console for background script logs

**Backend Logs:**
- Check terminal where backend is running
- All API requests are logged

### Common Issues

#### Extension not loading
- Check `manifest.json` for syntax errors
- Verify all file paths in manifest exist
- Check Chrome Extensions page for errors

#### API requests failing
- Verify backend is running (`http://localhost:3000`)
- Check CORS settings in backend
- Verify database connection

#### Orders not processing
- Check Chrome DevTools console for errors
- Verify credentials are saved correctly
- Check if logged into Supago dashboard
- Verify database connection

#### Duplicate orders
- Check order hash generation logic
- Verify database has correct hash values
- Check for timing issues (multiple instances running)

---

## Key Functions Reference

### Content Script (`content.js`)

| Function | Purpose |
|----------|---------|
| `initialize()` | Extension initialization |
| `runAutomation()` | Main automation cycle |
| `isLoggedIn()` | Check if user is logged in |
| `performLogin()` | Automated login |
| `navigateToWithdrawalRequests()` | Navigate to orders page |
| `processPendingOrders()` | Process new pending orders |
| `processInProcessOrders()` | Process mismatch orders |
| `switchToInProcessView()` | Switch to in-process view |
| `ensurePendingView()` | Ensure on pending view |
| `checkForOrdersWithMismatch()` | Query for mismatch orders |
| `pollPendingOrders()` | Poll for pending orders (every 2s) |
| `pollMismatchOrders()` | Poll for mismatch orders (every 60s) |

### Utilities

#### `utils/api.js`
- `sendToGatewayHub(orderData, websiteName)`: Send order to GatewayHub API
- `checkOrderExists(orderHash, apiUrl)`: Check if order exists in DB
- `saveOrder(orderData, apiUrl)`: Save order to database
- `updateOrderStatus(orderId, action, apiUrl)`: Update order status
- `getOrdersWithMismatch(apiUrl, loginGroupKey)`: Get mismatch orders
- `getLoginConfig(username, apiUrl)`: Get login configuration

#### `utils/scraper.js`
- `scrapeAllOrders()`: Extract all orders from current page
- `extractOrderFromRow(row)`: Extract order data from table row
- `extractBankDetailsFromCell(cell)`: Extract bank details from cell
- `findInProcessButton(orderData)`: Find "In Process" button for order
- `findApproveButton(orderData)`: Find "Accept" button
- `findRejectButton(orderData)`: Find "Reject" button
- `searchByUsernameInPage(username)`: Search table by username

#### `utils/crypto.js`
- `generateOrderHash(orderData)`: Generate SHA-256 hash for order
- `generatePayloadHash(payload, privateKey)`: Generate HMAC-SHA256 for API
- `encryptText(text, key)`: Encrypt text (AES)
- `decryptText(encryptedText, key)`: Decrypt text (AES)

#### `utils/storage.js`
- `getSettings()`: Get extension settings
- `saveSettings(settings)`: Save settings
- `getCredentials()`: Get encrypted credentials
- `saveCredentials(credentials)`: Save encrypted credentials

---

## Deployment

### Backend Deployment

**Docker:**
```bash
cd autoflow-ce/backend
docker-compose up -d
```

**Kubernetes:**
```bash
cd autoflow-ce/kubernetes/prod
kubectl apply -f deploy.yaml
```

### Extension Distribution

1. **Build for Production:**
   - Update version in `manifest.json`
   - Test thoroughly
   - Zip the extension directory

2. **Publish to Chrome Web Store:**
   - Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   - Create new item
   - Upload zip file
   - Fill in store listing details
   - Submit for review

---

## Troubleshooting

### Orders not appearing in database
- Check backend API logs for errors
- Verify database connection
- Check order hash generation

### Extension stops working
- Check Chrome Extensions page for errors
- Reload extension
- Check console for JavaScript errors

### GatewayHub API failures
- Verify API keys are correct
- Check payload hash generation
- Verify HMAC signing logic

### Status mismatch not detected
- Check database for `gateway_status` values
- Verify mismatch query logic
- Check `login_group_key` filtering

---

## Related Documentation

- **WORKFLOW.md**: Detailed workflow documentation with step-by-step flows
- **CREDENTIALS.md**: Login credentials and system access information (⚠️ **Keep secure - not in version control**)
- **Backend README**: `backend/README.md` for backend-specific docs

---

## Support

For issues or questions:
1. Check Chrome DevTools console for errors
2. Review backend logs
3. Check database for order status
4. Verify configuration settings

---

## License

MIT

---

## Version History

- **v1.0.0**: Initial release
  - Pending order processing
  - Mismatch order processing
  - Database integration
  - GatewayHub API integration

