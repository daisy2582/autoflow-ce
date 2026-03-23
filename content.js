// Content script - runs on dashboard.supago.online
// Handles login automation, order scraping, and button clicking

// Import utilities (loaded via manifest)
// logger.js, crypto.js, storage.js, api.js, scraper.js are available
// Note: logger.js intercepts all console.log/warn/error calls (Chrome storage saving disabled to prevent system getting stuck)

let isProcessing = false;
let refreshTimer = null;
let loginPollTimer = null;
let mismatchPollTimer = null;
let pendingPollTimer = null;

// Time tracking for phase switching (max 5 minutes per phase)
let pendingPhaseStartTime = null; // When we started processing pending phase
let mismatchPhaseStartTime = null; // When we started processing mismatch phase

// Configuration
// Login config polling: Check with Autoflow backend every 3 minutes to see if CE is allowed to operate
const LOGIN_POLL_INTERVAL = 3 * 60 * 1000; // 3 minutes
// Mismatch polling: Fetch orders with status mismatch every 1 minute (without page refresh)
const MISMATCH_POLL_INTERVAL = 60 * 1000; // 1 minute
// Pending polling: Check pending orders every 2 seconds (just click Load button, no page refresh)
const PENDING_POLL_INTERVAL = 2 * 1000; // 2 seconds
// Page refresh: Refresh page every 5 minutes to keep session fresh and recover from UI drift
const PAGE_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
const REFRESH_VARIANCE = 30 * 1000; // ±30 seconds
// View timeout: Maximum time to spend on each view (in-process or pending) before switching
const VIEW_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
// Note: Login sessions last 24 hours, so login will only occur once per day if session remains active

/**
 * Check if we're on an error page (500, etc.)
 * Returns true if error page is detected
 */
function isErrorPage() {
    // Check for common error page indicators
    const errorIndicators = [
        document.querySelector('h1')?.textContent?.includes('500'),
        document.querySelector('h1')?.textContent?.includes('404'),
        document.querySelector('h1')?.textContent?.includes('403'),
        document.querySelector('span')?.textContent?.includes("Oops! Something went wrong"),
        document.querySelector('p')?.textContent?.includes('We apologize for the inconvenience'),
        document.body?.textContent?.includes('500') && document.body?.textContent?.includes('Something went wrong')
    ];
    
    return errorIndicators.some(indicator => indicator === true);
}

/**
 * Handle error page: refresh and navigate to /withdraw-request
 */
async function handleErrorPage() {
    if (isErrorPage()) {
        console.error('[Supago] ⚠️ Error page detected (500/404/etc). Refreshing and navigating to /withdraw-request...');
        
        // Navigate directly to /withdraw-request (this will refresh the page)
        window.location.href = '/withdraw-request';
        
        return true;
    }
    return false;
}

/**
 * Check if user is already logged in
 */
function isLoggedIn() {
    // First, explicitly check if we're on the login page
    const loginIndicators = [
        document.querySelector('input[name="username"]'),
        document.querySelector('input[type="password"]'),
        document.querySelector('button[type="submit"]'),
        document.querySelector('form[action*="login"]')
    ];

    // Check if we have login form elements visible (means we're on login page)
    const hasLoginForm = loginIndicators.filter(el => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }).length >= 2; // Need at least 2 login elements (username + password fields)

    if (hasLoginForm) {
        console.log('[Supago] Login form detected - user is NOT logged in');
        return false;
    }

    // Check URL path (not domain) - if we are on dashboard pages, we are likely logged in
    const pathname = window.location.pathname.toLowerCase();
    if (pathname.includes('/dashboard') ||
        pathname.includes('/deposit') ||
        pathname.includes('/withdraw') ||
        pathname.includes('/orders') ||
        pathname.includes('/manual')) {
        console.log('[Supago] Dashboard path detected in URL');
        return true;
    }

    // Check for dashboard elements that indicate logged-in state
    const dashboardIndicators = [
        document.querySelector('[href*="logout"]'),
        document.querySelector('[href*="Logout"]'),
        document.querySelector('.user-menu'),
        document.querySelector('#user-profile'),
        document.querySelector('.sidebar'), // Sidebar usually exists only when logged in
        document.querySelector('header .user-info'),
        document.querySelector('nav'), // Navigation menu usually exists when logged in
        document.querySelector('[class*="menu"]') // Any menu component
    ];

    const hasDashboardElements = dashboardIndicators.some(el => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    });

    if (hasDashboardElements) {
        console.log('[Supago] Dashboard elements detected - user is logged in');
        return true;
    }

    console.log('[Supago] No login indicators - assuming NOT logged in');
    return false;
}

/**
 * Perform login automation
 */
async function performLogin() {
    console.log('[Supago] Attempting login...');

    try {
        // Get encrypted credentials
        const encryptedCreds = await getCredentials();

        if (!encryptedCreds) {
            console.error('[Supago] No credentials found. Please configure in extension popup.');
            return false;
        }

        // Decrypt credentials (using a fixed key for simplicity - in production, use user-provided key)
        const username = await decryptText(encryptedCreds.username, 'supago-extension-key');
        const password = await decryptText(encryptedCreds.password, 'supago-extension-key');
        
        // Update logger with current username
        if (window.ceLogger && window.ceLogger.updateUsername) {
            await window.ceLogger.updateUsername(username);
            console.log(`[Supago] 📝 Logger updated with username: ${username}`);
        }

        // Find login form elements - adjust selectors based on actual page
        const usernameField = document.querySelector('input[name="username"], input[type="text"], input[placeholder*="username" i]');
        const passwordField = document.querySelector('input[name="password"], input[type="password"]');

        // Find login button - handle text content check manually since :contains is not valid CSS
        let loginButton = document.querySelector('button[type="submit"], input[type="submit"]');

        if (!loginButton) {
            // Try finding by text content if no submit button found
            const buttons = Array.from(document.querySelectorAll('button'));
            loginButton = buttons.find(b => b.textContent.toLowerCase().includes('login') || b.textContent.toLowerCase().includes('sign in'));
        }

        if (!usernameField || !passwordField || !loginButton) {
            console.error('[Supago] Login form elements not found');
            return false;
        }

        // Fill in credentials using a method that triggers React/Angular change detection
        const setNativeValue = (element, value) => {
            const lastValue = element.value;
            element.value = value;
            const event = new Event('input', { bubbles: true });
            // Hack for React 15/16
            const tracker = element._valueTracker;
            if (tracker) {
                tracker.setValue(lastValue);
            }
            element.dispatchEvent(event);
            element.dispatchEvent(new Event('change', { bubbles: true }));
        };

        setNativeValue(usernameField, username);
        setNativeValue(passwordField, password);

        // Wait a moment for state updates
        await sleep(500);

        // Store current URL before login to detect navigation
        const currentUrl = window.location.href;
        console.log('[Supago] Current URL before login:', currentUrl);

        // Click login button
        loginButton.click();

        console.log('[Supago] Login form submitted - waiting for navigation...');

        // Wait for navigation to complete - check multiple times
        // Login usually redirects to dashboard, so we wait for URL change or login form to disappear
        let loginSuccessful = false;
        const maxWaitTime = 10000; // 10 seconds max wait
        const checkInterval = 500; // Check every 500ms
        const maxChecks = maxWaitTime / checkInterval;

        for (let i = 0; i < maxChecks; i++) {
            await sleep(checkInterval);

            // Check if URL changed (navigation happened)
            if (window.location.href !== currentUrl) {
                console.log('[Supago] URL changed to:', window.location.href);
                // Wait a bit more for page to fully load after navigation
                await sleep(1000);
                break;
            }

            // Check if login form disappeared (also indicates success)
            const stillHasLoginForm = document.querySelector('input[name="username"], input[type="password"]');
            if (!stillHasLoginForm) {
                console.log('[Supago] Login form disappeared - login likely successful');
                await sleep(1000);
                break;
            }
        }

        // Now verify login was successful with multiple retries
        for (let retry = 0; retry < 5; retry++) {
            loginSuccessful = isLoggedIn();
            
            if (loginSuccessful) {
                console.log('[Supago] ✅ Login successful! Session will remain active for 24 hours.');
                break;
            }
            
            if (retry < 4) {
                console.log(`[Supago] Login check attempt ${retry + 1}/5 - waiting...`);
                await sleep(1000);
            }
        }

        if (!loginSuccessful) {
            console.warn('[Supago] ⚠️ Login verification failed - session not detected after multiple attempts');
            console.warn('[Supago] Current URL:', window.location.href);
            console.warn('[Supago] This might be a timing issue. Automation will retry on next cycle.');
        }

        return loginSuccessful;
    } catch (error) {
        console.error('[Supago] Login error:', error);
        return false;
    }
}

/**
 * Navigate to Manual Withdrawal Requests
 */
async function navigateToWithdrawalRequests() {
    console.log('[Supago] Navigating to Manual Withdrawal Requests...');

    try {
        // Strategy 1: Find by href attribute (most reliable)
        let menuItem = document.querySelector('a[href="/withdraw-request"], a[href*="withdraw-request"]');
        
        // Strategy 2: Find by text content and href
        if (!menuItem) {
            const links = Array.from(document.querySelectorAll('a'));
            menuItem = links.find(el => {
                const href = el.getAttribute('href') || '';
                const text = el.textContent.toLowerCase().trim();
                return (href.includes('/withdraw-request') || href.includes('withdraw-request')) &&
                       (text.includes('manual withdraw') || text.includes('withdrawal'));
            });
        }
        
        // Strategy 3: Find by text content (fallback)
        if (!menuItem) {
            const menuItems = Array.from(document.querySelectorAll('a, button, li, span, div'));
            menuItem = menuItems.find(el => {
                const text = el.textContent.toLowerCase().trim();
                return (text === 'manual withdraw requests' ||
                        text === 'manual withdrawal requests' ||
                        (text.includes('manual withdraw') && text.includes('request')));
            });
        }

        if (!menuItem) {
            console.error('[Supago] Manual Withdrawal Requests menu item not found');
            // List available menu items for debugging
            const allLinks = Array.from(document.querySelectorAll('a[href*="withdraw"], a[href*="request"]'));
            console.log('[Supago] Available withdraw/request links:', allLinks.map(el => ({
                href: el.getAttribute('href'),
                text: el.textContent.trim().substring(0, 50)
            })));
            return false;
        }

        // Scroll element into view if needed
        menuItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);
        
        // Click the menu item
        menuItem.click();
        console.log('[Supago] Clicked Manual Withdrawal Requests (href:', menuItem.getAttribute('href') || 'N/A', ')');

        // Wait for navigation to complete
        await sleep(2000);
        
        // Check if we got redirected to login page (session expired)
        if (!isLoggedIn()) {
            console.error('[Supago] Redirected to login page - session may have expired');
            return false;
        }
        
        // Wait a bit more for the page content to load
        await sleep(1500);

        await ensureOrdersLoaded('pending');

        return true;
    } catch (error) {
        console.error('[Supago] Navigation error:', error);
        return false;
    }
}

/**
 * Locate the "Load" button that fetches table data
 */
function findLoadButton() {
    const selectors = [
        'button',
        'input[type="button"]',
        'input[type="submit"]',
        'a',
        'div[role="button"]',
        'span[role="button"]',
        '.btn',
        '[class*="button"]'
    ];

    const candidates = Array.from(document.querySelectorAll(selectors.join(', ')));

    return candidates.find(el => {
        if (el.disabled) {
            return false;
        }

        const text = (el.innerText || el.textContent || el.value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();

        if (!text || text === 'logout') {
            return false;
        }

        return /\bload\b/.test(text);
    });
}

/**
 * Ensure the orders table is populated by clicking the Load button
 */
async function ensureOrdersLoaded(context = 'default') {
    console.log(`[Supago] Ensuring ${context} orders are loaded...`);

    for (let attempt = 1; attempt <= 3; attempt++) {
        const loadButton = findLoadButton();

        if (loadButton) {
            console.log(`[Supago] About to click Load button (${context}) [attempt ${attempt}]`, {
                text: (loadButton.innerText || loadButton.textContent || '').trim()
            });
            loadButton.click();
            console.log(`[Supago] Clicked Load button (${context}) [attempt ${attempt}]`);
            // ✅ FIXED WAIT: 5 seconds after clicking Load to ensure table is fully refreshed
            console.log(`[Supago] Waiting 5 seconds after Load button click for table to refresh...`);
            await sleep(5000);
            return true;
        }

        await sleep(500);
    }

    console.warn(`[Supago] Load button not found for ${context} view`);
    return false;
}

/**
 * Search within the Supago table using the top "Search..." input
 */
async function searchByUsernameInPage(username) {
    if (!username) {
        console.warn('[Supago] searchByUsernameInPage called with empty username');
        return false;
    }

    const searchInput = document.querySelector('input[placeholder="Search..."]');
    if (!searchInput) {
        console.warn('[Supago] Search input not found on page');
        return false;
    }

    // Clear any existing search first (like Autoflow does)
    await clearSearchBox();

    searchInput.focus();
    searchInput.value = username;

    // Trigger input/change events so React/table updates
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.dispatchEvent(new Event('change', { bubbles: true }));

    console.log(`[Supago] Typed username "${username}" into search box`);
    await sleep(500);

    // Click Load to refresh filtered results
    await ensureOrdersLoaded('in-process-search');
    await sleep(1000);
    return true;
}

/**
 * Clear the search box on the page (used after processing orders)
 */
async function clearSearchBox() {
    const searchInput = document.querySelector('input[placeholder="Search..."]');
    if (!searchInput) {
        console.warn('[Supago] Search input not found for clearing');
        return false;
    }

    try {
        // Click to focus and trigger React state update
        searchInput.focus();
        await sleep(200);

        // Clear the value
        searchInput.value = '';

        // Trigger input/change events so React/table updates
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.dispatchEvent(new Event('change', { bubbles: true }));

        // Verify it's cleared
        await sleep(300);
        const clearedValue = searchInput.value;
        if (clearedValue && clearedValue.trim()) {
            console.warn(`[Supago] ⚠️ Search field still has text after clear: '${clearedValue}', trying keyboard method...`);
            // Fallback: Use keyboard select-all + delete
            searchInput.select();
            await sleep(100);
            searchInput.value = '';
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            searchInput.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(200);
        }

        console.log('[Supago] ✅ Search box cleared');
        return true;
    } catch (error) {
        console.error('[Supago] Error clearing search box:', error);
        return false;
    }
}

/**
 * Helpers for interacting with the status filter dropdown
 */
const STATUS_DROPDOWN_SELECTOR = 'select[name="status"], select#status, .status-filter select, select.status-filter';

function findStatusDropdown() {
    return document.querySelector(STATUS_DROPDOWN_SELECTOR);
}

function findStatusTab(label) {
    const selectors = [
        'button',
        'a',
        'li',
        'div',
        'span',
        'input[type="button"]',
        'input[type="submit"]'
    ];

    const target = label.toLowerCase();
    const candidates = Array.from(document.querySelectorAll(selectors.join(', ')));

    return candidates.find(el => {
        if (el.disabled) {
            return false;
        }

        const text = (el.innerText || el.textContent || el.value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();

        if (!text || text === 'load' || text === 'logout') {
            return false;
        }

        return text.includes(target);
    });
}

async function activateStatusTab(label) {
    const tab = findStatusTab(label);

    if (!tab) {
        console.warn(`[Supago] ${label} tab not found`);
        return false;
    }

    tab.click();
    console.log(`[Supago] Clicked ${label} tab`);
    await sleep(500);
    return true;
}

async function getStatusDropdown() {
    let dropdown = findStatusDropdown();

    if (dropdown) {
        return dropdown;
    }

    const activated = await activateStatusTab('pending');

    if (!activated) {
        return null;
    }

    await sleep(500);
    dropdown = findStatusDropdown();

    if (!dropdown) {
        console.warn('[Supago] Status dropdown still not visible after activating pending tab');
    }

    return dropdown;
}

/**
 * Process pending orders
 */
async function processPendingOrders() {
    console.log('[Supago] Processing pending orders...');

    const settings = await getSettings();
    
    // ✅ CRITICAL: Check execution_channel - do not process if it's not 'chrome_extension'
    const executionChannel = settings.executionChannel || 'autobot';
    if (executionChannel !== 'chrome_extension') {
        console.log(`[Supago] ⏭️ Skipping pending processing (execution_channel=${executionChannel}, not chrome_extension)`);
        return;
    }
    
    if (settings.isActive === false) {
        console.log('[Supago] ⏭️ Skipping pending processing (login is not active)');
        return;
    }

    // ✅ CRITICAL: Ensure we're on PENDING view (not In Process) before reading orders
    // This prevents reading In Process orders and creating duplicate transactions
    console.log('[Supago] Ensuring we are on PENDING view before processing pending orders...');
    
    // First check current view - if we're on in-process, skip pending processing
    const detectedView = detectCurrentView();
    if (detectedView === 'in-process') {
        console.log('[Supago] ⏭️ Skipping pending processing - currently on In Process view (mismatch processing may be active)');
        return;
    }
    
    const pendingViewSuccess = await ensurePendingView();
    if (!pendingViewSuccess) {
        console.warn('[Supago] ⚠️ Could not ensure pending view - aborting to prevent reading wrong view');
        return;
    }
    
    // Double-check after ensurePendingView - verify we're actually on pending now
    const verifyView = detectCurrentView();
    if (verifyView === 'in-process') {
        console.log('[Supago] ⏭️ Skipping pending processing - still on In Process view after ensurePendingView (aborting to prevent duplicates)');
        return;
    }
    
    if (verifyView !== 'pending') {
        console.warn(`[Supago] ⚠️ View verification failed - detected: ${verifyView}, expected: pending - aborting to prevent reading wrong view`);
        return;
    }

    // Always ensure the pending table is actually loaded before scraping
    const loadSuccess = await ensureOrdersLoaded('pending');
    if (!loadSuccess) {
        console.warn('[Supago] ⚠️ Load button click failed - aborting to prevent reading stale data');
        return;
    }
    
    // ✅ CRITICAL: Final verification after Load button - ensure we're still on pending view
    await sleep(500); // Brief wait for view to settle after Load
    const finalViewCheck = detectCurrentView();
    if (finalViewCheck === 'in-process') {
        console.log('[Supago] ⚠️ CRITICAL: View changed to in-process after Load button - aborting to prevent reading wrong orders');
        return;
    }
    
    if (finalViewCheck !== 'pending') {
        console.warn(`[Supago] ⚠️ Final view check failed - detected: ${finalViewCheck}, expected: pending - aborting`);
        return;
    }

    const orders = scrapeAllOrders();

    console.log(`[Supago] Found ${orders.length} orders on page`);

    // Get logged-in username (always needed for order_id suffix, even when website is AUTOEXCHANGE)
    let loggedInUsername = null;
    let websiteName = settings.websiteName || 'WINFIX'; // Start with settings value, default to WINFIX
    
    // ✅ ALWAYS get username first (needed for order_id _loginid suffix)
    try {
        const encryptedCreds = await getCredentials();
        if (encryptedCreds && encryptedCreds.username) {
            loggedInUsername = await decryptText(encryptedCreds.username, 'supago-extension-key');
        }
    } catch (err) {
        console.error('[Supago] Error getting username from credentials:', err);
    }
    
    // ✅ CRITICAL: Respect manual AUTOEXCHANGE selection in settings
    // If user explicitly selects AUTOEXCHANGE in settings, use it (override username mapping)
    // Otherwise, use username-based mapping (which defaults to WINFIX if username not found)
    if (settings.websiteName === 'AUTOEXCHANGE') {
        // User explicitly selected AUTOEXCHANGE - use it directly
        websiteName = 'AUTOEXCHANGE';
        console.log(`[Supago] ✅ Using explicit AUTOEXCHANGE selection from settings (overriding username-based mapping)`);
        if (loggedInUsername) {
            console.log(`[Supago] Username for order_id: "${loggedInUsername}"`);
        }
    } else {
        // Use username-based mapping (will default to WINFIX if username not found)
        if (loggedInUsername) {
            // Determine website name based on username
            websiteName = getWebsiteNameFromUsername(loggedInUsername);
            console.log(`[Supago] Detected username: "${loggedInUsername}", using website: ${websiteName}`);
        } else {
            console.warn('[Supago] Could not get credentials, using websiteName from settings:', websiteName);
        }
    }

    let processedCount = 0;
    let skippedCount = 0;
    
    // Track start time for timeout management
    const startTime = Date.now();

    console.log(`[Supago] Processing ${orders.length} orders...`);
    console.log(`[Supago] Order list:`, orders.map((o, i) => `${i + 1}. ${o.username || 'N/A'} - ₹${o.amount || 'N/A'} (${o.acc_number || 'N/A'})`).join(', '));
    
    // Process orders sequentially row-by-row on the current page (no refresh needed).
    for (let orderIndex = 0; orderIndex < orders.length; orderIndex++) {
        // Check if we've exceeded the 5-minute timeout
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime >= VIEW_TIMEOUT_MS) {
            const remainingOrders = orders.slice(orderIndex);
            console.log(`[Supago] ⏱️ View timeout reached (${Math.round(elapsedTime / 1000)}s). Stopping pending processing.`);
            console.log(`[Supago] Processed: ${processedCount}, Skipped: ${skippedCount}, Remaining: ${remainingOrders.length}`);
            return { 
                processed: processedCount, 
                skipped: skippedCount, 
                remaining: remainingOrders,
                timeout: true 
            };
        }
        const order = orders[orderIndex];
        console.log(`[Supago] ========== Processing order ${orderIndex + 1}/${orders.length} ==========`);
        console.log(`[Supago] Order details: username=${order.username}, amount=${order.amount}, acc_number=${order.acc_number}, bank=${order.bank_name}`);
        
        try {
            // Generate order hash (includes transaction_date for duplicate detection)
            let orderHash = await generateOrderHash(order);
            let orderUUID = null;
            let reuseExistingPending = false;

            console.log(`[Supago] 🔍 Order ${orderIndex + 1} hash generation:`, {
                hash: orderHash.substring(0, 16) + '...',
                fullHash: orderHash,
                orderData: {
                    amount: order.amount,
                    transaction_date: order.transaction_date || order.date,
                    date: order.date,
                    username: order.username,
                    acc_number: order.acc_number,
                    ifsc: order.ifsc
                }
            });

            // Check for duplicates BEFORE creating/sending:
            // - NEW RULE: Only use duplicate check to block when there's an incomplete in-process order.
            // - Reuse existing pending order based on hash/DB check (below), not from this API.
            if (order.username && order.amount) {
                try {
                    const amountFloat = parseFloat(order.amount);
                    if (!isNaN(amountFloat)) {
                        const duplicateCheck = await checkIncompleteInProcessOrder(
                            order.username,
                            amountFloat,
                            order.transaction_date || order.date || null,
                            settings.dbApiUrl
                        );

                        if (duplicateCheck.hasIncomplete) {
                            console.log(`[Supago] ⏭️ Order ${orderIndex + 1} skipped: Found incomplete in-process order with same username (${order.username}) and amount (${amountFloat})`);
                            console.log(`[Supago]    Incomplete order details:`, {
                                order_id: duplicateCheck.order?.order_id,
                                status: duplicateCheck.order?.status,
                                gateway_status: duplicateCheck.order?.gateway_status,
                                final_action: duplicateCheck.order?.final_action
                            });
                            skippedCount++;
                            continue;
                        }
                    }
                } catch (err) {
                    console.error(`[Supago] ⚠️ Error checking for duplicate/in-process order ${orderIndex + 1}:`, err);
                    // Continue processing if duplicate check fails (fail open)
                }
            }

            // Check if order already exists in database (by hash)
            let existsResult = { exists: false };
            try {
                existsResult = await checkOrderExists(orderHash, settings.dbApiUrl);
                console.log(`[Supago] 🔍 Order ${orderIndex + 1} DB check result:`, {
                    exists: existsResult.exists,
                    existingOrderId: existsResult.order?.order_id,
                    existingStatus: existsResult.order?.status,
                    existingGatewayStatus: existsResult.order?.gateway_status,
                    existingFinalAction: existsResult.order?.final_action
                });
            } catch (err) {
                console.error(`[Supago] ❌ Error checking DB for order ${orderIndex + 1}:`, err);
                // Continue processing if DB check fails (fail open)
            }

            if (existsResult.exists) {
                const existingOrder = existsResult.order;
                const existingStatus = (existingOrder?.status || '').toLowerCase();
                const existingFinalAction = existingOrder?.final_action || null;

                if (existingStatus === 'pending' && !existingFinalAction) {
                    // ✅ Reuse existing pending order with same (username, amount, transaction_date)
                    reuseExistingPending = true;
                    orderUUID = existingOrder.order_id;
                    if (existingOrder.order_hash) {
                        orderHash = existingOrder.order_hash;
                    }
                    console.log(`[Supago] 🔁 Reusing existing pending order from DB instead of creating new record.`, {
                        reused_order_id: existingOrder.order_id,
                        status: existingOrder.status,
                        gateway_status: existingOrder.gateway_status,
                        final_action: existingOrder.final_action,
                        transaction_date: existingOrder.transaction_date || existingOrder.date || null
                    });
                } else if (existingStatus === 'in_process' && !existingFinalAction) {
                    // Block if there's already an in_process order with same hash and no final_action
                    console.log(`[Supago] ⏭️ Order ${orderIndex + 1} skipped: Existing in_process order without final_action for same hash (hash: ${orderHash.substring(0, 8)}...)`);
                    console.log(`[Supago]    Existing order details:`, {
                        order_id: existingOrder.order_id,
                        status: existingOrder.status,
                        gateway_status: existingOrder.gateway_status,
                        final_action: existingOrder.final_action
                    });
                    skippedCount++;
                    continue;
                } else {
                    const isCompleted = existingFinalAction; // 'approved' or 'rejected'
                    if (isCompleted) {
                        console.log(`[Supago] ℹ️ Order ${orderIndex + 1} hash exists but previous order is completed (${isCompleted}). Processing new order.`);
                        // Continue processing - don't skip
                    } else {
                        console.log(`[Supago] ⏭️ Order ${orderIndex + 1} already exists and is incomplete (hash: ${orderHash.substring(0, 8)}...), skipping`);
                        console.log(`[Supago]    Existing order details:`, {
                            order_id: existingOrder?.order_id,
                            status: existingOrder?.status,
                            gateway_status: existingOrder?.gateway_status,
                            final_action: existingOrder?.final_action,
                            executor: existingOrder?.in_process_executor_channel
                        });
                        skippedCount++;
                        continue;
                    }
                }
            }

            // Validate order data before sending
            console.log(`[Supago] Order data before API call:`, {
                order_id: order.order_id,
                username: order.username,
                amount: order.amount,
                acc_number: order.acc_number,
                ifsc: order.ifsc,
                acc_holder_name: order.acc_holder_name,
                bank_name: order.bank_name,
                date: order.date
            });

            // Check if required fields are present
            if (!order.amount || order.amount === '0' || order.amount === '') {
                console.error(`[Supago] Order ${order.order_id} has invalid amount: "${order.amount}". Skipping API call.`);
                processedCount++;
                continue;
            }

            // Decide which order_id to use:
            // - If reusing existing pending order → use its existing order_id
            // - Otherwise generate a new UUID_v4_loginTag
            if (!orderUUID) {
                const baseUUID = generateUUIDv4();
                let loginTag = null;
                if (loggedInUsername && typeof loggedInUsername === 'string') {
                    loginTag = loggedInUsername.replace(/[^a-zA-Z0-9_]/g, '');
                }
                orderUUID = loginTag ? `${baseUUID}_${loginTag}` : baseUUID;
                console.log(`[Supago] Generated UUID v4 for order: ${orderUUID} (base: ${baseUUID}, loginTag: ${loginTag || 'none'})`);
            } else {
                console.log(`[Supago] Using existing order_id from DB for this triplet: ${orderUUID}`);
            }

            // ✅ IMMEDIATELY save order to database after reading
            // - If we're reusing an existing pending order, DO NOT create a new row – it already exists.
            if (!reuseExistingPending) {
                const initialOrderData = {
                    order_hash: orderHash,
                    order_id: orderUUID,
                    // Username should be ONLY the username read from the portal (Username column), no fallback to panel login
                    username: order.username || null,
                    // Also store Payment Name separately, matching Supago "Payment Name" column
                    payment_name: order.payment_name || null,
                    // Panel/login username used by Autoflow Login model (e.g. agve11) for linking to login/group
                    panel_username: loggedInUsername || null,
                    acc_holder_name: order.acc_holder_name,
                    amount: parseInt(order.amount) || 0,
                    bank_name: order.bank_name,
                    acc_number: order.acc_number,
                    ifsc: order.ifsc,
                    order_date: order.date,
                    status: 'pending', // Initial status after reading
                    txn_id: '',
                    utr: '',
                    api_status: 'pending' // Will be updated after API response
                };

                try {
                    await saveOrder(initialOrderData, settings.dbApiUrl);
                    console.log(`[Supago] ✅ Order saved to database immediately after reading: ${orderUUID}`);
                } catch (err) {
                    console.error('[Supago] ❌ CRITICAL: Error saving order to DB. Stopping automation.', err);
                    // Do NOT continue to next order if DB write failed
                    throw err;
                }
            } else {
                console.log(`[Supago] ✅ Reusing existing pending DB record – not creating a new transaction row. Order ID: ${orderUUID}`);
            }

            // Create order object with UUID for API call
            const orderForAPI = {
                ...order,
                order_id: orderUUID
            };

            // Send to GatewayHub API using username-determined website name
            console.log(`[Supago] 🔄 Calling GatewayHub for order_id: ${orderUUID}`);
            let apiResponse;
            let statusCode = 0;
            try {
                const response = await sendToGatewayHub(orderForAPI, websiteName);
                statusCode = response.statusCode || 0;
                console.log(`[Supago] GatewayHub API Response: status=${statusCode}, time=${response.responseTimeMs || 0}ms, body=${JSON.stringify(response).substring(0, 200)}`);
                
                // ✅ CRITICAL: Check HTTP status code FIRST - ONLY 201 Created means GatewayHub accepted the request
                // Any other status code (4xx, 5xx, etc.) means GatewayHub rejected or failed - DO NOT click "In Process"
                if (statusCode !== 201) {
                    console.error(`[Supago] ❌ GatewayHub returned non-201 status code: ${statusCode} - GatewayHub did NOT accept the withdrawal request`);
                    console.error(`[Supago]    Response: ${JSON.stringify(response).substring(0, 200)}`);
                    console.error(`[Supago]    ⛔ SKIPPING 'In Process' click - GatewayHub did not process the withdrawal request`);
                    skippedCount++;
                    continue; // Skip clicking "In Process" - GatewayHub didn't process the request
                }
                
                // Handle GatewayHub API response format
                if (response && typeof response === 'object') {
                    // Check if this is a GatewayHub response (has status, order_id, txn_id, utr)
                    if (response.status && response.order_id && response.txn_id !== undefined) {
                        // GatewayHub production response format
                        apiResponse = {
                            status: response.status, // 'success' or 'failed'
                            txn_id: response.txn_id || response.order_id || orderUUID,
                            utr: response.utr || '',
                            order_id: response.order_id,
                            amount: response.amount,
                            message: response.message || `GatewayHub response: ${response.status}`,
                            statusCode: statusCode
                        };
                        console.log(`[Supago] ✅ GatewayHub API response received: status=${response.status}, statusCode=${statusCode}, txn_id=${apiResponse.txn_id}, utr=${apiResponse.utr}`);
                    } else if (response.uuid || response.url) {
                        // Webhook.site testing response format
                        apiResponse = { 
                            status: 'success', 
                            txn_id: response.uuid || orderUUID,
                            utr: response.uuid || 'webhook-received',
                            message: 'Request received by webhook (testing mode)',
                            statusCode: statusCode
                        };
                        console.log(`[Supago] ✅ Webhook request successful (testing mode)`);
                    } else {
                        // Unknown response format - check status code
                        if (statusCode === 201) {
                            // 201 Created - treat as success
                            apiResponse = { 
                                status: 'success', 
                                txn_id: orderUUID,
                                utr: '',
                                message: 'API request completed (201 Created)',
                                statusCode: statusCode
                            };
                            console.log(`[Supago] ✅ API request completed (201 Created)`);
                        } else {
                            // Other status codes - treat as error
                            throw new Error(`GatewayHub returned status ${statusCode}: ${JSON.stringify(response).substring(0, 200)}`);
                        }
                    }
                } else {
                    // Non-object response, treat as error
                    throw new Error(`Unexpected API response format: ${typeof response}`);
                }
            } catch (err) {
                console.error('[Supago] ❌ API Error:', err);
                
                // Do NOT update gateway_status here - that's only set when webhook arrives
                // Order stays in 'pending' status, gateway_status remains null
                console.error('[Supago] ❌ NOT clicking "In Process" button');
                console.error('[Supago] Error details:', {
                    message: err.message,
                    stack: err.stack,
                    statusCode: err.statusCode || statusCode
                });
                
                // Check if it's a timeout
                if (err.message && err.message.includes('timeout')) {
                    console.error('[Supago] ⏱️ GatewayHub timeout - withdrawal NOT processed');
                } else if (err.statusCode) {
                    console.error(`[Supago] ❌ GatewayHub returned status ${err.statusCode} - withdrawal NOT processed`);
                }
                
                // Skip clicking button but order is already in DB
                skippedCount++;
                continue; // Skip to next order
            }

            // CRITICAL: Only proceed if GatewayHub returned a successful response
            // Check if we got a valid GatewayHub response with status field
            if (!apiResponse || !apiResponse.status) {
                console.error('[Supago] ❌ Invalid API response received:', apiResponse);
                console.error('[Supago] ❌ NOT saving to database and NOT clicking "In Process" button');
                skippedCount++;
                continue; // Skip to next order
            }

            // ✅ Handle GatewayHub API response
            // If GatewayHub received successfully (201), click "In Process" button
            // Do NOT set gateway_status here - that's only set when webhook arrives
            if (apiResponse.statusCode === 201 && apiResponse.status === 'success') {
                console.log(`[Supago] ✅ GatewayHub API success! Status: ${apiResponse.status}, Txn ID: ${apiResponse.txn_id}, UTR: ${apiResponse.utr}`);
                console.log(`[Supago] GatewayHub received request successfully - clicking "In Process" button`);
                
                // Re-find button with retry logic (table might be updating from previous orders)
                let inProcessButton = findInProcessButton(order);
                
                // Retry finding button if not found immediately (table might still be updating)
                if (!inProcessButton && orderIndex > 0) {
                    console.log(`[Supago] Button not found immediately for order ${orderIndex + 1}, waiting for table update...`);
                    await sleep(800);
                    inProcessButton = findInProcessButton(order);
                }
                
                // Final retry if still not found
                if (!inProcessButton) {
                    console.log(`[Supago] Retrying button search one more time...`);
                    await sleep(500);
                    inProcessButton = findInProcessButton(order);
                }

                if (inProcessButton) {
                    // Scroll button into view
                    inProcessButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    await sleep(300);
                    
                    // Click the button
                    inProcessButton.click();
                    console.log(`[Supago] ✅ Clicked "In Process" button`);
                    
                    // Update status to 'in_process' after clicking (but NOT gateway_status - that comes from webhook)
                    try {
                        await proxyFetch(`${settings.dbApiUrl}/api/orders/hash/${orderHash}/status`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                status: 'in_process'
                            })
                        });
                        console.log(`[Supago] ✅ Order status updated to 'in_process' in database (gateway_status will be set when webhook arrives)`);
                    } catch (err) {
                        console.error('[Supago] Error updating order status in DB:', err);
                    }
                    
                    // Wait for table to update after clicking "In Process" (row will disappear/move)
                    await sleep(1500);
                    
                    // Verify the row is gone (helps ensure table updated)
                    const stillVisible = findInProcessButton(order);
                    if (stillVisible) {
                        console.warn(`[Supago] ⚠️ Row for order ${orderUUID} still visible after clicking "In Process" - waiting longer...`);
                    await sleep(1000);
                    } else {
                        console.log(`[Supago] ✅ Row for order ${orderUUID} removed from pending table (moved to in-process)`);
                    }
                    
                    // Increment processed count only after successfully clicking button
                    processedCount++;
                    console.log(`[Supago] ✅ Successfully processed order ${orderIndex + 1}/${orders.length} (clicked "In Process")`);
                    
                    // If more orders to process, ensure table is ready
                    if (orderIndex < orders.length - 1) {
                        console.log(`[Supago] Preparing for next order (${orderIndex + 2}/${orders.length})...`);
                        await sleep(500);
                    }
                } else {
                    console.warn(`[Supago] ⚠️ "In Process" button not found for order ${orderUUID}`);
                    console.warn(`[Supago] Order details:`, {
                        acc_number: order.acc_number,
                        amount: order.amount,
                        username: order.username
                    });
                    // Even if button not found, wait a bit and continue to next order
                    await sleep(500);
                }
            } else {
                // GatewayHub returned failed status or non-201 status code
                const errorMsg = apiResponse.utr || apiResponse.message || apiResponse.error || `GatewayHub returned status ${apiResponse.statusCode || 'unknown'}`;
                console.error(`[Supago] ❌ GatewayHub API failed for order ${orderUUID}: ${errorMsg}`);
                console.error(`[Supago] NOT clicking "In Process" - GatewayHub did not accept the request`);
                
                // Do NOT update gateway_status here - that's only set when webhook arrives
                // Order stays in 'pending' status, gateway_status remains null
                
                console.error(`[Supago] ❌ NOT clicking "In Process" button`);
                console.error(`[Supago] Failed response details:`, {
                    status: apiResponse.status,
                    statusCode: apiResponse.statusCode,
                    txn_id: apiResponse.txn_id,
                    utr: apiResponse.utr,
                    order_id: apiResponse.order_id
                });
                // Skip clicking button but order is already in DB
                skippedCount++;
                continue; // Skip to next order
            }

            // processedCount is incremented above when "In Process" button is successfully clicked
            // Log progress after each order attempt
            console.log(`[Supago] Progress after order ${orderIndex + 1}/${orders.length}: Processed: ${processedCount}, Skipped: ${skippedCount}`);

            // Small delay between rows to appear more human-like (only if we got a response)
            if (apiResponse && apiResponse.status === 'success') {
                // Already waited after clicking button above, just add a small delay here
                await sleep(500 + Math.random() * 500);
            } else {
                // If API failed, shorter delay before next order
                await sleep(300);
            }
        } catch (error) {
            console.error(`[Supago] ❌ Fatal error processing order ${orderIndex + 1}:`, error);
            console.error('[Supago] Stopping further processing for this cycle.');
            console.error('[Supago] Problem order data:', order);
            // Stop processing any further orders in this run
            break;
        }
    }

    const elapsedTime = Date.now() - startTime;
    console.log(`[Supago] Pending orders processing complete. Processed: ${processedCount}, Skipped: ${skippedCount}, Time: ${Math.round(elapsedTime / 1000)}s`);
    
    // NOTE: We only click "In Process" buttons after successful GatewayHub API responses
    // Do NOT click all buttons at the end - only click buttons for orders that got success responses
    // The clickAllInProcessButtons() is called individually for each successful order above
    
    return { 
        processed: processedCount, 
        skipped: skippedCount, 
        remaining: [],
        timeout: false 
    };
}

/**
 * Click all "In Process" buttons on the current page (pending view)
 */
async function clickAllInProcessButtons() {
    console.log('[Supago] Clicking all "In Process" buttons on pending page...');
    
    // Find all "In Process" buttons on the page
    const allButtons = document.querySelectorAll('button');
    const inProcessButtons = [];
    
    for (const button of allButtons) {
        const buttonText = button.textContent.trim();
        // Match exact text "In Process" (case insensitive)
        if (buttonText.toLowerCase() === 'in process' || 
            buttonText.toLowerCase() === 'in-process' ||
            buttonText.toLowerCase().includes('in process')) {
            // Make sure button is not disabled
            if (!button.disabled) {
                inProcessButtons.push(button);
            }
        }
    }
    
    console.log(`[Supago] Found ${inProcessButtons.length} "In Process" buttons on pending page`);
    
    if (inProcessButtons.length === 0) {
        console.log('[Supago] No "In Process" buttons found on pending page');
        return;
    }
    
    // Click each button with a small delay
    for (let i = 0; i < inProcessButtons.length; i++) {
        const button = inProcessButtons[i];
        try {
            // Scroll button into view
            button.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(300);
            
            // Click the button
            button.click();
            console.log(`[Supago] ✅ Clicked "In Process" button ${i + 1}/${inProcessButtons.length}`);
            
            // Wait between clicks to avoid overwhelming the page
            await sleep(500);
        } catch (error) {
            console.error(`[Supago] Error clicking "In Process" button ${i + 1}:`, error);
        }
    }
    
    console.log(`[Supago] ✅ Completed clicking all ${inProcessButtons.length} "In Process" buttons`);
    
    // Wait a moment for all actions to complete
    await sleep(1000);
}

/**
 * Switch to in-process view
 */
/**
 * Normalize a status label string for comparison (handles variations like "In Process", "in-process", etc.)
 */
function normalizeStatusLabel(text) {
    if (!text) return '';
    return text.toString().toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Check if a piece of text represents the "Pending" status option.
 */
function isPendingStatusText(text) {
    const t = normalizeStatusLabel(text);
    return t === 'pending' || t.includes('pending');
}

/**
 * Check if a piece of text represents the "In Process" status option.
 */
function isInProcessStatusText(text) {
    const t = normalizeStatusLabel(text);
    // Accept common variants: "in process", "in-process", "inprocess"
    return t === 'in process' || t === 'in-process' || t === 'inprocess';
}

/**
 * Detect which view we're currently on by checking the status button text or table buttons
 * Returns: 'pending', 'in-process', or 'unknown'
 */
function detectCurrentView() {
    try {
        // Find the combobox button that shows status
        let statusButtons = Array.from(document.querySelectorAll('button[role="combobox"]'));
        let statusButton = statusButtons.find(btn => {
            const text = normalizeStatusLabel(btn.textContent);
            return isPendingStatusText(text) || isInProcessStatusText(text) || text.includes('status');
        });

        if (!statusButton) {
            const allButtons = Array.from(document.querySelectorAll('button'));
            statusButton = allButtons.find(btn => {
                const span = btn.querySelector('span');
                const text = span ? normalizeStatusLabel(span.textContent) : normalizeStatusLabel(btn.textContent);
                return isPendingStatusText(text) || isInProcessStatusText(text) || text.includes('status');
            });
        }

        if (statusButton) {
            const currentText = normalizeStatusLabel(statusButton.textContent);
            if (isPendingStatusText(currentText)) {
                return 'pending';
            }
            if (isInProcessStatusText(currentText)) {
                return 'in-process';
            }
        }

        // Fallback: Try to detect by checking table buttons (Accept/Reject = in-process, In Process button = pending view)
        const rows = document.querySelectorAll('table tbody tr');
        for (const row of rows) {
            const buttons = row.querySelectorAll('button');
            for (const btn of buttons) {
                const btnText = normalizeStatusLabel(btn.textContent);
                if (btnText.includes('accept') || btnText.includes('reject')) {
                    return 'in-process';
                }
                if (isInProcessStatusText(btnText)) {
                    // Row has an "In Process" button → we're on Pending view
                    return 'pending';
                }
            }
        }
        return 'unknown';
    } catch (error) {
        console.error('[Supago] Error detecting current view:', error);
        return 'unknown';
    }
}

/**
 * Stop pending polling and wait for any active pending processing to complete
 */
async function stopPendingPollingAndWait() {
    console.log('[Supago] Stopping pending polling before switching views...');
    
    // Stop the pending polling timer
    if (pendingPollTimer) {
        clearInterval(pendingPollTimer);
        pendingPollTimer = null;
        console.log('[Supago] ✅ Pending polling timer stopped');
    }
    
    // Wait for any active pending processing to complete (up to 10 seconds)
    let waitAttempts = 0;
    const maxWaitAttempts = 20; // 20 * 500ms = 10 seconds max
    while (isProcessing && waitAttempts < maxWaitAttempts) {
        console.log(`[Supago] Waiting for pending processing to complete... (attempt ${waitAttempts + 1}/${maxWaitAttempts})`);
        await sleep(500);
        waitAttempts++;
    }
    
    if (isProcessing) {
        console.warn('[Supago] ⚠️ Pending processing did not complete within timeout, but proceeding anyway...');
    } else {
        console.log('[Supago] ✅ Pending processing stopped, safe to switch views');
    }
}

/**
 * Ensure we're on the pending view (switch from in-process if needed)
 */
async function ensurePendingView() {
    console.log('[Supago] Ensuring pending view...');

    try {
        await sleep(500);
        
        // First, detect which view we're currently on
        const currentView = detectCurrentView();
        console.log(`[Supago] Current view detected: ${currentView}`);
        
        if (currentView === 'pending') {
            console.log('[Supago] Already on pending view');
            await ensureOrdersLoaded('pending');
            return true;
        }
        
        // Find the combobox button that shows status
        let statusButtons = Array.from(document.querySelectorAll('button[role=\"combobox\"]'));
        let statusButton = statusButtons.find(btn => {
            const text = normalizeStatusLabel(btn.textContent);
            return isPendingStatusText(text) || isInProcessStatusText(text) || text.includes('status');
        });

        if (!statusButton) {
            const allButtons = Array.from(document.querySelectorAll('button'));
            statusButton = allButtons.find(btn => {
                const span = btn.querySelector('span');
                const text = span ? normalizeStatusLabel(span.textContent) : normalizeStatusLabel(btn.textContent);
                return isPendingStatusText(text) || isInProcessStatusText(text) || text.includes('status');
            });
        }

        if (!statusButton) {
            // If we detected we're on in-process but can't find button, wait and try again
            if (currentView === 'in-process') {
                console.warn('[Supago] Detected in-process view but status button not found - waiting and retrying...');
                await sleep(1500);
                const retryView = detectCurrentView();
                if (retryView === 'pending') {
                    console.log('[Supago] View switched to pending after wait');
                    await ensureOrdersLoaded('pending');
                    return true;
                }
            }
            console.warn('[Supago] Status combobox button not found – assuming already on pending view');
            await ensureOrdersLoaded('pending');
            return true;
        }

        // Check if already on pending view (double-check)
        const currentText = statusButton.textContent.toLowerCase();
        if (currentText.includes('pending')) {
            console.log('[Supago] Already on pending view (verified)');
            await ensureOrdersLoaded('pending');
            return true;
        }

        // Switch to pending view
        statusButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);
        statusButton.click();
        console.log('[Supago] Clicked status combobox to open dropdown');
        await sleep(1000); // Increased wait for dropdown to open

        // Find and click the "Pending" option
        const pendingOption = Array.from(document.querySelectorAll('div[role="option"]')).find(opt => {
            const text = opt.textContent.toLowerCase().trim();
            return text === 'pending' || text.includes('pending');
        });

        if (pendingOption) {
            pendingOption.click();
            console.log('[Supago] Selected "Pending" from dropdown');
            
            // Wait for view to switch (dropdown close and page update)
            await sleep(1000);
            
            // Verify we actually switched to pending view
            const verifyView = detectCurrentView();
            if (verifyView === 'pending') {
                console.log('[Supago] ✅ Verified switch to pending view');
            } else {
                console.warn(`[Supago] ⚠️ View verification failed after dropdown click - detected: ${verifyView}, expected: pending`);
                // Don't return false yet, try clicking Load and verify again
            }
            
            // Click Load button to refresh table after switching views
            const loadSuccess = await ensureOrdersLoaded('pending');
            if (!loadSuccess) {
                console.warn('[Supago] ⚠️ Load button click failed after switching to pending view');
                return false;
            }
            
            // ✅ CRITICAL: Final verification after Load button to ensure we're on pending view
            await sleep(500); // Brief wait for view to settle
            const finalViewCheck = detectCurrentView();
            if (finalViewCheck === 'pending') {
                console.log('[Supago] ✅ Final verification: Confirmed on pending view after Load button');
            return true;
            } else {
                console.warn(`[Supago] ⚠️ Final view verification failed - detected: ${finalViewCheck}, expected: pending`);
                return false;
            }
        } else {
            console.warn('[Supago] "Pending" option not found in dropdown');
            await ensureOrdersLoaded('pending');
            return false;
        }
    } catch (error) {
        console.error('[Supago] Error ensuring pending view:', error);
        await ensureOrdersLoaded('pending');
        return false;
    }
}

async function switchToInProcessView() {
    console.log('[Supago] Switching to in-process view...');

    try {
        // ✅ CRITICAL: Stop pending polling and wait for processing to complete before switching
        // Pending polling only runs on pending page, so we must stop it before switching to in-process
        await stopPendingPollingAndWait();
        
        // Wait a bit for page to fully render
        await sleep(500);
        
        // First, detect which view we're currently on
        const currentView = detectCurrentView();
        console.log(`[Supago] Current view detected: ${currentView}`);
        
        if (currentView === 'in-process') {
            console.log('[Supago] Already on in-process view');
            await ensureOrdersLoaded('in-process');
            return true;
        }
        
        // Find the combobox button that shows "Pending" status
        // Strategy 1: Look for button with role="combobox"
        let statusButtons = Array.from(document.querySelectorAll('button[role="combobox"]'));
        console.log(`[Supago] Found ${statusButtons.length} buttons with role="combobox"`);
        
        let statusButton = statusButtons.find(btn => {
            const text = btn.textContent.toLowerCase().trim();
            return text.includes('pending') || text.includes('in-process') || text.includes('inprocess') || text.includes('status');
        });

        // Strategy 2: Find button by checking span inside
        if (!statusButton) {
            console.log('[Supago] Trying alternative: searching all buttons with spans...');
            const allButtons = Array.from(document.querySelectorAll('button'));
            statusButton = allButtons.find(btn => {
                const span = btn.querySelector('span');
                if (span) {
                    const text = span.textContent.toLowerCase().trim();
                    return text === 'pending' || text.includes('pending') || text.includes('in-process') || text.includes('status');
                }
                return false;
            });
        }

        // Strategy 3: Look for select elements or dropdowns
        if (!statusButton) {
            console.log('[Supago] Trying alternative: searching for select elements...');
            const selects = Array.from(document.querySelectorAll('select'));
            const statusSelect = selects.find(sel => {
                const text = sel.textContent.toLowerCase() || sel.getAttribute('aria-label')?.toLowerCase() || '';
                return text.includes('status') || text.includes('pending');
            });
            if (statusSelect) {
                console.log('[Supago] Found select element for status, will try to use it');
                // For now, log it - you may need to handle select differently
            }
        }

        // Strategy 4: Look for any button containing status-related keywords
        if (!statusButton) {
            console.log('[Supago] Trying alternative: searching all buttons for status keywords...');
            const allButtons = Array.from(document.querySelectorAll('button'));
            statusButton = allButtons.find(btn => {
                const text = btn.textContent.toLowerCase().trim();
                const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
                return (text.includes('status') || ariaLabel.includes('status')) && 
                       (text.includes('pending') || text.includes('in-process') || text.includes('filter') || text.length < 50);
            });
        }

        if (!statusButton) {
            // If we detected we're on pending but can't find button, wait and try again
            if (currentView === 'pending') {
                console.warn('[Supago] Detected pending view but status button not found - waiting and retrying...');
                await sleep(1500);
                const retryView = detectCurrentView();
                if (retryView === 'in-process') {
                    console.log('[Supago] View switched to in-process after wait');
                    await ensureOrdersLoaded('in-process');
                    return true;
                }
            }
            console.warn('[Supago] Status combobox button not found – proceeding with current view (user may have selected In Process manually)');
            console.log('[Supago] Available combobox buttons:', Array.from(document.querySelectorAll('button[role="combobox"]')).map(btn => ({
                text: btn.textContent.trim(),
                role: btn.getAttribute('role'),
                ariaLabel: btn.getAttribute('aria-label'),
                className: btn.className
            })));
            console.log('[Supago] All buttons on page (first 20):', Array.from(document.querySelectorAll('button')).slice(0, 20).map(btn => ({
                text: btn.textContent.trim().substring(0, 50),
                role: btn.getAttribute('role'),
                ariaLabel: btn.getAttribute('aria-label'),
                id: btn.id,
                className: btn.className.substring(0, 50)
            })));

            // Assume user has already set the correct view; just make sure rows are loaded
            await ensureOrdersLoaded('in-process');
            return true;
        }

        console.log('[Supago] Found status button with text:', statusButton.textContent.trim());

        // Check if already on in-process view (double-check)
        const currentText = statusButton.textContent.toLowerCase();
        if (currentText.includes('in-process') || currentText.includes('inprocess')) {
            console.log('[Supago] Already on in-process view (verified)');
            await ensureOrdersLoaded('in-process');
            return true;
        }

        // Scroll button into view
        statusButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);

        // Click the button to open the dropdown
        statusButton.click();
        console.log('[Supago] Clicked status combobox to open dropdown');
        
        // Wait for dropdown to open
        await sleep(500);

        // Now find and click the "In-process" option in the dropdown
        // The dropdown options might be in a list/div that appears after clicking
        const dropdownOptions = await waitForDropdownOptions();
        
        if (!dropdownOptions || dropdownOptions.length === 0) {
            console.error('[Supago] Dropdown options not found after opening');
            return false;
        }

        // Find the "In-process" option
        const inProcessOption = dropdownOptions.find(opt => {
            const text = (opt.textContent || opt.innerText || '').toLowerCase().trim();
            return text.includes('in-process') || 
                   text.includes('inprocess') || 
                   text === 'in-process' ||
                   (text.includes('in') && text.includes('process'));
        });

        if (!inProcessOption) {
            console.error('[Supago] In-process option not found in dropdown');
            console.log('[Supago] Available options:', dropdownOptions.map(opt => opt.textContent.trim()));
            return false;
        }

        // Click the in-process option
        inProcessOption.click();
        console.log('[Supago] Selected "In-process" from dropdown');

        // Wait for view to switch (dropdown close and page update)
        await sleep(1000);

        // Verify we actually switched to in-process view
        const verifyView = detectCurrentView();
        if (verifyView === 'in-process') {
            console.log('[Supago] ✅ Verified switch to in-process view');
        } else {
            console.warn(`[Supago] ⚠️ View verification failed after dropdown click - detected: ${verifyView}, expected: in-process`);
            // Don't return false yet, try clicking Load and verify again
        }

        // Click Load button to refresh table after switching views
        const loadSuccess = await ensureOrdersLoaded('in-process');
        if (!loadSuccess) {
            console.warn('[Supago] ⚠️ Load button click failed after switching to in-process view');
            return false;
        }
        
        // ✅ CRITICAL: Final verification after Load button to ensure we're on in-process view
        await sleep(500); // Brief wait for view to settle
        const finalViewCheck = detectCurrentView();
        if (finalViewCheck === 'in-process') {
            console.log('[Supago] ✅ Final verification: Confirmed on in-process view after Load button');
        } else {
            console.warn(`[Supago] ⚠️ Final view verification failed - detected: ${finalViewCheck}, expected: in-process`);
            // Continue anyway, but log warning
        }
        
        // ✅ CRITICAL: Wait for table to be fully populated after Load (matching autobot line 1039-1041)
        // This prevents reading stale data from the previous view, which causes duplicates
        console.log('[Supago] Waiting for in-process table to be fully populated after Load...');
        let tableReady = false;
        for (let waitAttempt = 0; waitAttempt < 10; waitAttempt++) {
            await sleep(300);
            const rows = document.querySelectorAll('table tbody tr');
            const validRows = Array.from(rows).filter(row => {
                const cells = row.querySelectorAll('td');
                return cells.length > 5 && !row.textContent.trim().toLowerCase().includes('no records found');
            });
            if (validRows.length > 0 || rows.length === 0) {
                // Either we have valid rows OR table is empty (both are valid states)
                tableReady = true;
                console.log(`[Supago] ✅ In-process table ready after Load (${validRows.length} valid rows, attempt ${waitAttempt + 1})`);
                break;
            }
        }
        if (!tableReady) {
            console.warn('[Supago] ⚠️ Table may not be fully loaded, but proceeding anyway...');
        }
        
        // Additional wait for React table filtering/rendering to complete (matching autobot line 1040)
        await sleep(500);

        return true;
    } catch (error) {
        console.error('[Supago] Error switching view:', error);
        return false;
    }
}

/**
 * Wait for dropdown options to appear after clicking combobox
 */
async function waitForDropdownOptions(maxWait = 5000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
        // Look for dropdown options - they might be in various structures
        // Try common patterns: div[role="option"], li, [role="listbox"] > *, etc.
        const selectors = [
            '[role="option"]',
            '[role="listbox"] [role="option"]',
            '[role="listbox"] > *',
            '[data-radix-popper-content-wrapper] [role="option"]',
            '.dropdown-content [role="option"]',
            'ul[role="listbox"] li',
            'div[role="listbox"] > div'
        ];

        for (const selector of selectors) {
            const options = Array.from(document.querySelectorAll(selector));
            if (options.length > 0) {
                console.log(`[Supago] Found ${options.length} dropdown options using selector: ${selector}`);
                return options;
            }
        }

        await sleep(200);
    }

    console.warn('[Supago] Dropdown options did not appear within timeout');
    return null;
}

/**
 * Check if there are any orders with status mismatch (status != gateway_status)
 * Matches Autoflow's mismatch detection logic:
 * - status is NOT 'success' or 'failed' (still pending/in_process)
 * - gateway_status exists and is 'success' or 'failed' (webhook received)
 * - final_action is NULL (not yet processed)
 * Returns: { hasOrders: boolean, orders: array }
 */
async function checkForOrdersWithMismatch() {
    const settings = await getSettings();
    // Get login_group_key from login config to scope orders to this group
    let loginGroupKey = null;
    try {
        const encryptedCreds = await getCredentials();
        if (encryptedCreds && encryptedCreds.username) {
            const loggedInUsername = await decryptText(encryptedCreds.username, 'supago-extension-key');
            const config = await getLoginConfig(loggedInUsername, settings.dbApiUrl);
            const loginCfg = config?.login || {};
            loginGroupKey = loginCfg.login_group_key || null;
            console.log(`[Supago] 🔍 Mismatch check: login_group_key=${loginGroupKey || 'none'}`);
        }
    } catch (err) {
        console.error('[Supago] Error getting login_group_key for mismatch check:', err);
    }

    // Fetch orders with mismatch from backend (backend filters by login_group_key)
    let dbOrders = [];
    try {
        const resp = await getOrdersWithMismatch(settings.dbApiUrl, loginGroupKey);
        console.log(`[Supago] 🔍 Mismatch API response:`, resp);
        dbOrders = resp.orders || [];
        console.log(`[Supago] 🔍 Fetched ${dbOrders.length} orders with status mismatch from DB (login_group_key: ${loginGroupKey || 'none'})`);
        if (dbOrders.length > 0) {
            console.log(`[Supago] 🔍 Sample order fields:`, {
                order_id: dbOrders[0].order_id,
                status: dbOrders[0].status,
                gateway_status: dbOrders[0].gateway_status,
                final_action: dbOrders[0].final_action || 'none',
                username: dbOrders[0].username,
                amount: dbOrders[0].amount
            });
        }
    } catch (err) {
        console.error('[Supago] Error fetching orders with mismatch from DB:', err);
        return { hasOrders: false, orders: [] };
    }

    // Backend already filters by login_group_key, so we process all returned orders
    const ordersToProcess = [];
    for (const dbOrder of dbOrders) {
        console.log(`[Supago] 🔍 Checking order: ${dbOrder.order_id}, status: ${dbOrder.status}, gateway_status: ${dbOrder.gateway_status}, final_action: ${dbOrder.final_action || 'none'}`);

        // Backend already filters for final_action IS NULL, but double-check
        if (dbOrder.final_action) {
            console.log(`[Supago] ⏭️ Order ${dbOrder.order_id} skipped: already processed (final_action: ${dbOrder.final_action})`);
            continue;
        }

        // Backend already filters for gateway_status IN ('success', 'failed'), but verify
        const gwStatus = dbOrder.gateway_status;
        if (gwStatus === 'success' || gwStatus === 'failed') {
            console.log(`[Supago] ✅ Order ${dbOrder.order_id} qualifies for processing (status: ${dbOrder.status}, gateway_status: ${gwStatus})`);
            ordersToProcess.push(dbOrder);
        } else {
            console.log(`[Supago] ⏭️ Order ${dbOrder.order_id} skipped: invalid gateway_status (${gwStatus || 'null'})`);
        }
    }

    console.log(`[Supago] 🔍 Mismatch check result: ${ordersToProcess.length} orders need processing`);
    return { hasOrders: ordersToProcess.length > 0, orders: ordersToProcess };
}

/**
 * Process orders with status mismatch (approve/reject)
 * NOTE: This function assumes we're already on the in-process page
 * @param {Array} mismatchOrders - Optional array of orders with mismatch (if provided, skips DB fetch)
 */
async function processInProcessOrders(mismatchOrders = null) {
    console.log('[Supago] Processing orders with status mismatch...');

    const settings = await getSettings();
    
    // ✅ CRITICAL: Check for error page first
    if (isErrorPage()) {
        console.error('[Supago] ⚠️ Error page detected in processInProcessOrders. Handling error page...');
        await handleErrorPage();
        return;
    }
    
    // ✅ CRITICAL: Verify we're on in-process view before processing
    const currentView = detectCurrentView();
    if (currentView !== 'in-process') {
        console.warn(`[Supago] ⚠️ processInProcessOrders called but we're on ${currentView} view, not in-process. Switching to in-process view...`);
        const switchSuccess = await switchToInProcessView();
        if (!switchSuccess) {
            console.error('[Supago] ❌ Failed to switch to in-process view. Aborting processInProcessOrders.');
            return;
        }
        // Verify again after switching
        const verifyView = detectCurrentView();
        if (verifyView !== 'in-process') {
            console.error(`[Supago] ❌ Still not on in-process view after switch (detected: ${verifyView}). Aborting.`);
            return;
        }
    }
    
    // ✅ CRITICAL: Check execution_channel - do not process if it's not 'chrome_extension'
    const executionChannel = settings.executionChannel || 'autobot';
    if (executionChannel !== 'chrome_extension') {
        console.log(`[Supago] ⏭️ Skipping in-process processing (execution_channel=${executionChannel}, not chrome_extension)`);
        return;
    }
    
    if (settings.isActive === false) {
        console.log('[Supago] ⏭️ Skipping in-process processing (login is not active)');
        return;
    }
    
    // Get login_group_key from login config to scope orders to this group
    let loginGroupKey = null;
    try {
        const encryptedCreds = await getCredentials();
        if (encryptedCreds && encryptedCreds.username) {
            const loggedInUsername = await decryptText(encryptedCreds.username, 'supago-extension-key');
            const config = await getLoginConfig(loggedInUsername, settings.dbApiUrl);
            const loginCfg = config?.login || {};
            loginGroupKey = loginCfg.login_group_key || null;
            console.log(`[Supago] Mismatch processing: detected login username "${loggedInUsername}", login_group_key="${loginGroupKey}"`);
        }
    } catch (err) {
        console.error('[Supago] Error getting login_group_key for mismatch filtering:', err);
    }

    // Use provided mismatch orders or fetch from backend
    let dbOrders = [];
    if (mismatchOrders && mismatchOrders.length > 0) {
        dbOrders = mismatchOrders;
        console.log(`[Supago] Using ${dbOrders.length} mismatch orders provided from check`);
    } else {
        try {
            const resp = await getOrdersWithMismatch(settings.dbApiUrl, loginGroupKey);
            dbOrders = resp.orders || [];
            console.log(`[Supago] Fetched ${dbOrders.length} orders with mismatch from DB (login_group_key: ${loginGroupKey || 'none'})`);
        } catch (err) {
            console.error('[Supago] Error fetching orders with mismatch from DB:', err);
            return;
        }
    }

    let processedCount = 0;
    let skippedCount = 0;
    const MAX_ORDERS_PER_CYCLE = 50; // Increased limit to handle more orders
    
    // Track start time for timeout management
    const startTime = Date.now();

    console.log(`[Supago] ========== Processing ${Math.min(dbOrders.length, MAX_ORDERS_PER_CYCLE)} mismatch orders ==========`);
    console.log(`[Supago] Order list:`, dbOrders.slice(0, MAX_ORDERS_PER_CYCLE).map((o, i) => `${i + 1}. ${o.username || 'N/A'} - ₹${o.amount || 'N/A'} (${o.order_id})`).join(', '));

    // Process mismatch orders with 5-minute timeout
    // Using search box to locate each order on page
    for (let i = 0; i < Math.min(dbOrders.length, MAX_ORDERS_PER_CYCLE); i++) {
        // Check if we've exceeded the 5-minute timeout
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime >= VIEW_TIMEOUT_MS) {
            const remainingOrders = dbOrders.slice(i);
            console.log(`[Supago] ⏱️ View timeout reached (${Math.round(elapsedTime / 1000)}s). Stopping mismatch processing.`);
            console.log(`[Supago] Processed: ${processedCount}, Skipped: ${skippedCount}, Remaining: ${remainingOrders.length}`);
            return { 
                processed: processedCount, 
                skipped: skippedCount, 
                remaining: remainingOrders,
                timeout: true 
            };
        }
        const dbOrder = dbOrders[i];
        console.log(`[Supago] ========== Processing mismatch order ${i + 1}/${Math.min(dbOrders.length, MAX_ORDERS_PER_CYCLE)} ==========`);
        console.log(`[Supago] Order details: order_id=${dbOrder.order_id}, username=${dbOrder.username}, amount=${dbOrder.amount}, gateway_status=${dbOrder.gateway_status}`);
        
        try {
            // Backend already filters by login_group_key, so all orders here are from the same group
            // No need to check loginTag anymore

            // Skip if already processed
            if (dbOrder.final_action) {
                console.log(`[Supago] Order ${dbOrder.order_id} already ${dbOrder.final_action}, skipping`);
                skippedCount++;
                continue;
            }

            // IMPORTANT: Only process orders that have received a webhook callback
            // We drive this from gateway_status which is ONLY set by /callback endpoint
            const gwStatus = dbOrder.gateway_status;

            if (!gwStatus || gwStatus === '' || gwStatus === 'pending') {
                console.log(`[Supago] Order ${dbOrder.order_id} has not received webhook yet (gateway_status: ${gwStatus || 'null'}), skipping`);
                skippedCount++;
                continue;
            }

            // Only process if gateway_status is explicitly 'success' or 'failed'
            if (gwStatus !== 'success' && gwStatus !== 'failed') {
                console.log(`[Supago] Order ${dbOrder.order_id} has invalid gateway_status: ${gwStatus}, skipping`);
                skippedCount++;
                continue;
            }

            // Determine action based on webhook status
            const action = gwStatus === 'success' ? 'approved' : 'rejected';

            console.log(`[Supago] ✅ Order ${dbOrder.order_id} received webhook: ${gwStatus} → ${action}`);

            // IMPORTANT: Clear search box BEFORE searching (ensures clean state)
            await clearSearchBox();
            await sleep(300);
            
            // Narrow table to this username using search bar
            if (!(await searchByUsernameInPage(dbOrder.username))) {
                console.warn(`[Supago] Could not search table for username ${dbOrder.username}, skipping`);
                skippedCount++;
                // Clear search box even if search failed
                await clearSearchBox();
                await sleep(500);
                continue;
            }

            // Build orderData object for row-matching helpers
            // ✅ CRITICAL: Include username so findApproveButton/findRejectButton can match ALL THREE
            const orderData = {
                acc_number: dbOrder.acc_number,
                amount: String(dbOrder.amount),
                bank_name: dbOrder.bank_name,
                username: dbOrder.username // ✅ Required for strict matching (prevents matching wrong order)
            };

            // Find and click appropriate button
            console.log(`[Supago] 🔍 Searching for ${action} button for order ${dbOrder.order_id}...`);
            console.log(`[Supago] Search criteria (ALL THREE must match):`, {
                acc_number: orderData.acc_number,
                amount: orderData.amount,
                username: orderData.username,
                bank_name: orderData.bank_name
            });
            const button = action === 'approved' ? findApproveButton(orderData) : findRejectButton(orderData);

            // Log button search result
            if (button) {
                console.log(`[Supago] ✅ Button FOUND for order ${dbOrder.order_id} - will click and update DB`);
            } else {
                console.log(`[Supago] ❌ Button NOT FOUND for order ${dbOrder.order_id} - will skip (NO DB UPDATE)`);
            }

            // Enter UTR in remark field (if available) - matching backend behavior
            // Must be done BEFORE clicking the button
            let utrEntered = false;
            if (button && dbOrder.utr) {
                try {
                    // Find remark input field in the row (same row as the button)
                    const row = button.closest('tr');
                    if (row) {
                        const remarkInput = row.querySelector('input[placeholder="Enter Remark"]');
                        if (remarkInput) {
                            remarkInput.value = dbOrder.utr;
                            remarkInput.dispatchEvent(new Event('input', { bubbles: true }));
                            remarkInput.dispatchEvent(new Event('change', { bubbles: true }));
                            await sleep(500); // Wait for input to be set
                            
                            // Verify UTR was entered
                            if (remarkInput.value === dbOrder.utr) {
                                utrEntered = true;
                                console.log(`[Supago] ✅ Entered UTR in remark field: ${dbOrder.utr}`);
                            } else {
                                console.warn(`[Supago] ⚠️ UTR entry mismatch - Expected: ${dbOrder.utr}, Got: ${remarkInput.value}`);
                            }
                        } else {
                            console.warn(`[Supago] ⚠️ Remark input field not found in row`);
                        }
                    }
                } catch (err) {
                    console.error(`[Supago] ❌ Error entering UTR in remark field: ${err}`);
                }
            }

            if (button) {
                // ✅ CRITICAL SAFEGUARD: Verify the button's row actually contains ALL required order data
                // This prevents clicking buttons for wrong orders if the finder matched incorrectly
                // Must verify: username, amount, AND account number (all three required)
                const buttonRow = button.closest('tr');
                let buttonRowMatches = false;
                
                if (buttonRow) {
                    const rowText = buttonRow.textContent || '';
                    
                    // ✅ CRITICAL: Verify ALL three identifiers (username, amount, account number)
                    let matchesUsername = false;
                    let matchesAmount = false;
                    let matchesAccNumber = false;
                    
                    // Check username (should be present since we filtered by it, but verify anyway)
                    if (dbOrder.username && rowText.includes(dbOrder.username)) {
                        matchesUsername = true;
                    }
                    
                    // Check amount (critical for matching correct order)
                    if (orderData.amount && rowText.includes(orderData.amount)) {
                        matchesAmount = true;
                    }
                    
                    // Check account number (most reliable identifier)
                    if (orderData.acc_number && rowText.includes(orderData.acc_number)) {
                        matchesAccNumber = true;
                    }
                    
                    // ✅ ALL THREE must match: username AND amount AND account number
                    if (matchesUsername && matchesAmount && matchesAccNumber) {
                        buttonRowMatches = true;
                        console.log(`[Supago] ✅ Verified button row matches order:`, {
                            username: dbOrder.username,
                            amount: orderData.amount,
                            acc_number: orderData.acc_number
                        });
                    } else {
                        console.warn(`[Supago] ⚠️ Button found but row does NOT match order! Row text: ${rowText.substring(0, 200)}...`);
                        console.warn(`[Supago] Verification failed:`, {
                            username: matchesUsername ? '✓' : '✗',
                            amount: matchesAmount ? '✓' : '✗',
                            acc_number: matchesAccNumber ? '✓' : '✗',
                            expected_username: dbOrder.username,
                            expected_amount: orderData.amount,
                            expected_acc_number: orderData.acc_number
                        });
                        console.warn(`[Supago] This is likely a false match - skipping this order (NO DB UPDATE)`);
                        skippedCount++;
                        await clearSearchBox();
                        await sleep(500);
                        continue; // Skip this order - button doesn't match
                    }
                } else {
                    console.warn(`[Supago] ⚠️ Button found but cannot find parent row - skipping (NO DB UPDATE)`);
                    skippedCount++;
                    await clearSearchBox();
                    await sleep(500);
                    continue; // Skip this order - no row found
                }
                
                // Only proceed if button row matches the order
                if (!buttonRowMatches) {
                    console.warn(`[Supago] ⚠️ Button row verification failed - skipping order ${dbOrder.order_id} (NO DB UPDATE)`);
                    skippedCount++;
                    await clearSearchBox();
                    await sleep(500);
                    continue;
                }
                
                // ✅ CRITICAL: Double-check that we're clicking the CORRECT button type
                // Verify the button text matches the expected action (approve vs reject)
                const buttonText = button.textContent?.trim().toLowerCase() || '';
                const expectedButtonText = action === 'approved' ? 'approve' : 'reject';
                const buttonMatchesAction = buttonText.includes(expectedButtonText) || 
                                            (action === 'approved' && (buttonText.includes('accept') || buttonText === 'approve')) ||
                                            (action === 'rejected' && buttonText === 'reject');
                
                if (!buttonMatchesAction) {
                    console.error(`[Supago] ❌ CRITICAL ERROR: Button type mismatch!`);
                    console.error(`[Supago] Expected ${action} button (gateway_status: ${gwStatus}), but found button with text: "${buttonText}"`);
                    console.error(`[Supago] This would cause wrong action! Skipping order to prevent incorrect processing.`);
                    skippedCount++;
                    await clearSearchBox();
                    await sleep(500);
                    continue; // Skip to prevent clicking wrong button
                }
                
                console.log(`[Supago] ✅ Verified button type matches action: ${action} (button text: "${buttonText}", gateway_status: ${gwStatus})`);
                
                // Scroll button into view
                button.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await sleep(300);
                
                // Click the button
                button.click();
                console.log(`[Supago] ✅ Clicked ${action} button for order ${dbOrder.order_id} (gateway_status: ${gwStatus}, UTR: ${dbOrder.utr || 'N/A'}${utrEntered ? ', remark entered' : ''})`);

            // Wait for action to complete (reduced from 500ms to 300ms for performance)
            await sleep(300);

                // Update database with final action using CE order_id (UUID_loginTag)
                // Button was clicked, so use default status_detail message
                console.log(`[Supago] 🔄 Updating DB for order ${dbOrder.order_id} - action: ${action} (button was found, verified, and clicked)`);
                await updateOrderStatus(dbOrder.order_id, action, settings.dbApiUrl);
                console.log(`[Supago] ✅ DB updated successfully for order ${dbOrder.order_id}`);

                // Clear search box after processing (like Autoflow)
                await clearSearchBox();
                await sleep(300); // Reduced from 500ms to 300ms for performance

                processedCount++;
                console.log(`[Supago] ✅ Processed order ${processedCount}/${dbOrders.length} (${dbOrder.order_id})`);
                
                // Continue to next order (process all mismatch orders in one cycle)
                // Add a small delay between orders to avoid overwhelming the page (reduced for performance)
                await sleep(500 + Math.random() * 300); // Reduced from 1000-1500ms to 500-800ms
            } else {
                // Button not found - order not visible on page
                // Skip this order and move to next (do not update DB)
                console.warn(`[Supago] ⚠️ ${action} button not found for order ${dbOrder.order_id}`);
                console.warn(`[Supago] Order details:`, {
                    order_id: dbOrder.order_id,
                    acc_number: orderData.acc_number,
                    amount: orderData.amount,
                    bank_name: orderData.bank_name,
                    username: dbOrder.username
                });
                console.log(`[Supago] ⏭️ Order not found on page - skipping and moving to next order (NO DB UPDATE)`);
                console.log(`[Supago] 🔒 NOT calling updateOrderStatus() - button was not found`);
                
                // Increment skipped count and move to next order
                    skippedCount++;
                
                // Clear search box even if button not found (for next order)
                await clearSearchBox();
                await sleep(300); // Reduced from 500ms to 300ms for performance
                
                // Continue to next order - DO NOT update database
                continue;
            }

            // Log progress after each order
            console.log(`[Supago] Progress: ${i + 1}/${Math.min(dbOrders.length, MAX_ORDERS_PER_CYCLE)} - Processed: ${processedCount}, Skipped: ${skippedCount}`);

        } catch (error) {
            console.error(`[Supago] ❌ Error processing in-process order ${i + 1} (${dbOrder.order_id}):`, error);
            skippedCount++;
            // Clear search box on error to ensure clean state for next order
            await clearSearchBox();
            await sleep(500);
            // Continue to next order instead of breaking
            continue;
        }
    }

    const elapsedTime = Date.now() - startTime;
    console.log(`[Supago] ========== In-process orders processing complete ==========`);
    console.log(`[Supago] Summary: Processed: ${processedCount}, Skipped: ${skippedCount}, Total: ${Math.min(dbOrders.length, MAX_ORDERS_PER_CYCLE)}, Time: ${Math.round(elapsedTime / 1000)}s`);
    
    return { 
        processed: processedCount, 
        skipped: skippedCount, 
        remaining: [],
        timeout: false 
    };
}

/**
 * Main automation workflow
 */
async function runAutomation() {
    if (isProcessing) {
        console.log('[Supago] Already processing, skipping...');
        return;
    }

    isProcessing = true;

    try {
        // ✅ CRITICAL: Check for error page first and handle it
        if (isErrorPage()) {
            console.error('[Supago] ⚠️ Error page detected at start of automation. Handling...');
            await handleErrorPage();
            isProcessing = false;
            return;
        }
        
        console.log('[Supago] ========== Starting automation cycle ==========');

        const settings = await getSettings();

        // Phase 0: Check with backend whether CE is allowed to work for this login
        let panelUsername = null;
        try {
            const encryptedCreds = await getCredentials();
            if (encryptedCreds && encryptedCreds.username) {
                panelUsername = await decryptText(encryptedCreds.username, 'supago-extension-key');
            }
        } catch (err) {
            console.error('[Supago] Error getting panel username for execution check:', err);
        }

        if (panelUsername) {
            try {
                const config = await getLoginConfig(panelUsername, settings.dbApiUrl);
                console.log(`[Supago] Execution config API response:`, config);
                const loginCfg = config?.login || {};
                const channel = loginCfg.execution_channel || 'autobot';
                const isActive = loginCfg.is_active !== false; // treat missing as true (backward compatible)
                const handlesPending = !!loginCfg.handles_pending;
                const handlesInProcess = !!loginCfg.handles_in_process;

                console.log(`[Supago] Execution config for "${panelUsername}": channel=${channel}, is_active=${isActive}, handles_pending=${handlesPending}, handles_in_process=${handlesInProcess}`);
                console.log(`[Supago] Full login config object:`, JSON.stringify(loginCfg, null, 2));

                // ✅ CRITICAL: Update logger with current username from login config
                if (window.ceLogger && window.ceLogger.updateUsername) {
                    await window.ceLogger.updateUsername(panelUsername);
                    console.log(`[Supago] 📝 Logger updated with username: ${panelUsername}`);
                }

                // Only run CE automation when:
                // - execution_channel is explicitly 'chrome_extension'
                // - login is active in Autoflow (is_active = true)
                if (!config.found || channel !== 'chrome_extension' || !isActive) {
                    console.warn(`[Supago] Chrome Extension is DISABLED for login "${panelUsername}" (execution_channel=${channel}, is_active=${isActive}). Skipping automation.`);
                    return;
                }

                // ✅ CRITICAL: Store execution channel and permissions in settings (same as pollLoginConfig does)
                // This ensures processPendingOrders() and processInProcessOrders() read the correct value
                settings.executionChannel = channel;
                settings.isActive = isActive;
                settings.ceCanProcessPending = handlesPending;
                settings.ceCanProcessInProcess = handlesInProcess;
                await saveSettings(settings); // Save immediately so processing functions can read it
            } catch (err) {
                console.error('[Supago] Error checking execution channel for login:', err);
                // If we cannot verify safely, better to skip than double-process with autobot
                console.warn('[Supago] Skipping automation this cycle because execution channel could not be verified.');
                return;
            }
        } else {
            console.warn('[Supago] Panel username not available; cannot verify execution channel. Skipping automation.');
            return;
        }

        // Phase 1: Login if needed
        if (!isLoggedIn()) {
            console.log('[Supago] Not logged in, attempting login...');
            const loginSuccess = await performLogin();

            if (!loginSuccess) {
                // Even if login check failed, check URL - if we navigated away from login page, login might have succeeded
                const stillOnLoginPage = document.querySelector('input[name="username"], input[type="password"]');
                if (stillOnLoginPage) {
                    console.error('[Supago] Login failed - still on login page. Aborting automation.');
                    return;
                } else {
                    console.warn('[Supago] Login check failed but we navigated away from login page. Continuing automation...');
                    await sleep(2000);
                }
            } else {
                // Wait a moment after successful login for session to be established
                await sleep(2000);
            }
        } else {
            console.log('[Supago] Session appears active (sessions last 24 hours)');
        }

        // Get automation mode from settings (default: 'both')
        // Mode options: 'pending' = only pending, 'in_process' = only mismatch, 'both' = both phases
        const automationMode = settings.automationMode || 'both';
        console.log(`[Supago] Automation mode: ${automationMode}`);

        // Phase 2: Navigate to Manual Withdrawal Requests (only if pending phase is needed)
        // For 'in_process' mode, navigation happens later in Phase 4
        const needsPendingPhase = (automationMode === 'pending' || automationMode === 'both') && settings.ceCanProcessPending;
        const needsInProcessPhase = (automationMode === 'in_process' || automationMode === 'both') && settings.ceCanProcessInProcess;
        
        if (needsPendingPhase) {
        const navSuccess = await navigateToWithdrawalRequests();
        
        // Verify we're still logged in after navigation (check for login redirect)
        if (!navSuccess || !isLoggedIn()) {
            console.error('[Supago] Navigation failed or session expired. May need to login.');
            // If we got redirected to login page, try logging in again
            if (!isLoggedIn()) {
                console.log('[Supago] Session expired during navigation, attempting re-login...');
                const reLoginSuccess = await performLogin();
                if (!reLoginSuccess) {
                    console.error('[Supago] Re-login failed, aborting automation');
                    return;
                }
                await sleep(2000);
                // Try navigation again after re-login
                await navigateToWithdrawalRequests();
                }
            }
        }

        // Phase 3: Process pending orders (if mode allows and login has permission)
        if (needsPendingPhase) {
            console.log('[Supago] ========== PHASE: Pending Orders ==========');
        await processPendingOrders();
        } else {
            if (automationMode === 'pending') {
                console.log('[Supago] Mode is "pending" but handles_pending=false. Skipping.');
            } else {
                console.log('[Supago] Skipping pending phase (mode does not include pending).');
            }
        }

        // Phase 4: Process orders with status mismatch (if mode allows and login has permission)
        // IMPORTANT: Only navigate to in-process page if there are orders with status != gateway_status (like Autoflow)
        // This finds orders where webhook was received but status hasn't been updated to match gateway_status
        if (needsInProcessPhase) {
            console.log('[Supago] ========== PHASE: In-Process Orders (Mismatch) ==========');
            const { hasOrders, orders } = await checkForOrdersWithMismatch();
            if (hasOrders) {
                console.log(`[Supago] Found ${orders.length} order(s) with status mismatch (status != gateway_status). Navigating to in-process page...`);
                
                // Navigate to withdrawal requests page if we haven't already (for 'in_process' mode or if we did pending)
                if (automationMode === 'in_process' || !needsPendingPhase) {
                    // For 'in_process' mode or if we skipped pending, we need to navigate to the page first
                    const navSuccess = await navigateToWithdrawalRequests();
                    if (!navSuccess || !isLoggedIn()) {
                        console.error('[Supago] Navigation failed for in_process phase');
                        return;
                    }
                }
                
                // Switch to in-process view (handles all modes)
                const switchSuccess = await switchToInProcessView();
                
                if (!switchSuccess) {
                    console.error('[Supago] Failed to switch to in-process view, skipping mismatch processing');
                    return;
                }
                
                // ✅ CRITICAL: Additional verification that table has loaded (safety check)
                // switchToInProcessView() already waits, but verify once more before processing
                console.log('[Supago] Final verification: in-process table is ready...');
                await sleep(500); // Additional safety wait
                
                // Process mismatch orders with timeout handling
                const mismatchResult = await processInProcessOrders(orders);
                
                // If timeout occurred, switch to pending and process pending orders
                if (mismatchResult && mismatchResult.timeout && mismatchResult.remaining && mismatchResult.remaining.length > 0) {
                    console.log(`[Supago] ⏱️ Mismatch processing timed out. ${mismatchResult.remaining.length} orders remaining. Switching to pending view...`);
                    
                    // Only switch to pending if we have permission and pending phase is needed
                    if (needsPendingPhase) {
                        // Switch to pending view
                        const switchToPendingSuccess = await ensurePendingView();
                        if (switchToPendingSuccess) {
                            // Process pending orders (with its own 5-minute timeout)
                            console.log('[Supago] Processing pending orders after mismatch timeout...');
                            const pendingResult = await processPendingOrders();
                            
                            // After pending processing, switch back to in-process and continue with remaining mismatches
                            if (pendingResult && pendingResult.timeout) {
                                console.log(`[Supago] ⏱️ Pending processing also timed out. ${pendingResult.remaining.length} pending orders remaining.`);
                            }
                            
                            // Switch back to in-process view to continue with remaining mismatches
                            console.log('[Supago] Switching back to in-process view to continue with remaining mismatches...');
                            const switchBackSuccess = await switchToInProcessView();
                            if (switchBackSuccess && mismatchResult.remaining.length > 0) {
                                console.log(`[Supago] Continuing with ${mismatchResult.remaining.length} remaining mismatch orders...`);
                                // Note: Remaining mismatches will be picked up by pollMismatchOrders in the next cycle
                            }
                        }
                    } else {
                        console.log('[Supago] Cannot switch to pending (handles_pending=false or mode does not include pending). Remaining mismatches will be processed in next cycle.');
                    }
                } else {
                    // Mismatch processing completed successfully (no timeout)
                    // Switch back to pending view so pending polling can continue normally
                    if (needsPendingPhase) {
                        console.log('[Supago] ✅ Mismatch processing completed successfully. Switching back to pending view...');
                        const switchToPendingSuccess = await ensurePendingView();
                        if (switchToPendingSuccess) {
                            console.log('[Supago] ✅ Switched back to pending view. Pending polling can now continue.');
                        } else {
                            console.warn('[Supago] ⚠️ Failed to switch back to pending view after mismatch processing.');
                        }
                    } else {
                        console.log('[Supago] ✅ Mismatch processing completed successfully. Staying on in-process view (pending phase not needed).');
                    }
                }
            } else {
                console.log('[Supago] No orders with status mismatch found. Skipping in-process page navigation.');
            }
        } else {
            if (automationMode === 'in_process') {
                console.log('[Supago] Mode is "in_process" but handles_in_process=false. Skipping.');
            } else {
                console.log('[Supago] Skipping in-process phase (mode does not include in_process).');
            }
        }

        console.log('[Supago] ========== Automation cycle complete ==========');

    } catch (error) {
        console.error('[Supago] Automation error:', error);
    } finally {
        isProcessing = false;
        // Don't schedule page refresh - use separate polling intervals instead
    }
}

/**
 * Poll login config from Autoflow backend (every 3 minutes)
 * This checks if Chrome Extension is allowed to operate for this login
 */
async function pollLoginConfig() {
    if (isProcessing) {
        console.log('[Supago] Already processing, skipping login config poll...');
        return;
    }

    try {
        const settings = await getSettings();
        let panelUsername = null;
        try {
            const encryptedCreds = await getCredentials();
            if (encryptedCreds && encryptedCreds.username) {
                panelUsername = await decryptText(encryptedCreds.username, 'supago-extension-key');
            }
        } catch (err) {
            console.error('[Supago] Error getting panel username for login poll:', err);
            return;
        }

        if (panelUsername) {
            // ✅ CRITICAL: Update logger with current username from login config
            if (window.ceLogger && window.ceLogger.updateUsername) {
                await window.ceLogger.updateUsername(panelUsername);
                console.log(`[Supago] 📝 Logger updated with username: ${panelUsername}`);
            }
            
            try {
                const config = await getLoginConfig(panelUsername, settings.dbApiUrl);
                console.log(`[Supago] 🔄 Login config API response:`, config);
                const loginCfg = config?.login || {};
                const channel = loginCfg.execution_channel || 'autobot';
                const isActive = loginCfg.is_active !== false;
                const handlesPending = !!loginCfg.handles_pending;
                const handlesInProcess = !!loginCfg.handles_in_process;

                console.log(`[Supago] 🔄 Login config poll: channel=${channel}, is_active=${isActive}, handles_pending=${handlesPending}, handles_in_process=${handlesInProcess}`);
                console.log(`[Supago] 🔄 Full login config object:`, JSON.stringify(loginCfg, null, 2));

                // Update settings for this cycle (store execution channel to prevent processing when it's autobot)
                settings.executionChannel = channel;
                settings.isActive = isActive;
                settings.ceCanProcessPending = handlesPending;
                settings.ceCanProcessInProcess = handlesInProcess;
                await saveSettings(settings);
            } catch (err) {
                console.error('[Supago] Error polling login config:', err);
            }
        }
    } catch (error) {
        console.error('[Supago] Login config poll error:', error);
    }
}

/**
 * Poll for orders with status mismatch (every 1 minute, no page refresh)
 */
async function pollMismatchOrders() {
    if (isProcessing) {
        console.log('[Supago] Already processing, skipping mismatch poll...');
        return;
    }

    try {
        // ✅ CRITICAL: Check for error page first
        if (isErrorPage()) {
            console.error('[Supago] ⚠️ Error page detected in pollMismatchOrders. Handling error page...');
            await handleErrorPage();
            return;
        }
        
        const settings = await getSettings();
        
        // ✅ CRITICAL: Check execution_channel - only process if it's 'chrome_extension'
        const executionChannel = settings.executionChannel || 'autobot';
        if (executionChannel !== 'chrome_extension') {
            console.log(`[Supago] Mismatch polling skipped (execution_channel=${executionChannel}, not chrome_extension)`);
            return;
        }
        
        // Check if login is active
        if (settings.isActive === false) {
            console.log('[Supago] Mismatch polling skipped (login is not active)');
            return;
        }
        
        const automationMode = settings.automationMode || 'both';
        const needsInProcessPhase = (automationMode === 'in_process' || automationMode === 'both') && settings.ceCanProcessInProcess;
        const needsPendingPhase = (automationMode === 'pending' || automationMode === 'both') && settings.ceCanProcessPending;

        if (!needsInProcessPhase) {
            console.log('[Supago] Mismatch polling skipped (mode or permission)');
            return;
        }

        console.log('[Supago] 🔄 Polling for orders with status mismatch...');
        const { hasOrders, orders } = await checkForOrdersWithMismatch();

        if (hasOrders && orders.length > 0) {
            console.log(`[Supago] 🔍 Found ${orders.length} order(s) with status mismatch. Processing...`);
            
            // Ensure we're on the withdrawal requests page and in-process view
            if (!isLoggedIn()) {
                console.log('[Supago] Not logged in, skipping mismatch processing');
                return;
            }

            // Navigate to withdrawal requests if needed
            const currentPath = window.location.pathname.toLowerCase();
            if (!currentPath.includes('/withdraw') && !currentPath.includes('/manual')) {
                console.log('[Supago] Navigating to withdrawal requests page for mismatch processing...');
                const navSuccess = await navigateToWithdrawalRequests();
                if (!navSuccess) {
                    console.error('[Supago] Navigation failed for mismatch processing');
                    return;
                }
                // Wait for page to load after navigation
                await sleep(2000);
            }

            // Switch to in-process view using dropdown (required for in-process page)
            console.log('[Supago] Switching to in-process view via dropdown...');
            const switchSuccess = await switchToInProcessView();
            
            if (!switchSuccess) {
                console.error('[Supago] Failed to switch to in-process view, skipping mismatch processing');
                return;
            }
            
            // ✅ CRITICAL: Wait for table to actually load data (not just "No Records Found")
            // Verify that the table has real data rows before processing
            console.log('[Supago] Verifying in-process table has loaded data...');
            let tableHasData = false;
            for (let verifyAttempt = 1; verifyAttempt <= 5; verifyAttempt++) {
                await sleep(1000);
                const rows = document.querySelectorAll('table tbody tr');
                const validRows = Array.from(rows).filter(row => {
                    const cells = row.querySelectorAll('td');
                    return cells.length > 5 && !row.textContent.trim().toLowerCase().includes('no records found');
                });
                
                if (validRows.length > 0) {
                    console.log(`[Supago] ✅ Table has ${validRows.length} valid row(s) after ${verifyAttempt} attempt(s)`);
                    tableHasData = true;
                    break;
                }
                console.log(`[Supago] Table verification attempt ${verifyAttempt}/5: No valid rows found yet, waiting...`);
            }
            
            if (!tableHasData) {
                console.warn('[Supago] ⚠️ Table still shows "No Records Found" after 5 attempts. Processing anyway (rows may load dynamically)...');
            }
            
            // ✅ Track time spent in mismatch phase (reset pending phase timer)
            if (mismatchPhaseStartTime === null) {
                mismatchPhaseStartTime = Date.now();
                console.log('[Supago] ⏱️ Starting mismatch phase timer');
            }
            pendingPhaseStartTime = null; // Reset pending timer when we're in mismatch phase
            
            // Process the mismatch orders with timeout handling (max 5 minutes)
            const result = await processInProcessOrders(orders);
            
            // ✅ After processing (completed or timed out), switch back to pending
            // This ensures we don't stay on in-process page indefinitely
            const timeInMismatchPhase = mismatchPhaseStartTime ? (Date.now() - mismatchPhaseStartTime) : 0;
            const mismatchTimedOut = timeInMismatchPhase >= VIEW_TIMEOUT_MS;
            
            if (result && result.timeout && result.remaining && result.remaining.length > 0) {
                console.log(`[Supago] ⏱️ Mismatch processing timed out (${Math.round(timeInMismatchPhase / 1000)}s). ${result.remaining.length} orders remaining. Switching to pending view...`);
            } else {
                console.log(`[Supago] ✅ Mismatch processing completed successfully (${Math.round(timeInMismatchPhase / 1000)}s). Switching back to pending view...`);
            }
            
            // ✅ CRITICAL: Only switch back to pending if pending phase is needed (ceCanProcessPending=true and mode includes pending)
            // This prevents unnecessary navigation when pending processing is disabled
            if (needsPendingPhase) {
                const switchToPendingSuccess = await ensurePendingView();
                if (switchToPendingSuccess) {
                    // Reset mismatch timer, restart pending timer
                    mismatchPhaseStartTime = null;
                    pendingPhaseStartTime = Date.now();
                    console.log('[Supago] ✅ Switched back to pending view. Pending polling will continue.');
                } else {
                    console.warn('[Supago] ⚠️ Failed to switch back to pending view after mismatch processing.');
                    // Reset timers anyway
                    mismatchPhaseStartTime = null;
                }
            } else {
                console.log('[Supago] ✅ Mismatch processing done. Staying on in-process view (pending phase not needed - ceCanProcessPending=false or mode does not include pending).');
                // Reset mismatch timer (but don't restart pending timer since pending is disabled)
                mismatchPhaseStartTime = null;
            }
        } else {
            console.log('[Supago] No orders with status mismatch found.');
        }
    } catch (error) {
        console.error('[Supago] Mismatch poll error:', error);
    }
}

/**
 * Poll for pending orders (every 2 seconds, just click Load button, no page refresh)
 * Note: For pending page, we just need to navigate to the page and click Load (no dropdown switching needed)
 */
async function pollPendingOrders() {
    if (isProcessing) {
        console.log('[Supago] Already processing, skipping pending poll...');
        return;
    }

    try {
        // ✅ CRITICAL: Check for error page first
        if (isErrorPage()) {
            console.error('[Supago] ⚠️ Error page detected in pollPendingOrders. Handling error page...');
            await handleErrorPage();
            return;
        }
        
        const settings = await getSettings();
        
        // ✅ CRITICAL: Check execution_channel - only process if it's 'chrome_extension'
        const executionChannel = settings.executionChannel || 'autobot';
        if (executionChannel !== 'chrome_extension') {
            console.log(`[Supago] Pending polling skipped (execution_channel=${executionChannel}, not chrome_extension)`);
            return;
        }
        
        // Check if login is active
        if (settings.isActive === false) {
            console.log('[Supago] Pending polling skipped (login is not active)');
            return;
        }
        
        const automationMode = settings.automationMode || 'both';
        const needsPendingPhase = (automationMode === 'pending' || automationMode === 'both') && settings.ceCanProcessPending;

        if (!needsPendingPhase) {
            console.log('[Supago] Pending polling skipped (mode or permission)');
            return;
        }

        // Only process if we're logged in
        if (!isLoggedIn()) {
            console.log('[Supago] Not logged in, skipping pending polling');
            return;
        }

        // ✅ CRITICAL: Check current view FIRST - if on in-process page, skip pending polling entirely
        // This prevents reading in-process orders and creating duplicate transactions
        const currentViewBeforeSwitch = detectCurrentView();
        if (currentViewBeforeSwitch === 'in-process') {
            console.log('[Supago] ⏭️ Skipping pending polling - currently on In Process view (pending polling should never run on in-process page)');
            // Reset pending phase timer since we're not in pending phase
            pendingPhaseStartTime = null;
            return;
        }

        // Navigate to withdrawal requests page if needed (pending is the default view, no dropdown switching needed)
        const currentPath = window.location.pathname.toLowerCase();
        if (!currentPath.includes('/withdraw') && !currentPath.includes('/manual')) {
            console.log('[Supago] Navigating to withdrawal requests page for pending polling...');
            const navSuccess = await navigateToWithdrawalRequests();
            if (!navSuccess) {
                console.error('[Supago] Navigation failed for pending polling');
                return;
            }
            // Wait for page to load after navigation
            await sleep(2000);
        }

        // ✅ CRITICAL: Ensure we're on PENDING view (not In Process) before reading orders
        console.log('[Supago] 🔄 Polling pending orders - ensuring PENDING view...');
        const pendingViewSuccess = await ensurePendingView();
        
        // ✅ CRITICAL: Double-check view after ensurePendingView - if still on in-process, abort
        const viewAfterSwitch = detectCurrentView();
        if (viewAfterSwitch === 'in-process') {
            console.log('[Supago] ⚠️ CRITICAL: Still on In Process view after ensurePendingView - aborting pending polling to prevent duplicates');
            pendingPhaseStartTime = null;
            return;
        }
        
        if (!pendingViewSuccess) {
            console.warn('[Supago] ⚠️ Could not ensure pending view during polling - aborting to prevent reading wrong view');
            pendingPhaseStartTime = null;
            return;
        }

        // ✅ Track time spent in pending phase (reset mismatch phase timer)
        if (pendingPhaseStartTime === null) {
            pendingPhaseStartTime = Date.now();
            console.log('[Supago] ⏱️ Starting pending phase timer');
        }
        mismatchPhaseStartTime = null; // Reset mismatch timer when we're in pending phase
        
        // ✅ Check if we've been in pending phase for >5 minutes
        const timeInPendingPhase = Date.now() - pendingPhaseStartTime;
        const needsInProcessPhase = (automationMode === 'in_process' || automationMode === 'both') && settings.ceCanProcessInProcess;
        
        // ✅ Check for mismatches while on pending page (always check, but process based on time)
        let hasMismatchOrders = false;
        let mismatchOrders = [];
        if (needsInProcessPhase) {
            const mismatchCheck = await checkForOrdersWithMismatch();
            hasMismatchOrders = mismatchCheck.hasOrders;
            mismatchOrders = mismatchCheck.orders || [];
            if (hasMismatchOrders) {
                console.log(`[Supago] 🔍 Found ${mismatchOrders.length} mismatch order(s) while on pending page (time in pending: ${Math.round(timeInPendingPhase / 1000)}s)`);
            }
        }

        // ✅ Ensure orders are loaded before checking if there are any pending rows
        await ensureOrdersLoaded('pending');
        await sleep(500); // Brief wait for table to update
        
        // Check how many pending orders are on the page (quick count without full scraping)
        // Only count valid table rows, don't fully process/extract order data
        let tableRows = document.querySelectorAll('table tbody tr');
        if (!tableRows || tableRows.length === 0) {
            tableRows = document.querySelectorAll('tr');
        }
        // Count rows that have enough cells (likely valid order rows)
        const pendingOrdersCount = Array.from(tableRows).filter(row => {
            const cells = row.querySelectorAll('td');
            return cells.length > 5 && !row.textContent.trim().toLowerCase().includes('no records found');
        }).length;
        console.log(`[Supago] Found ${pendingOrdersCount} pending order(s) on page`);
        
        // ✅ NEW LOGIC 1: If NO pending rows AND mismatches exist → go to in-process and clear mismatches
        if (pendingOrdersCount === 0 && hasMismatchOrders && mismatchOrders.length > 0) {
            console.log(`[Supago] 🔍 No pending rows found, but ${mismatchOrders.length} mismatch order(s) exist - switching to in-process to clear mismatches...`);
            
            // Switch to in-process view
            const switchToInProcessSuccess = await switchToInProcessView();
            if (switchToInProcessSuccess) {
                // Reset pending timer, start mismatch timer
                pendingPhaseStartTime = null;
                mismatchPhaseStartTime = Date.now();
                console.log('[Supago] ⏱️ Starting mismatch phase timer');
                
                // Process mismatch orders (max 5 minutes)
                console.log(`[Supago] Processing ${mismatchOrders.length} mismatch order(s) (max 5 minutes)...`);
                await processInProcessOrders(mismatchOrders);
                
                // After mismatch processing, switch back to pending ONLY if pending phase is needed
                if (needsPendingPhase) {
                    console.log('[Supago] ✅ Mismatch processing done. Switching back to pending view...');
                    const switchBackSuccess = await ensurePendingView();
                    if (switchBackSuccess) {
                        // Reset mismatch timer, restart pending timer
                        mismatchPhaseStartTime = null;
                        pendingPhaseStartTime = Date.now();
                        console.log('[Supago] ✅ Switched back to pending view. Pending polling will continue.');
                    }
                } else {
                    console.log('[Supago] ✅ Mismatch processing done. Staying on in-process view (pending phase not needed - ceCanProcessPending=false or mode does not include pending).');
                    mismatchPhaseStartTime = null;
                }
            }
            return; // Return here - no pending orders to process
        }
        
        // ✅ NEW LOGIC 2: If we've been in pending >5 minutes AND mismatches exist → switch to in-process
        if (timeInPendingPhase >= VIEW_TIMEOUT_MS && hasMismatchOrders && mismatchOrders.length > 0) {
            console.log(`[Supago] ⏱️ Been in pending phase for ${Math.round(timeInPendingPhase / 1000)}s (>5 min) AND mismatches exist - switching to in-process to clear mismatches...`);
            
            // Switch to in-process view
            const switchToInProcessSuccess = await switchToInProcessView();
            if (switchToInProcessSuccess) {
                // Reset pending timer, start mismatch timer
                pendingPhaseStartTime = null;
                mismatchPhaseStartTime = Date.now();
                console.log('[Supago] ⏱️ Starting mismatch phase timer');
                
                // Process mismatch orders (max 5 minutes)
                console.log(`[Supago] Processing ${mismatchOrders.length} mismatch order(s) (max 5 minutes)...`);
                await processInProcessOrders(mismatchOrders);
                
                // After mismatch processing (whether completed or timed out), switch back to pending ONLY if pending phase is needed
                if (needsPendingPhase) {
                    console.log('[Supago] ✅ Mismatch processing done. Switching back to pending view...');
                    const switchBackSuccess = await ensurePendingView();
                    if (switchBackSuccess) {
                        // Reset mismatch timer, restart pending timer
                        mismatchPhaseStartTime = null;
                        pendingPhaseStartTime = Date.now();
                        console.log('[Supago] ✅ Switched back to pending view. Processing pending orders now...');
                        
                        // ✅ CRITICAL: Actually process pending orders after switching back (don't return early!)
                        // Ensure orders are loaded before processing
                        await ensureOrdersLoaded('pending');
                        await sleep(500);
                        
                        // Process pending orders immediately after switching back
                        const pendingResult = await processPendingOrders();
                        
                        // Handle result
                        if (pendingResult && !pendingResult.timeout) {
                            pendingPhaseStartTime = null;
                            console.log('[Supago] ✅ All pending orders processed. Resetting pending phase timer.');
                        }
                    }
                } else {
                    console.log('[Supago] ✅ Mismatch processing done. Staying on in-process view (pending phase not needed - ceCanProcessPending=false or mode does not include pending).');
                    mismatchPhaseStartTime = null;
                }
                
                // Return here - we've processed pending orders after mismatch processing (or skipped if pending not needed)
                return;
            }
        }

        // ✅ Process pending orders (with timeout handling - max 5 minutes per order processing cycle)
        // Note: The timeout check is inside processPendingOrders() for individual order processing
        // But we also check phase-level timeout above to switch to mismatches
        const result = await processPendingOrders();
        
        // If pending processing completed (no timeout), check if we should continue or switch
        if (result && !result.timeout) {
            // All pending orders processed - reset timer
            pendingPhaseStartTime = null;
            console.log('[Supago] ✅ All pending orders processed. Resetting pending phase timer.');
        } else if (result && result.timeout) {
            // Individual order processing timed out (this is handled by the timeout check above)
            console.log(`[Supago] ⏱️ Pending order processing timed out. ${result.remaining?.length || 0} orders remaining.`);
        }
    } catch (error) {
        console.error('[Supago] Pending poll error:', error);
    }
}

/**
 * Schedule next page refresh with human-like variance (every 5 minutes)
 */
function scheduleNextRefresh() {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
    }

    // Add random variance to appear more human-like
    const variance = (Math.random() - 0.5) * 2 * REFRESH_VARIANCE;
    const nextRefresh = PAGE_REFRESH_INTERVAL + variance;

    console.log(`[Supago] Next page refresh in ${Math.round(nextRefresh / 1000)} seconds`);

    refreshTimer = setTimeout(() => {
        console.log('[Supago] Refreshing page...');
        window.location.reload();
    }, nextRefresh);
}

/**
 * Start all polling intervals
 */
function startPolling() {
    // Clear any existing timers
    if (loginPollTimer) clearInterval(loginPollTimer);
    if (mismatchPollTimer) clearInterval(mismatchPollTimer);
    if (pendingPollTimer) clearInterval(pendingPollTimer);

    // Login config polling: every 3 minutes
    console.log(`[Supago] Starting login config polling (every ${LOGIN_POLL_INTERVAL / 1000}s)`);
    pollLoginConfig(); // Run immediately
    loginPollTimer = setInterval(pollLoginConfig, LOGIN_POLL_INTERVAL);

    // Mismatch polling: every 1 minute (no page refresh)
    console.log(`[Supago] Starting mismatch polling (every ${MISMATCH_POLL_INTERVAL / 1000}s, no page refresh)`);
    mismatchPollTimer = setInterval(pollMismatchOrders, MISMATCH_POLL_INTERVAL);

    // Pending polling: every 2 seconds (just click Load, no page refresh)
    console.log(`[Supago] Starting pending polling (every ${PENDING_POLL_INTERVAL / 1000}s, click Load only)`);
    pendingPollTimer = setInterval(pollPendingOrders, PENDING_POLL_INTERVAL);

    // Page refresh: every 5 minutes
    scheduleNextRefresh();
}

/**
 * Initialize content script
 */
async function initialize() {
    console.log('[Supago] Content script initialized');

    // Fallback for sleep if utility script didn't load
    if (typeof sleep === 'undefined') {
        console.warn('[Supago] Sleep utility not found. Defining fallback.');
        window.sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    }

    // Check for critical dependencies
    if (typeof getCredentials === 'undefined' || typeof scrapeAllOrders === 'undefined') {
        console.error('[Supago] CRITICAL: Utility scripts not loaded. Please reload the extension in chrome://extensions');
        // Don't return, try to proceed in case they load late or are available in window
    }

    // Check if chrome.runtime is available (for background script communication)
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        console.error('[Supago] CRITICAL: Chrome runtime not available. Extension may not be loaded properly.');
        console.error('[Supago] Please reload the extension in chrome://extensions');
        return;
    }

    // Check if chrome.storage is available
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        console.warn('[Supago] WARNING: chrome.storage not available. Extension may need to be reloaded in chrome://extensions');
        console.warn('[Supago] Will use default settings, but cannot save configuration.');
    }

    // Wait a bit for page to fully load
    await sleep(2000);

    // Run initial automation cycle (login check, etc.)
    await runAutomation();

    // Then start polling intervals for continuous operation
    startPolling();
}

// Start when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'runNow') {
        runAutomation();
        sendResponse({ success: true });
    } else if (message.action === 'getStatus') {
        sendResponse({ isProcessing });
    }
    return true;
});

/**
 * Helper function to download today's logs
 * Can be called from browser console: downloadTodayLogs()
 */
async function downloadTodayLogs() {
    if (window.ceLogger && window.ceLogger.downloadLogs) {
        await window.ceLogger.downloadLogs();
        console.log('[Supago] ✅ Today\'s logs downloaded successfully');
    } else {
        console.error('[Supago] ❌ Logger not available. Make sure logger.js is loaded.');
    }
}

/**
 * Helper function to download all logs
 * Can be called from browser console: downloadAllLogs()
 */
async function downloadAllLogs() {
    if (window.ceLogger && window.ceLogger.downloadAllLogs) {
        await window.ceLogger.downloadAllLogs();
        console.log('[Supago] ✅ All logs downloaded successfully');
    } else {
        console.error('[Supago] ❌ Logger not available. Make sure logger.js is loaded.');
    }
}

// Make download functions available globally for easy access from console
window.downloadTodayLogs = downloadTodayLogs;
window.downloadAllLogs = downloadAllLogs;

console.log('[Supago] 📝 Logging enabled! Console logs visible in browser DevTools (Chrome storage saving disabled to prevent system getting stuck)');
console.log('[Supago] 💡 To export logs: Use browser DevTools → Console → Right-click → "Save as..."');
