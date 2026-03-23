// Crypto utilities for encryption and hashing

/**
 * Generate UUID v4
 * @returns {string} UUID v4 string
 */
function generateUUIDv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Generate SHA-256 hash from order data for duplicate detection
 * IMPORTANT: Must include transaction_date (from Transaction Date column) to match Autoflow behavior
 * @param {Object} orderData - Order data containing amount, transaction_date, username, acc_number, ifsc
 * @returns {Promise<string>} - Hex string of SHA-256 hash
 */
async function generateOrderHash(orderData) {
    // Include transaction_date in hash (REQUIRED for duplicate detection, matches Autoflow)
    // Format: amount|transaction_date|username|acc_number|ifsc
    // If transaction_date is missing, fall back to date field, but log a warning
    const txDate = orderData.transaction_date || orderData.date || '';
    if (!orderData.transaction_date && orderData.date) {
        console.warn('[Crypto] ⚠️ transaction_date missing, using date field as fallback');
    }
    const hashInput = `${orderData.amount}|${txDate}|${orderData.username}|${orderData.acc_number}|${orderData.ifsc}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(hashInput);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

/**
 * Generate HMAC-SHA256 hash for API payload authentication
 * @param {string|Object} payloadOrJson - Payload JSON string (preferred) or payload object
 * @param {string} privateKey - Private key for HMAC
 * @returns {Promise<string>} - Hex string of HMAC hash
 */
/**
 * Generate HMAC-SHA256 hash for API payload authentication
 * Matches reference implementation: data.split(" ").join("") + Base64 output
 * @param {string|Object} payloadOrJson - Payload JSON string (preferred) or payload object
 * @param {string} privateKey - Private key for HMAC
 * @returns {Promise<string>} - Base64 string of HMAC hash
 */
async function generatePayloadHash(payloadOrJson, privateKey) {
    // 1. Prepare Payload: Ensure it's a string
    const payloadString = typeof payloadOrJson === 'string'
        ? payloadOrJson
        : JSON.stringify(payloadOrJson);

    // 2. Normalize: Remove ALL whitespace (spaces, tabs, newlines) as per Python reference
    // Python reference: data_str = "".join(str(json_dumps).split())
    // .split() without args splits on any whitespace and removes empty strings
    const normalizedPayload = payloadString.split(/\s+/).join("");

    console.log('[Crypto] Normalized Payload (Stripped Spaces):', normalizedPayload);
    console.log('[Crypto] Private Key Length:', privateKey.length);

    const encoder = new TextEncoder();

    // 3. Import Key (same as before)
    const keyData = encoder.encode(privateKey);
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    // 4. Sign the NORMALIZED payload
    const payloadBytes = encoder.encode(normalizedPayload);
    const signature = await crypto.subtle.sign(
        'HMAC',
        cryptoKey,
        payloadBytes
    );

    // 5. Convert to Base64 (as per user reference)
    // approach: Uint8Array -> String.fromCharCode -> btoa
    const signatureBytes = new Uint8Array(signature);
    let binaryString = '';
    for (let i = 0; i < signatureBytes.length; i++) {
        binaryString += String.fromCharCode(signatureBytes[i]);
    }
    const signatureBase64 = btoa(binaryString);

    console.log('[Crypto] Generated Hash (Base64):', signatureBase64);

    return signatureBase64;
}

/**
 * Encrypt credentials using AES-GCM
 * @param {string} text - Text to encrypt
 * @param {string} password - Password for encryption
 * @returns {Promise<Object>} - Object with encrypted data and IV
 */
async function encryptText(text, password) {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Derive key from password
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );

    // Encrypt
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encoder.encode(text)
    );

    return {
        encrypted: Array.from(new Uint8Array(encrypted)),
        iv: Array.from(iv),
        salt: Array.from(salt)
    };
}

/**
 * Decrypt credentials using AES-GCM
 * @param {Object} encryptedData - Object with encrypted data, IV, and salt
 * @param {string} password - Password for decryption
 * @returns {Promise<string>} - Decrypted text
 */
async function decryptText(encryptedData, password) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Derive key from password
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: new Uint8Array(encryptedData.salt),
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(encryptedData.iv) },
        key,
        new Uint8Array(encryptedData.encrypted)
    );

    return decoder.decode(decrypted);
}

// Export functions
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        generateUUIDv4,
        generateOrderHash,
        generatePayloadHash,
        encryptText,
        decryptText
    };
}
