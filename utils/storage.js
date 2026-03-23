// Chrome Storage utilities

/**
 * Get settings from Chrome storage
 * @returns {Promise<Object>} Settings object
 */
async function getSettings() {
    // Default settings fallback
// NOTE:
// - For production, set dbApiUrl to the production Autoflow-CE API URL.
// - You can still override this per-browser via the extension popup settings.
const defaultSettings = {
    websiteName: 'WINFIX',
    // TODO: replace with your actual production CE API host if different
    dbApiUrl: 'https://autoflow-ce-api.botauto.online',
    autoClickInProcess: true,
    // Mode: 'pending' = only process pending orders, 'in_process' = only process mismatch orders, 'both' = process both
    automationMode: 'both'
};

    // Check if chrome.storage is available
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        console.warn('[Supago] chrome.storage not available, using default settings');
        return defaultSettings;
    }

    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(['settings'], (result) => {
                if (chrome.runtime.lastError) {
                    console.error('[Supago] Storage error:', chrome.runtime.lastError);
                    resolve(defaultSettings);
                } else {
                    resolve(result.settings || defaultSettings);
                }
            });
        } catch (error) {
            console.error('[Supago] Error accessing storage:', error);
            resolve(defaultSettings);
        }
    });
}

/**
 * Save settings to Chrome storage
 * @param {Object} settings - Settings object
 */
async function saveSettings(settings) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        console.warn('[Supago] chrome.storage not available, cannot save settings');
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        try {
            chrome.storage.local.set({ settings }, () => {
                if (chrome.runtime.lastError) {
                    console.error('[Supago] Storage error:', chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        } catch (error) {
            console.error('[Supago] Error saving to storage:', error);
            reject(error);
        }
    });
}

/**
 * Get encrypted credentials from Chrome storage
 * @returns {Promise<Object>} Encrypted credentials object
 */
async function getCredentials() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        console.warn('[Supago] chrome.storage not available, cannot get credentials');
        return null;
    }

    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(['credentials'], (result) => {
                if (chrome.runtime.lastError) {
                    console.error('[Supago] Storage error:', chrome.runtime.lastError);
                    resolve(null);
                } else {
                    resolve(result.credentials || null);
                }
            });
        } catch (error) {
            console.error('[Supago] Error accessing credentials:', error);
            resolve(null);
        }
    });
}

/**
 * Save encrypted credentials to Chrome storage
 * @param {Object} credentials - Encrypted credentials object
 */
async function saveCredentials(credentials) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        console.warn('[Supago] chrome.storage not available, cannot save credentials');
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        try {
            chrome.storage.local.set({ credentials }, () => {
                if (chrome.runtime.lastError) {
                    console.error('[Supago] Storage error:', chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        } catch (error) {
            console.error('[Supago] Error saving credentials:', error);
            reject(error);
        }
    });
}

/**
 * Clear all extension data
 */
async function clearAllData() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        console.warn('[Supago] chrome.storage not available, cannot clear data');
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        try {
            chrome.storage.local.clear(() => {
                if (chrome.runtime.lastError) {
                    console.error('[Supago] Storage error:', chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        } catch (error) {
            console.error('[Supago] Error clearing storage:', error);
            reject(error);
        }
    });
}

// Export functions
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getSettings,
        saveSettings,
        getCredentials,
        saveCredentials,
        clearAllData
    };
}
