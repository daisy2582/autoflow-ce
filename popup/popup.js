// Popup JavaScript

document.addEventListener('DOMContentLoaded', async () => {
    // Load current settings
    const settings = await getSettings();
    const credentials = await getCredentials();

    // Try to load per-tab mode from URL hash or sessionStorage, fallback to global mode
    let automationMode = settings.automationMode || 'both';
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url && tab.url.includes('dashboard.supago.online')) {
            // Check URL hash first (most reliable, persists across refresh)
            const urlHash = new URL(tab.url).hash;
            const hashMatch = urlHash.match(/[#&]ce_mode=([^&]+)/i);
            if (hashMatch && ['pending', 'in_process', 'both'].includes(hashMatch[1])) {
                automationMode = hashMatch[1];
                console.log(`Loaded mode from URL hash: ${automationMode}`);
            } else {
                // Try to get from sessionStorage via content script
                chrome.tabs.sendMessage(tab.id, { action: 'getMode' }, (response) => {
                    if (!chrome.runtime.lastError && response && response.mode) {
                        automationMode = response.mode;
                        document.getElementById('automationMode').value = automationMode;
                        console.log(`Loaded mode from content script: ${automationMode}`);
                    } else {
                        // Fallback: use global settings
                        document.getElementById('automationMode').value = automationMode;
                    }
                });
            }
        }
    } catch (err) {
        console.error('Error loading per-tab mode:', err);
    }

    // Populate form
    document.getElementById('websiteName').value = settings.websiteName || 'WINFIX';
    // Default to production CE API; user can override to staging or other via UI
    document.getElementById('dbApiUrl').value = settings.dbApiUrl || 'https://autoflow-ce-api.botauto.online';
    document.getElementById('automationMode').value = automationMode;

    // If credentials exist, show placeholder
    if (credentials) {
        document.getElementById('username').placeholder = '••••••••';
        document.getElementById('password').placeholder = '••••••••';
    }

    // Save settings
    document.getElementById('saveSettings').addEventListener('click', async () => {
        const newSettings = {
            websiteName: document.getElementById('websiteName').value,
            dbApiUrl: document.getElementById('dbApiUrl').value,
            automationMode: document.getElementById('automationMode').value,
            autoClickInProcess: true
        };

        await saveSettings(newSettings);
        
        // Save mode for current tab using URL hash (persists across refresh)
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url && tab.url.includes('dashboard.supago.online')) {
                // Update URL hash to persist mode across refresh
                const url = new URL(tab.url);
                url.hash = `ce_mode=${newSettings.automationMode}`;
                
                chrome.tabs.update(tab.id, { url: url.toString() }, () => {
                    if (chrome.runtime.lastError) {
                        console.error('Error updating tab URL:', chrome.runtime.lastError);
                    } else {
                        console.log(`Updated tab URL with mode: ${newSettings.automationMode}`);
                    }
                });
                
                // Also tell content script to update sessionStorage
                chrome.tabs.sendMessage(tab.id, { 
                    action: 'setMode', 
                    mode: newSettings.automationMode 
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn('Could not notify content script (page may need refresh):', chrome.runtime.lastError);
                    } else {
                        console.log('Content script notified of mode change');
                    }
                });
            }
        } catch (err) {
            console.error('Error saving per-tab mode:', err);
        }
        
        showNotification('Settings saved! Mode will persist across refresh.', 'success');
    });

    // Save credentials
    document.getElementById('saveCredentials').addEventListener('click', async () => {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        if (!username || !password) {
            showNotification('Please enter both username and password', 'error');
            return;
        }

        try {
            // Encrypt credentials
            const encryptedUsername = await encryptText(username, 'supago-extension-key');
            const encryptedPassword = await encryptText(password, 'supago-extension-key');

            await saveCredentials({
                username: encryptedUsername,
                password: encryptedPassword
            });

            showNotification('Credentials saved securely!', 'success');

            // Clear input fields
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
            document.getElementById('username').placeholder = '••••••••';
            document.getElementById('password').placeholder = '••••••••';
        } catch (error) {
            showNotification('Error saving credentials: ' + error.message, 'error');
        }
    });

    // Run now button
    document.getElementById('runNow').addEventListener('click', async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab.url.includes('dashboard.supago.online')) {
                showNotification('Please navigate to https://dashboard.supago.online/ first', 'error');
                return;
            }

            chrome.tabs.sendMessage(tab.id, { action: 'runNow' }, (response) => {
                if (chrome.runtime.lastError) {
                    showNotification('Error: ' + chrome.runtime.lastError.message + '. Please refresh the page.', 'error');
                    return;
                }
                if (response && response.success) {
                    showNotification('Automation started!', 'success');
                } else {
                    showNotification('Failed to start automation', 'error');
                }
            });
        } catch (error) {
            showNotification('Error: ' + error.message, 'error');
        }
    });

    // Clear data button
    document.getElementById('clearData').addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear all extension data?')) {
            await clearAllData();
            showNotification('All data cleared!', 'success');

            // Reset form
            document.getElementById('websiteName').value = 'WINFIX';
    // Reset to production CE API by default
    document.getElementById('dbApiUrl').value = 'https://autoflow-ce-api.botauto.online';
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
        }
    });

    // Update status periodically
    setInterval(async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (tab && tab.url.includes('dashboard.supago.online')) {
                chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, (response) => {
                    if (chrome.runtime.lastError) {
                        // Content script not ready or not injected
                        updateStatus('Connecting...', false);
                        return;
                    }
                    if (response) {
                        updateStatus(response.isProcessing ? 'Processing...' : 'Ready', response.isProcessing);
                    }
                });
            } else {
                updateStatus('Not on dashboard', false);
            }
        } catch (error) {
            updateStatus('Idle', false);
        }
    }, 2000);
});

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function updateStatus(text, isActive) {
    const statusText = document.getElementById('statusText');
    const statusDot = document.querySelector('.status-dot');
    const processingStatus = document.getElementById('processingStatus');

    statusText.textContent = text;
    processingStatus.textContent = text;

    if (isActive) {
        statusDot.classList.add('active');
    } else {
        statusDot.classList.remove('active');
    }
}
