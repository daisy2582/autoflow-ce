# Autoflow Chrome Extension - Credentials & Access Information

## Important Security Note

⚠️ **This file contains sensitive credentials. Keep it secure and never commit to public repositories.**

---

## Autoflow Admin Panel

**URL:** https://autoflow.botauto.online/

**Credentials:**
- **Username:** `admin`
- **Password:** `admin123`

**Purpose:** Main Autoflow admin panel for managing the system.

---

## Winfix Admin Panel

**URL:** https://www.winfix.live/admin

**Purpose:** Used to look into all test users - deposit or password change.

**Navigation:**
1. Login
2. Click "Active Users"
3. Find all users

---

## Test User Accounts

### Winfix Test Users

| Panel URL | Website | Username | Password | User ID | Purpose | Notes |
|-----------|---------|----------|----------|---------|---------|-------|
| https://www.winfix.live/admin | winfix | agve11 | Vedd@1918 | 3616 | Main panel for raising withdrawal request | Testing - Boss@12345, spg017, apg014, Apg013 |
| https://www.winfix.live/admin | winfix | agve12 | Vedd@1716 | 463713 | Main panel for raising withdrawal request | Testing - Vedd@17167, mvp090, mvp091 |

---

## Supago Panel Logins

### Important Note on Login Groups

**Login Groups:** Multiple Supago logins can belong to the same group and will receive requests from the same users. They are replicas of the same login.

**Example:**
- `agve11`, `botagve11`, `botagve111` → All receive requests from the same users (same group)
- `agve12`, `botagve12`, `botagve122` → All receive requests from the same users (same group)

### Winfix Supago Logins

| Dashboard URL | Website | Username | Password | User ID | Purpose |
|---------------|---------|----------|----------|---------|---------|
| https://dashboard.supago.online/ | winfix.live/winfix withdrawal | agve11 | Vedd@1111 | 760127 | Pending to in-process |
| https://dashboard.supago.online/ | winfix.live/winfix withdrawal | botagve11 | Vedd@1111 | 594894 | In-process clear |
| https://dashboard.supago.online/ | winfix.live/winfix withdrawal | botagve111 | Vedd@11111 | 268975 | In-process clear |

**Group:** All three logins (`agve11`, `botagve11`, `botagve111`) belong to the same group and receive requests from the same users.

### Autoexchange Supago Logins

| Dashboard URL | Website | Username | Password | User ID | Purpose |
|---------------|---------|----------|----------|---------|---------|
| https://dashboard.supago.online/ | autoexchange | agve12 | Vedd@2222 | 713332 | Pending to in-process |
| https://dashboard.supago.online/ | autoexchange | botagve12 | Vedd@2222 | 975874 | In-process clear |
| https://dashboard.supago.online/ | autoexchange | botagve122 | Vedd@2222 | 541635 | In-process clear |

**Group:** All three logins (`agve12`, `botagve12`, `botagve122`) belong to the same group and receive requests from the same users.

---

## GatewayHub API Keys

**Location:** GatewayHub private key and public key are already configured in the extension code.

**File Location:** `autoflow-ce/utils/api.js`

**Configuration:**
- Keys are stored per website (WINFIX and AUTOEXCHANGE)
- Private key includes timestamp suffix (e.g., `_1750318262759`)
- Full key string (including timestamp) is used for HMAC signing

**Note:** Do not modify API keys unless you have new keys from GatewayHub.

---

## System Access Summary

### Development/Testing Environments

1. **Autoflow Admin Panel**
   - URL: https://autoflow.botauto.online/
   - Use for: System administration, monitoring

2. **Winfix Admin Panel**
   - URL: https://www.winfix.live/admin
   - Use for: Managing test users, deposits, password changes

3. **Supago Dashboard**
   - URL: https://dashboard.supago.online/
   - Use for: Testing Chrome Extension automation
   - Multiple logins available for testing different scenarios

### Testing Workflow

1. **Create Test Withdrawal Request:**
   - Login to Winfix Admin Panel
   - Navigate to Active Users
   - Create withdrawal request for test user

2. **Test Chrome Extension:**
   - Login to Supago Dashboard using one of the test accounts
   - Extension should automatically process pending orders
   - Monitor in Chrome DevTools console

3. **Verify Processing:**
   - Check Autoflow Admin Panel for order status
   - Verify order appears in database
   - Check GatewayHub webhook responses

---

## Password Reset

If you need to reset passwords:

1. **Winfix Admin Panel:**
   - Use Winfix Admin Panel → Active Users → Reset Password

2. **Supago Dashboard:**
   - Contact Supago support or use password reset feature


