# Supago Order Automation - Detailed Workflow

## Overview
This Chrome extension automates the processing of withdrawal orders from the Supago dashboard. It handles login, order scraping, API integration, and database management.

---

## 1. Initial Setup & Configuration

### Extension Components
- **Content Script** (`content.js`) - Runs on `dashboard.supago.online`
- **Background Script** (`background.js`) - Handles CORS proxy for API requests
- **Utilities**:
  - `utils/api.js` - API communication (GatewayHub & Database)
  - `utils/crypto.js` - Encryption & hashing
  - `utils/storage.js` - Chrome storage management
  - `utils/scraper.js` - DOM scraping utilities

### Configuration Storage
- **Settings** (stored in Chrome storage):
  - `websiteName`: 'WINFIX' or 'AUTOEXCHANGE'
  - `dbApiUrl`: Database API URL (default: `http://localhost:3000`)
  - `autoClickInProcess`: Boolean flag

- **Credentials** (encrypted in Chrome storage):
  - `username`: Encrypted username
  - `password`: Encrypted password

### Database Setup
- PostgreSQL running in Docker (port 5434)
- Database: `supago_bot`
- User: `postgres`
- Tables: `orders` (stores all processed orders)

---

## 2. Extension Initialization

### Step-by-Step Flow

```
1. Extension loads on dashboard.supago.online
   ↓
2. Content script initializes (content.js)
   ↓
3. Check dependencies loaded:
   - crypto.js ✓
   - storage.js ✓
   - api.js ✓
   - scraper.js ✓
   ↓
4. Wait 2 seconds for page to fully load
   ↓
5. Start automation cycle (runAutomation function)
```

### Code Location
- **File**: `content.js`
- **Function**: `initialize()`
- **Trigger**: Page load / DOMContentLoaded

---

## 3. Login Detection & Authentication

### Login Check (`isLoggedIn()`)

**Flow:**
```
1. Check for login form elements (username/password fields)
   → If found: User is NOT logged in → return false
   
2. Check URL pathname for dashboard routes:
   - /dashboard
   - /deposit
   - /withdraw
   - /orders
   - /manual
   → If found: Likely logged in → return true
   
3. Check for dashboard UI elements:
   - Logout button/link
   - User menu
   - Sidebar navigation
   - Header user info
   → If found: User is logged in → return true
   
4. Default: return false (not logged in)
```

**Session Duration**: 24 hours (auto-logout after 24 hours)

### Login Process (`performLogin()`)

**Flow:**
```
1. Retrieve encrypted credentials from Chrome storage
   ↓
2. Decrypt username and password
   ↓
3. Find login form elements:
   - Username input field
   - Password input field
   - Login button
   ↓
4. Fill credentials (triggering React change events)
   ↓
5. Click login button
   ↓
6. Wait for navigation (up to 10 seconds):
   - Monitor URL change
   - Monitor login form disappearance
   ↓
7. Verify login success (retry up to 5 times):
   - Check if logged in status
   - Wait 1 second between retries
   ↓
8. Return success/failure
```

**Code Location**: `content.js` → `performLogin()`

---

## 4. Navigation to Withdrawal Requests

### Navigation Flow (`navigateToWithdrawalRequests()`)

```
1. Find "Manual Withdrawal Requests" menu item
   - Strategy 1: Find by href="/withdraw-request"
   - Strategy 2: Find by href + text content
   - Strategy 3: Find by text content only
   ↓
2. Scroll element into view
   ↓
3. Click the menu item
   ↓
4. Wait 2 seconds for navigation
   ↓
5. Verify still logged in (check for login redirect)
   ↓
6. Wait 1.5 seconds for page content to load
   ↓
7. Ensure orders are loaded (click "Load" button if needed)
   ↓
8. Return success/failure
```

**Code Location**: `content.js` → `navigateToWithdrawalRequests()`

**Load Button**: The page may require clicking a "Load" button to fetch order data from the server.

---

## 5. Order Scraping

### Scraping Process (`scrapeAllOrders()`)

**Flow:**
```
1. Find all table rows in orders table
   - Selector: `table tbody tr`
   ↓
2. For each row, extract order data:
   - order_id (column 0)
   - date (column 1)
   - username (column 2)
   - acc_holder_name (column 3)
   - amount (column 4) - extract numbers only
   - bank_name (column 5)
   - acc_number (column 6)
   - ifsc (column 7)
   ↓
3. Return array of order objects
```

**Code Location**: `utils/scraper.js` → `scrapeAllOrders()`

**Order Object Structure:**
```javascript
{
  order_id: string,
  date: string,
  username: string,
  acc_holder_name: string,
  amount: string (numbers only),
  bank_name: string,
  acc_number: string,
  ifsc: string
}
```

---

## 6. Processing Pending Orders

### Main Flow (`processPendingOrders()`)

```
For each order found on page:
  ↓
1. Generate Order Hash
   - Input: amount|date|username|acc_number|ifsc
   - Algorithm: SHA-256
   - Purpose: Duplicate detection
   ↓
2. Check if Order Exists in Database
   - API: GET /api/orders/exists/{order_hash}
   - If exists: Skip order, increment skipped count
   ↓
3. Send Order to GatewayHub API
   - Prepare payload with all order fields
   - Generate HMAC-SHA256 hash using private key
   - Send POST request via background proxy
   - Current endpoint: webhook.site (for testing)
   ↓
4. Save Order to Database
   - Prepare order data object
   - API: POST /api/orders
   - Status: 'in-process' if API success, 'failed' if API fails
   ↓
5. Handle API Success
   - If API returned success:
     * Find and click "In-process" button for this order
     * Update order status in database
   ↓
6. Continue to next order
   - Small delay (1-2 seconds) between orders
```

### Order Hash Generation

**Code Location**: `utils/crypto.js` → `generateOrderHash()`

**Hash Input Format:**
```
{amount}|{date}|{username}|{acc_number}|{ifsc}
```

**Example:**
```
1000|2024-01-15|john_doe|1234567890|SBIN0001234
```

### GatewayHub API Request

**Payload Structure:**
```javascript
{
  userId: 1,
  username: "john_doe",
  name: "John Doe",
  amount: 1000,
  bank_name: "State Bank",
  acc_number: "1234567890",
  ifsc: "SBIN0001234",
  acc_holder_name: "John Doe",
  order_id: "ORDER123"
}
```

**Headers:**
```
public-key: {API_PUBLIC_KEY}
payload-hash: {HMAC_SHA256_HASH}
Content-Type: application/json
```

**Code Location**: `utils/api.js` → `sendToGatewayHub()`

### Database Save

**Order Data Saved:**
```javascript
{
  order_hash: string (64 char hex),
  order_id: string,
  username: string,
  acc_holder_name: string,
  amount: integer,
  bank_name: string,
  acc_number: string,
  ifsc: string,
  order_date: string,
  status: 'in-process' | 'failed',
  txn_id: string (from API response),
  utr: string (from API response),
  api_status: 'success' | 'failed',
  processed_at: timestamp,
  scraped_at: timestamp
}
```

**Code Location**: `utils/api.js` → `saveOrder()`

---

## 7. Switching to In-Process View

### Status Filter Flow (`switchToInProcessView()`)

```
1. Find status combobox button
   - Look for button[role="combobox"]
   - Check if it contains "Pending" text
   ↓
2. Verify current status
   - If already showing "In-process": Skip to step 5
   ↓
3. Click combobox to open dropdown
   - Scroll button into view
   - Click button
   - Wait 500ms for dropdown to appear
   ↓
4. Find and select "In-process" option
   - Wait for dropdown options to appear (up to 5 seconds)
   - Search for option containing "in-process" text
   - Click the option
   ↓
5. Wait for view to update
   - Wait 1 second
   - Verify button text changed to "In-process"
   ↓
6. Ensure orders are loaded
   - Click "Load" button if present
   - Wait 1.5 seconds
   ↓
7. Return success
```

**Code Location**: `content.js` → `switchToInProcessView()`

---

## 8. Processing In-Process Orders

### Main Flow (`processInProcessOrders()`)

```
For each in-process order found:
  ↓
1. Generate Order Hash (same as pending orders)
   ↓
2. Check Order in Database
   - API: GET /api/orders/exists/{order_hash}
   - If not found: Skip order (wasn't processed by us)
   ↓
3. Check Order Status
   - If already processed (has final_action): Skip
   ↓
4. Determine Action (Approve/Reject)
   - If api_status === 'success': → Approve
   - If api_status === 'failed': → Reject
   ↓
5. Find Action Button
   - Approve button: Contains "approve" text
   - Reject button: Contains "reject" text
   - Match by order_id in same table row
   ↓
6. Click Button
   - Click approve/reject button
   - Wait 500ms
   ↓
7. Update Database
   - API: PUT /api/orders/hash/{order_hash}/status
   - Body: { finalAction: 'approved' | 'rejected' }
   ↓
8. Continue to next order
   - Small delay (1-2 seconds) between orders
```

**Code Location**: `content.js` → `processInProcessOrders()`

---

## 9. Complete Automation Cycle

### Main Automation Flow (`runAutomation()`)

```
┌─────────────────────────────────────┐
│  START AUTOMATION CYCLE             │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Phase 1: Login Check               │
│  - Check if logged in               │
│  - If not: Perform login            │
│  - Wait for session establishment   │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Phase 2: Navigate                  │
│  - Navigate to Withdrawal Requests  │
│  - Verify navigation success        │
│  - Handle session expiration        │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Phase 3: Process Pending Orders    │
│  - Scrape orders from page          │
│  - For each order:                  │
│    * Check duplicates               │
│    * Send to GatewayHub API         │
│    * Save to database               │
│    * Click in-process if success    │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Phase 4: Switch to In-Process View │
│  - Click status combobox            │
│  - Select "In-process" option       │
│  - Load orders                      │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Phase 5: Process In-Process Orders │
│  - Scrape in-process orders         │
│  - For each order:                  │
│    * Verify in database             │
│    * Approve or reject based on     │
│      API status                     │
│    * Update database                │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  Schedule Next Refresh              │
│  - Calculate next run time          │
│  - Add random variance (3 min ±30s) │
│  - Schedule page reload             │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  CYCLE COMPLETE                     │
└─────────────────────────────────────┘
```

**Refresh Interval**: 3 minutes (with ±30 seconds random variance)

**Code Location**: `content.js` → `runAutomation()`

---

## 10. Background Proxy for API Requests

### CORS Bypass Flow

```
Content Script needs to make API request
              ↓
Send message to background script
              ↓
Background script receives message
  action: 'proxyRequest'
              ↓
Background script makes fetch request
  (has CORS permissions)
              ↓
Receive response from API
              ↓
Parse response (handle JSON/text)
              ↓
Send response back to content script
              ↓
Content script receives response
```

**Code Location**: 
- Content Script: `utils/api.js` → `sendToGatewayHub()`
- Background: `background.js` → `proxyRequest` handler

---

## 11. Error Handling

### Common Errors & Handling

1. **Login Failed**
   - Retry up to 5 times with delays
   - Log detailed error messages
   - Abort automation if persistent

2. **Navigation Failed**
   - Check if redirected to login
   - Attempt re-login if needed
   - Retry navigation

3. **API Request Failed**
   - Log error details
   - Continue with next order
   - Save order with 'failed' status

4. **Database Error**
   - Log error but continue processing
   - Order won't be saved but API call still made

5. **Element Not Found**
   - Log available alternatives
   - Retry with different selectors
   - Skip step if critical element missing

---

## 12. Data Flow Diagram

```
┌──────────────┐
│ Supago       │
│ Dashboard    │
└──────┬───────┘
       │
       │ (Content Script Scrapes)
       ↓
┌──────────────────────────────────────┐
│ Chrome Extension                     │
│                                      │
│  ┌────────────┐    ┌──────────────┐ │
│  │ Content    │───▶│ Crypto Utils │ │
│  │ Script     │    │ (Hashing)    │ │
│  └────────────┘    └──────────────┘ │
│       │                               │
│       │    ┌──────────────────┐      │
│       └───▶│ API Utils        │      │
│            │ (GatewayHub API) │      │
│            └────────┬─────────┘      │
│                     │                │
└─────────────────────┼────────────────┘
                      │
                      │ (Via Background Proxy)
                      ↓
┌──────────────────────────────────────┐
│ GatewayHub API                       │
│ (webhook.site for testing)           │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ Backend Database API                 │
│ http://localhost:3000                │
│                                      │
│  POST /api/orders                    │
│  GET  /api/orders/exists/:hash       │
│  PUT  /api/orders/hash/:hash/status  │
└──────────────┬───────────────────────┘
               │
               ↓
┌──────────────────────────────────────┐
│ PostgreSQL Database                  │
│ (Docker Container - Port 5434)       │
│                                      │
│  Database: supago_bot             │
│  Table: orders                       │
└──────────────────────────────────────┘
```

---

## 13. Key Functions Reference

| Function | File | Purpose |
|----------|------|---------|
| `initialize()` | content.js | Extension initialization |
| `runAutomation()` | content.js | Main automation cycle |
| `isLoggedIn()` | content.js | Check login status |
| `performLogin()` | content.js | Automated login |
| `navigateToWithdrawalRequests()` | content.js | Navigate to orders page |
| `scrapeAllOrders()` | scraper.js | Extract orders from page |
| `processPendingOrders()` | content.js | Process new orders |
| `switchToInProcessView()` | content.js | Change status filter |
| `processInProcessOrders()` | content.js | Approve/reject orders |
| `generateOrderHash()` | crypto.js | Create unique order hash |
| `sendToGatewayHub()` | api.js | Send order to API |
| `checkOrderExists()` | api.js | Check database for duplicate |
| `saveOrder()` | api.js | Save order to database |
| `updateOrderStatus()` | api.js | Update order status |

---

## 14. Configuration Points

### Environment Variables (Backend)
- `DB_USER`: PostgreSQL user (default: `postgres`)
- `DB_PASSWORD`: PostgreSQL password
- `DB_HOST`: Database host (default: `localhost`)
- `DB_PORT`: Database port (default: `5434`)
- `DB_NAME`: Database name (default: `supago_bot`)

### Extension Settings (Chrome Storage)
- `websiteName`: 'WINFIX' or 'AUTOEXCHANGE'
- `dbApiUrl`: Database API URL
- `credentials`: Encrypted username/password

### API Configuration
- **GatewayHub Endpoint**: Currently set to webhook.site for testing
- **API Keys**: Hardcoded in `utils/api.js` for each website
- **Payload Hash**: HMAC-SHA256 using private key

---

## 15. Testing Checklist

- [ ] Extension loads correctly
- [ ] Login detection works (logged in vs not logged in)
- [ ] Automatic login works
- [ ] Navigation to withdrawal requests works
- [ ] Order scraping extracts all fields correctly
- [ ] Order hash generation creates unique hashes
- [ ] Database duplicate check works
- [ ] GatewayHub API request sent with correct payload
- [ ] Orders saved to database correctly
- [ ] Status filter switch works (Pending → In-process)
- [ ] In-process order approval/rejection works
- [ ] Error handling works for all error cases
- [ ] Refresh cycle schedules correctly

---

## 16. Future Improvements

1. **Configuration UI**: Allow updating API endpoint from popup
2. **Error Notifications**: Browser notifications for critical errors
3. **Retry Logic**: Automatic retry for failed API requests
4. **Statistics**: Track success/failure rates
5. **Manual Override**: Ability to manually approve/reject from popup
6. **Multi-account**: Support for multiple Supago accounts

---

This workflow document provides a comprehensive overview of how the Supago automation extension works from start to finish.




