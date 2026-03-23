/**
 * Logger utility for Chrome Extension
 * NOTE: Chrome storage saving is DISABLED to prevent system getting stuck
 * Logs are still visible in browser console but not persisted to chrome.storage.local
 */

// Storage key prefix for logs
// Chrome storage logging DISABLED - prevents system getting stuck
// Logs are only shown in browser console, not saved to chrome.storage.local
const LOG_STORAGE_PREFIX = 'ce_logs_'; // Not used anymore but kept for compatibility
const MAX_LOGS_PER_DAY = 10000; // Not used anymore
const MAX_DAYS_TO_KEEP = 7; // Not used anymore
const AUTO_SAVE_INTERVAL = 5 * 60 * 1000; // Not used anymore
let autoSaveTimer = null; // Not used anymore
let lastAutoSaveDate = null; // Not used anymore
let currentUsername = null; // Not used anymore

// Get today's date string (YYYY-MM-DD)
function getTodayDateString() {
    const now = new Date();
    return now.toISOString().split('T')[0];
}

/**
 * Get current login username (cached for performance)
 * @returns {Promise<string>} Username or 'unknown' if not available
 * NOTE: Chrome storage access disabled - only returns cached value
 */
async function getCurrentUsername() {
    // Return cached username if available
    if (currentUsername) {
        return currentUsername;
    }
    
    // Chrome storage disabled - try to get from credentials if storage.js is available
    try {
        if (typeof getCredentials !== 'undefined' && typeof decryptText !== 'undefined') {
            try {
                const encryptedCreds = await getCredentials();
                if (encryptedCreds && encryptedCreds.username) {
                    const username = await decryptText(encryptedCreds.username, 'supago-extension-key');
                    if (username) {
                        currentUsername = username;
                        return username;
                    }
                }
            } catch (err) {
                // Silently fail - username not available yet
            }
        }
    } catch (error) {
        // Silently fail
    }
    
    return 'unknown';
}

/**
 * Update cached username (called when login changes)
 * @param {string} username - New username
 * NOTE: Chrome storage saving disabled - only updates cache
 */
async function updateUsername(username) {
    const previousUsername = currentUsername;
    currentUsername = username;
    
    // Chrome storage disabled - only update cache
    if (previousUsername !== username && username !== 'unknown') {
        originalConsole.log(`[Logger] ✅ Username updated to: ${username}`);
        // No storage operations - just log to console
    }
}

// Get current timestamp string (YYYY-MM-DD HH:MM:SS.mmm)
function getTimestamp() {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0];
    const ms = now.getMilliseconds().toString().padStart(3, '0');
    return `${date} ${time}.${ms}`;
}

// Format log entry
function formatLogEntry(level, args) {
    const timestamp = getTimestamp();
    // Convert all arguments to strings
    const message = args.map(arg => {
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg, null, 2);
            } catch (e) {
                return String(arg);
            }
        }
        return String(arg);
    }).join(' ');
    
    return `[${timestamp}] [${level}] ${message}\n`;
}

// Save log - DISABLED: Chrome storage saving disabled to prevent system getting stuck
async function saveLog(level, args) {
    // CHROME STORAGE SAVING DISABLED - Only log to console to prevent system getting stuck
    // Logs are still visible in browser console, but not persisted to chrome.storage.local
    
    // Just format and log to original console (no storage operations)
    const logEntry = formatLogEntry(level, args);
    
    // Log to original console based on level
    switch(level) {
        case 'error':
            originalConsole.error(logEntry.trim());
            break;
        case 'warn':
            originalConsole.warn(logEntry.trim());
            break;
        case 'info':
            originalConsole.info(logEntry.trim());
            break;
        default:
            originalConsole.log(logEntry.trim());
    }
    
    // Chrome storage saving removed - prevents system getting stuck
    // If you need file logging in future, it can be enabled but should be done
    // less frequently (e.g., batch every N logs or use web workers)
}

// Clean up logs older than MAX_DAYS_TO_KEEP days - DISABLED (Chrome storage saving disabled)
async function cleanupOldLogs() {
    // Chrome storage saving disabled - no cleanup needed
    return;
}

// Store original console methods
const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console)
};

// Override console methods
console.log = function(...args) {
    originalConsole.log(...args);
    saveLog('LOG', args);
};

console.warn = function(...args) {
    originalConsole.warn(...args);
    saveLog('WARN', args);
};

console.error = function(...args) {
    originalConsole.error(...args);
    saveLog('ERROR', args);
};

console.info = function(...args) {
    originalConsole.info(...args);
    saveLog('INFO', args);
};

console.debug = function(...args) {
    originalConsole.debug(...args);
    saveLog('DEBUG', args);
};

/**
 * Download logs for a specific date as a file - DISABLED (Chrome storage saving disabled)
 * @param {string} dateString - Date in YYYY-MM-DD format (optional, defaults to today)
 * @param {string} username - Username (optional, defaults to current username)
 */
async function downloadLogs(dateString = null, username = null) {
    originalConsole.warn('[Logger] ⚠️ Log downloading is disabled - Chrome storage saving is disabled to prevent system getting stuck');
    originalConsole.warn('[Logger] Logs are only visible in browser console. Use browser DevTools to export console logs if needed.');
}

/**
 * Manual download fallback (creates a link and clicks it)
 */
function manualDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Clean up URL after a delay
    setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Auto-save logs to file - DISABLED (Chrome storage saving disabled)
 * @param {string} dateString - Date in YYYY-MM-DD format
 */
async function autoSaveToFile(dateString) {
    // Chrome storage saving disabled - no auto-save
    return;
}

/**
 * Start auto-save timer (saves logs to file every 5 minutes)
 */
function startAutoSaveTimer() {
    // Chrome storage saving disabled - no timer needed
    return;
}

/**
 * Download all logs - DISABLED (Chrome storage saving disabled)
 */
async function downloadAllLogs() {
    originalConsole.warn('[Logger] ⚠️ Log downloading is disabled - Chrome storage saving is disabled to prevent system getting stuck');
    originalConsole.warn('[Logger] Logs are only visible in browser console. Use browser DevTools to export console logs if needed.');
}

/**
 * Get logs for a specific date (returns as string)
 * @param {string} dateString - Date in YYYY-MM-DD format (optional, defaults to today)
 * @param {string} username - Username (optional, defaults to current username)
 * @returns {Promise<string>} Log content as string
 */
async function getLogs(dateString = null, username = null) {
    // Chrome storage saving disabled - return empty string
    originalConsole.warn('[Logger] ⚠️ Getting logs is disabled - Chrome storage saving is disabled to prevent system getting stuck');
    return '';
}

/**
 * Clear logs for a specific date - DISABLED (Chrome storage saving disabled)
 * @param {string} dateString - Date in YYYY-MM-DD format (optional, defaults to today)
 * @param {string} username - Username (optional, defaults to current username)
 */
async function clearLogs(dateString = null, username = null) {
    originalConsole.warn('[Logger] ⚠️ Clearing logs is disabled - Chrome storage saving is disabled to prevent system getting stuck');
}

/**
 * Clear all logs - Can be used to clear old logs from Chrome storage
 * This function is still functional to help clean up previously saved logs
 */
async function clearAllLogs() {
    try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            originalConsole.warn('[Logger] ⚠️ Chrome storage not available');
            return;
        }
        
        const allItems = await chrome.storage.local.get(null);
        const logKeys = Object.keys(allItems).filter(key => key.startsWith(LOG_STORAGE_PREFIX));
        
        if (logKeys.length === 0) {
            originalConsole.log('[Logger] ✅ No old logs found in Chrome storage');
            return;
        }
        
        await chrome.storage.local.remove(logKeys);
        originalConsole.log(`[Logger] ✅ Cleared ${logKeys.length} old log file(s) from Chrome storage`);
        originalConsole.log(`[Logger] Removed keys: ${logKeys.join(', ')}`);
    } catch (error) {
        originalConsole.error('[Logger] ❌ Failed to clear old logs:', error);
    }
}

// Export functions for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        downloadLogs,
        downloadAllLogs,
        getLogs,
        clearLogs,
        clearAllLogs,
        getTodayDateString
    };
}

// Make functions available globally
window.ceLogger = {
    downloadLogs,
    downloadAllLogs,
    getLogs,
    clearLogs,
    clearAllLogs,
    getTodayDateString,
    updateUsername,
    getCurrentUsername
};

// Log initialization
originalConsole.log('[Logger] ✅ Logging system initialized (Chrome storage saving DISABLED to prevent system getting stuck)');
originalConsole.log('[Logger] ⚠️ Logs are only visible in browser console - not saved to chrome.storage.local');
originalConsole.log('[Logger] 💡 To export logs: Use browser DevTools → Console → Right-click → "Save as..."');
originalConsole.log('[Logger] 🧹 To clear old logs from Chrome storage: Run window.ceLogger.clearAllLogs() in console');

