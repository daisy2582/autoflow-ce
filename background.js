// Background service worker
// Handles extension lifecycle and message passing

console.log('[Supago Background] Service worker initialized');

// Auto-open Supago in smallest possible window
const SUPAGO_URL = 'https://dashboard.supago.online/';
const MIN_WIN_WIDTH = 100;
const MIN_WIN_HEIGHT = 100;

async function openSupagoMiniWindow() {
    const existingTabs = await chrome.tabs.query({ url: 'https://dashboard.supago.online/*' });
    if (existingTabs.length > 0) {
        await chrome.windows.update(existingTabs[0].windowId, {
            width: MIN_WIN_WIDTH,
            height: MIN_WIN_HEIGHT
        });
        console.log('[Supago Background] Resized existing Supago window to minimum');
        return;
    }

    const newWindow = await chrome.windows.create({
        url: SUPAGO_URL,
        type: 'normal',
        width: MIN_WIN_WIDTH,
        height: MIN_WIN_HEIGHT
    });
    console.log('[Supago Background] Opened mini Supago window:', newWindow.id);
}

// On install/update: set defaults + open mini window
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        console.log('[Supago Background] Extension installed');
        chrome.storage.local.set({
            settings: {
                websiteName: 'WINFIX',
                dbApiUrl: 'https://autoflow-ce-api.botauto.online',
                autoClickInProcess: true
            }
        });
    } else if (details.reason === 'update') {
        console.log('[Supago Background] Extension updated');
    }
    await openSupagoMiniWindow();
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Supago Background] Message received:', message);

    // Handle ping to check if background script is alive
    if (message.action === 'ping') {
        sendResponse({ success: true, message: 'Background script is ready' });
        return true;
    }

    if (message.action === 'log') {
        console.log('[Supago Log]', message.data);
        sendResponse({ success: true });
        return true;
    } else if (message.action === 'proxyRequest') {
        // Handle fetch requests from background to bypass CORS
        (async () => {
            try {
                const { url, options } = message.data;
                const timeout = options.timeout || 60000; // Default 60 seconds
                
                console.log('[Supago Background] Making proxy request to:', url);
                console.log('[Supago Background] Request options:', {
                    method: options.method,
                    headers: { ...options.headers, 'payload-hash': options.headers['payload-hash']?.substring(0, 16) + '...' },
                    bodyLength: options.body?.length || 0,
                    timeout: timeout
                });

                // Create AbortController for timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);

                try {
                    // Remove timeout from options (not a valid fetch option)
                    const { timeout: _, ...fetchOptions } = options;
                    const response = await fetch(url, {
                        ...fetchOptions,
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);
                    
                    console.log('[Supago Background] Response status:', response.status, response.statusText);
                    
                    // Read response text first (needed for both JSON and error cases)
                    const responseText = await response.text();
                    
                    // Try to parse as JSON, but handle non-JSON responses
                    let data;
                    const contentType = response.headers.get('content-type');
                    
                    if (contentType && contentType.includes('application/json')) {
                        try {
                            data = JSON.parse(responseText);
                        } catch (e) {
                            data = { message: responseText, raw: true };
                        }
                    } else {
                        console.warn('[Supago Background] Non-JSON response received:', responseText.substring(0, 200));
                        // Try to parse as JSON anyway (might be JSON without proper content-type)
                        try {
                            data = JSON.parse(responseText);
                        } catch (e) {
                            // If it's not JSON, return the text
                            data = { message: responseText, raw: true };
                        }
                    }
                    
                    // Always return status code, even for errors
                    console.log('[Supago Background] Response data:', data);
                    sendResponse({ 
                        success: response.ok, 
                        data: data,
                        statusCode: response.status,
                        statusText: response.statusText
                    });
                } catch (fetchError) {
                    clearTimeout(timeoutId);
                    
                    // Check if it's a timeout
                    if (fetchError.name === 'AbortError') {
                        console.error('[Supago Background] Request timeout after', timeout, 'ms');
                        sendResponse({ 
                            success: false, 
                            error: `Request timeout after ${timeout}ms`,
                            statusCode: 0,
                            timeout: true
                        });
                        return;
                    }
                    
                    // Re-throw other errors to be caught by outer catch
                    throw fetchError;
                }
            } catch (error) {
                console.error('[Supago Background] Proxy request failed:', error);
                console.error('[Supago Background] Error stack:', error.stack);
                sendResponse({ 
                    success: false, 
                    error: error.message, 
                    stack: error.stack,
                    statusCode: 0
                });
            }
        })();
        return true; // Keep channel open for async response
    }

    return true;
});

// On browser start: auto-open mini Supago window
chrome.runtime.onStartup.addListener(async () => {
    console.log('[Supago Background] Browser started');
    await openSupagoMiniWindow();
});
