// API utilities for remote server and database communication

// API Keys for GatewayHub
// Note: These keys are also stored in backend/.env file for reference
// For Chrome extensions, keys need to be in the code, but they can be loaded
// from the backend API in the future if needed for better security
// API Keys for GatewayHub
// Loaded dynamically from backend to avoid hardcoding in client
let API_KEYS = null;

/**
 * Helper function to make fetch requests via background script proxy (bypasses CORS)
 * @param {string} url - Request URL
 * @param {Object} options - Fetch options (method, headers, body, etc.)
 * @returns {Promise<Object>} Response data
 */
function proxyFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        // Check if chrome.runtime is available
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
            reject(new Error('Chrome extension runtime is not available. Please reload the extension.'));
            return;
        }

        // Helper function to send the actual request
        const sendRequest = (retryCount = 0) => {
            chrome.runtime.sendMessage({
                action: 'proxyRequest',
                data: {
                    url: url,
                    options: options
                }
            }, (response) => {
                // Check for runtime errors (background script not available)
                if (chrome.runtime.lastError) {
                    const errorMsg = chrome.runtime.lastError.message;
                    console.error('[API Proxy] Runtime error:', errorMsg);

                    // If it's a connection error and we haven't retried yet, try again after a delay
                    if (errorMsg.includes('Receiving end does not exist') && retryCount < 2) {
                        console.warn(`[API Proxy] Background script not ready (attempt ${retryCount + 1}/3). Retrying...`);
                        setTimeout(() => sendRequest(retryCount + 1), 1000 * (retryCount + 1)); // Exponential backoff
                        return;
                    }

                    // Final failure - provide clear error message
                    reject(new Error(`Background script unavailable: ${errorMsg}. Please reload the extension in chrome://extensions or refresh this page.`));
                    return;
                }

                // Check response
                if (response && response.success) {
                    resolve(response.data);
                } else {
                    console.error('[API Proxy] Request failed:', response);
                    reject(new Error(response?.error || 'Unknown proxy error'));
                }
            });
        };

        // Send the request (will retry automatically if needed)
        sendRequest();
    });
}

/**
 * Fetch API keys from backend configuration
 * @returns {Promise<Object>} API keys object
 */
async function fetchConfig() {
    if (API_KEYS) return API_KEYS;

    try {
        console.log('[API] Fetching configuration from backend...');
        // Get dbApiUrl from settings (will use production by default, can be overridden in popup)
        const settings = await getSettings();
        // TODO: replace with your actual production CE API host if different
        const dbApiUrl = settings?.dbApiUrl || 'https://autoflow-ce-api.botauto.online';
        const config = await proxyFetch(`${dbApiUrl}/api/config`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        // Validate config structure
        if (!config.WINFIX || !config.AUTOEXCHANGE) {
            console.error('[API] Invalid config received:', config);
            throw new Error('Invalid configuration received from backend');
        }

        API_KEYS = config;
        console.log('[API] Configuration loaded successfully');
        return API_KEYS;
    } catch (error) {
        console.error('[API] Error loading configuration:', error);
        // Fallback or rethrow depending on requirements. 
        // For now, rethrow because we can't proceed without keys.
        throw new Error(`Could not load API keys: ${error.message}. Ensure backend is running.`);
    }
}

/**
 * Map username to website name (WINFIX or AUTOEXCHANGE)
 * @param {string} username - Username from login credentials
 * @returns {string} 'WINFIX' or 'AUTOEXCHANGE'
 */
function getWebsiteNameFromUsername(username) {
    if (!username) {
        console.warn('[API] No username provided, defaulting to WINFIX');
        return 'WINFIX';
    }

    const normalizedUsername = username.trim().toLowerCase();

    // AUTOEXCHANGE usernames
    const autoexchangeUsernames = [
        'botauto23',
        'botauto1'
        // Add more AUTOEXCHANGE usernames here as needed
    ];

    // WINFIX usernames
    const winfixUsernames = [
        'mvikdepo',
        'agve369u',
        'agve12v',
        'umair78',
        'agve11',  // Staging credentials
        'agve12',  // Staging credentials
        'botagve11',  // Bot credentials
        'botagve111',  // Bot credentials (variant)
        'pandey369',
        'pandey21',
        'pandey78',
        'wfhauto23',
        'wfhauto1'
    ];

    if (autoexchangeUsernames.includes(normalizedUsername)) {
        console.log(`[API] Username "${username}" mapped to AUTOEXCHANGE`);
        return 'AUTOEXCHANGE';
    }

    if (winfixUsernames.includes(normalizedUsername)) {
        console.log(`[API] Username "${username}" mapped to WINFIX`);
        return 'WINFIX';
    }

    // Default to WINFIX if username not found in mapping
    console.warn(`[API] Username "${username}" not found in mapping, defaulting to WINFIX`);
    return 'WINFIX';
}

/**
 * Send order to GatewayHub API
 * @param {Object} orderData - Order data
 * @param {string} websiteName - 'WINFIX' or 'AUTOEXCHANGE'
 * @returns {Promise<Object>} API response
 */
async function sendToGatewayHub(orderData, websiteName) {
    // Ensure keys are loaded
    if (!API_KEYS) {
        await fetchConfig();
    }

    const apiKeys = API_KEYS[websiteName];

    if (!apiKeys) {
        throw new Error(`Invalid website name: ${websiteName}`);
    }

    // Parse and format amount - handle various formats
    // Format amount: if whole number (e.g. 735.0), send as integer (735)
    // If has decimals (e.g. 15.79), send as decimal (15.79)
    let parsedAmount = 0;
    if (orderData.amount) {
        // Remove currency symbols, commas, spaces
        const cleanAmount = String(orderData.amount).replace(/[₹$,\s]/g, '');
        const amountFloat = parseFloat(cleanAmount) || 0;
        // Round to 2 decimal places
        const roundedAmount = Math.round(amountFloat * 100) / 100;
        // If whole number, send as integer; otherwise send as decimal
        if (roundedAmount === Math.floor(roundedAmount)) {
            parsedAmount = Math.floor(roundedAmount); // 735.0 → 735
        } else {
            parsedAmount = roundedAmount; // 15.79 → 15.79
        }
    }

    // Prepare GatewayHub payload (EXACT order matters for hash!)
    // ⚠️ DO NOT add 'is_trc20' here - GatewayHub doesn't expect it and will reject the hash!
    // Match Python format exactly: amount, name, order_id, acc_holder_name, acc_number, bank_name, ifsc, userId
    const payload = {
        amount: parsedAmount,
        name: String((orderData.username || orderData.name || '').trim()), // End-user username (apg012, mvp094, etc.)
        order_id: String((orderData.order_id || '').trim()),
        acc_holder_name: String((orderData.acc_holder_name || 'User').trim()),
        acc_number: String((orderData.acc_number || '000000').trim()), // For crypto: TRC20 address
        bank_name: String((orderData.bank_name || 'Unknown').trim()), // For crypto: "CRYPTO"
        ifsc: String((orderData.ifsc || 'UNKNOWN').trim().toUpperCase()), // For crypto: "SBIN0000001"
        userId: 1
    };

    // Log payload for debugging
    console.log('[GatewayHub API] Parsed order data:', {
        original_amount: orderData.amount,
        parsed_amount: parsedAmount,
        formatted_amount: parsedAmount,
        name: payload.name,
        acc_number: payload.acc_number,
        ifsc: payload.ifsc
    });

    // Validate required fields
    if (!payload.name || !payload.acc_number || !payload.ifsc || payload.amount <= 0) {
        const missingFields = [];
        if (!payload.name) missingFields.push('name (username)');
        if (!payload.acc_number) missingFields.push('acc_number');
        if (!payload.ifsc) missingFields.push('ifsc');
        if (payload.amount <= 0) missingFields.push(`amount (got: "${orderData.amount}" -> ${parsedAmount})`);

        throw new Error(`Missing or invalid required fields: ${missingFields.join(', ')}`);
    }

    // Generate JSON string - Python removes ALL whitespace before hashing
    // Reference: data_str = "".join(str(json_dumps).split())
    const payloadJsonString = JSON.stringify(payload);

    // Generate payload hash using crypto.js - pass the JSON string directly to ensure consistency
    // IMPORTANT: The private key in config includes a timestamp suffix (e.g. _1750...)
    // User confirmed we should use the FULL key string (including timestamp) as the HMAC secret
    const privateKeyForHmac = apiKeys.private_key;
    const payloadHash = await generatePayloadHash(payloadJsonString, privateKeyForHmac);

    const headers = {
        'public-key': apiKeys.public_key,
        'payload-hash': payloadHash,
        'Content-Type': 'application/json'
    };

    // GatewayHub API endpoint
    // Based on test.js, the endpoint is: {GATEWAYHUB_API_URL}/withdraw/bot
    // Staging:   'https://staging.api.gatewayhub.live/withdraw/bot'
    // Production: 'https://api-prod.gatewayhub.live/withdraw/bot'
    // Use production GatewayHub for real traffic
    const apiEndpoint = 'https://api-prod.gatewayhub.live/withdraw/bot';

    // Log the request details for debugging
    console.log('[GatewayHub API] Request URL:', apiEndpoint);
    console.log('[GatewayHub API] Payload:', payload);
    console.log('[GatewayHub API] Payload JSON (used for hash & body):', payloadJsonString);
    console.log('[GatewayHub API] Using public-key:', apiKeys.public_key.substring(0, 20) + '...' + apiKeys.public_key.substring(apiKeys.public_key.length - 20));
    console.log('[GatewayHub API] Generated payload-hash:', payloadHash.substring(0, 20) + '...' + payloadHash.substring(payloadHash.length - 10));
    console.log('[GatewayHub API] Data string (first 100 chars):', payloadJsonString.substring(0, 100));

    // Use background script proxy to bypass CORS
    // Track gateway timing
    const gatewayStart = Date.now();
    
    return new Promise((resolve, reject) => {
        // Check if chrome.runtime is available
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
            reject(new Error('Chrome extension runtime is not available. Please reload the extension.'));
            return;
        }

        // Helper function to send the actual request
        const sendRequest = (retryCount = 0) => {
            chrome.runtime.sendMessage({
                action: 'proxyRequest',
                data: {
                    url: apiEndpoint,
                    options: {
                        method: 'POST',
                        headers: headers,
                        body: payloadJsonString, // Use the exact same JSON string that was hashed
                        timeout: 60000 // 60 seconds timeout as per Python reference
                    }
                }
            }, (response) => {
                // Check for runtime errors (background script not available)
                if (chrome.runtime.lastError) {
                    const errorMsg = chrome.runtime.lastError.message;
                    console.error('[GatewayHub API] Runtime error:', errorMsg);

                    // If it's a connection error and we haven't retried yet, try again after a delay
                    if (errorMsg.includes('Receiving end does not exist') && retryCount < 2) {
                        console.warn(`[GatewayHub API] Background script not ready (attempt ${retryCount + 1}/3). Retrying...`);
                        setTimeout(() => sendRequest(retryCount + 1), 1000 * (retryCount + 1)); // Exponential backoff
                        return;
                    }

                    // Final failure - provide clear error message
                    reject(new Error(`Background script unavailable: ${errorMsg}. Please reload the extension in chrome://extensions or refresh this page.`));
                    return;
                }

                // Check response
                if (response && response.success) {
                    const gatewayEnd = Date.now();
                    const gatewayResponseTimeMs = gatewayEnd - gatewayStart;
                    
                    // Include status code and response time in response
                    const responseData = {
                        ...response.data,
                        statusCode: response.statusCode || 200,
                        responseTimeMs: gatewayResponseTimeMs
                    };
                    
                    console.log(`[GatewayHub API] Response: status=${responseData.statusCode}, time=${gatewayResponseTimeMs}ms, body=${JSON.stringify(responseData).substring(0, 200)}`);
                    resolve(responseData);
                } else {
                    // Handle error responses with status codes
                    // Extract error message from GatewayHub response body
                    const statusCode = response?.statusCode || 0;
                    const responseData = response?.data || {};
                    
                    // Try to extract error message from various possible fields in GatewayHub response
                    const errorMessage = responseData.error || 
                                       responseData.message || 
                                       responseData.detail ||
                                       response?.statusText ||
                                       (statusCode === 500 ? 'GatewayHub server error (500)' : 
                                        statusCode === 400 ? 'GatewayHub bad request (400)' :
                                        statusCode === 401 ? 'GatewayHub unauthorized (401)' :
                                        statusCode === 404 ? 'GatewayHub not found (404)' :
                                        statusCode >= 500 ? `GatewayHub server error (${statusCode})` :
                                        statusCode > 0 ? `GatewayHub error (${statusCode})` : 'Unknown proxy error');
                    
                    const errorData = {
                        error: errorMessage,
                        statusCode: statusCode,
                        details: responseData.details || responseData.message || JSON.stringify(responseData).substring(0, 200),
                        rawResponse: responseData
                    };
                    
                    console.error('[GatewayHub API] Request failed:', errorData);
                    console.error('[GatewayHub API] Full response:', JSON.stringify(response, null, 2));
                    
                    // Create error object that includes status code for proper handling
                    const error = new Error(errorData.error);
                    error.statusCode = errorData.statusCode;
                    error.details = errorData.details;
                    error.rawResponse = errorData.rawResponse;
                    reject(error);
                }
            });
        };

        // Send the request (will retry automatically if needed)
        sendRequest();
    });
}

/**
 * Check if order exists in database
 * @param {string} orderHash - Order hash
 * @param {string} dbApiUrl - Database API URL
 * @returns {Promise<Object>} { exists: boolean, order: Object }
 */
async function checkOrderExists(orderHash, dbApiUrl) {
    return await proxyFetch(`${dbApiUrl}/api/orders/exists/${orderHash}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
    });
}

/**
 * Save order to database
 * @param {Object} orderData - Complete order data with hash
 * @param {string} dbApiUrl - Database API URL
 * @returns {Promise<Object>} Save response
 */
async function saveOrder(orderData, dbApiUrl) {
    return await proxyFetch(`${dbApiUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
    });
}

/**
 * Update order final action (approve/reject) by order_id
 * @param {string} orderId - CE order_id (UUID_loginTag)
 * @param {string} finalAction - 'approved' or 'rejected'
 * @param {string} dbApiUrl - Database API URL
 * @param {string} [statusDetail] - Optional custom status_detail message
 * @returns {Promise<Object>} Update response
 */
async function updateOrderStatus(orderId, finalAction, dbApiUrl, statusDetail = null) {
    const body = { finalAction };
    if (statusDetail) {
        body.statusDetail = statusDetail;
    }
    return await proxyFetch(`${dbApiUrl}/api/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

/**
 * Get orders by status
 * @param {string} status - Order status
 * @param {string} dbApiUrl - Database API URL
 * @returns {Promise<Object>} Orders response
 */
async function getOrdersByStatus(status, dbApiUrl) {
    return await proxyFetch(`${dbApiUrl}/api/orders/status/${status}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
    });
}

/**
 * Get orders with status mismatch (status != gateway_status)
 * Matches Autoflow's mismatch detection: finds orders where gateway_status is set but status hasn't been updated
 * @param {string} dbApiUrl - Database API URL
 * @param {string} loginTag - Optional login tag to filter orders (e.g., 'botagve11')
 * @returns {Promise<Object>} Orders response
 */
async function getOrdersWithMismatch(dbApiUrl, loginGroupKey = null) {
    const url = loginGroupKey 
        ? `${dbApiUrl}/api/orders/with-mismatch?login_group_key=${encodeURIComponent(loginGroupKey)}`
        : `${dbApiUrl}/api/orders/with-mismatch`;
    return await proxyFetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
    });
}

/**
 * Get login execution configuration by panel username
 * @param {string} panelUsername - Supago panel/login username (e.g. agve11)
 * @param {string} dbApiUrl - Backend API URL
 * @returns {Promise<Object>} { found, login: { id, username, execution_channel, login_group_key } }
 */
async function getLoginConfig(panelUsername, dbApiUrl) {
    return await proxyFetch(`${dbApiUrl}/api/login/by-panel-username/${encodeURIComponent(panelUsername)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
    });
}

/**
 * Check if there's an existing order matching the same (username, amount, transaction_date).
 *
 * Behaviour:
 * - If ANY existing CE order (any status) has the same (username, amount, transaction_date)
 *   → treat as duplicate (`hasDuplicate=true`), do NOT create a new DB row.
 * - Additionally, if there is ANY existing CE order for the same (username, amount)
 *   whose status is NOT terminal (not 'success'/'failed') and has no `final_action`
 *   → treat as "incomplete in‑process" (`hasIncomplete=true`) and block sending.
 *
 * This looks only at CE orders (UUID order_id) via `/api/orders`, so it will reliably
 * catch cases where the *same Supago row* is seen again even if the hash/transaction_date
 * shifts slightly, as long as username+amount match.
 *
 * @param {string} username - End-user username (e.g. Apg013)
 * @param {number|string} amount - Order amount
 * @param {string|null} transactionDate - Transaction date/time string from portal (e.g. '18/12/2025 13:06:43')
 * @param {string} dbApiUrl - Database API URL
 * @returns {Promise<Object>} { hasDuplicate: boolean, hasIncomplete: boolean, order: Object|null }
 */
async function checkIncompleteInProcessOrder(username, amount, transactionDate, dbApiUrl) {
    try {
        const amountFloat = parseFloat(amount);
        if (isNaN(amountFloat)) {
            return { hasDuplicate: false, hasIncomplete: false, order: null };
        }

        // Use CE orders endpoint (UUID format order_id only)
        const resp = await proxyFetch(`${dbApiUrl}/api/orders?limit=500`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        const orders = resp.orders || [];
        let foundDuplicate = null;
        let foundIncompleteInProcess = null;

            for (const order of orders) {
                const orderAmount = parseFloat(order.amount);
                const orderTxDate = order.transaction_date || order.date || null;
            const orderUsername = (order.username || '').trim();
            const targetUsername = (username || '').trim();

            if (isNaN(orderAmount)) continue;

            // 1) Strict duplicate: same (username, amount, transaction_date)
                if (
                orderUsername === targetUsername &&
                    orderAmount === amountFloat &&
                    transactionDate &&
                    orderTxDate &&
                    orderTxDate === transactionDate
                ) {
                    foundDuplicate = order;
                    break;
                }

            // 2) Incomplete guard: same (username, amount, transaction_date), non-terminal status, no final_action
            // ✅ FIX: Include transaction_date to prevent blocking different transactions with same username/amount
            // Only block if it's the exact same transaction (same transaction_date)
            const status = (order.status || '').toLowerCase();
            const isTerminal = status === 'success' || status === 'failed';
            const hasFinal = !!order.final_action;

            // ✅ CRITICAL FIX: Only block if transaction_date matches (same transaction)
            // If transaction_date is not provided or doesn't match, don't block (allow processing)
            const transactionDateMatches = transactionDate && orderTxDate && transactionDate === orderTxDate;

            if (
                orderUsername === targetUsername &&
                    orderAmount === amountFloat &&
                transactionDateMatches &&  // ✅ Only block if same transaction_date (exact same transaction)
                !isTerminal &&
                !hasFinal
                ) {
                    foundIncompleteInProcess = order;
                // Keep looping in case we also find a strict duplicate
            }
        }

        if (foundDuplicate) {
            return { hasDuplicate: true, hasIncomplete: !!foundIncompleteInProcess, order: foundDuplicate };
        }

        if (foundIncompleteInProcess) {
            return { hasDuplicate: false, hasIncomplete: true, order: foundIncompleteInProcess };
        }

        return { hasDuplicate: false, hasIncomplete: false, order: null };
    } catch (err) {
        console.error('[API] Error checking incomplete in-process order:', err);
        // Fail open - if check fails, allow processing
        return { hasDuplicate: false, hasIncomplete: false, order: null };
    }
}

// Export functions for Node.js modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        sendToGatewayHub,
        checkOrderExists,
        saveOrder,
        updateOrderStatus,
        getOrdersByStatus,
        getOrdersWithMismatch,
        getWebsiteNameFromUsername,
        proxyFetch,
        getLoginConfig,
        checkIncompleteInProcessOrder
    };
}

// Also expose to global scope for browser extension content scripts
if (typeof window !== 'undefined') {
    window.checkIncompleteInProcessOrder = checkIncompleteInProcessOrder;
    window.getOrdersWithMismatch = getOrdersWithMismatch;
}
