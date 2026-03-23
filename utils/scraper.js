// Order scraping utilities

/**
 * Extract order data from a table row element
 * This function needs to be customized based on the actual HTML structure of the Supago dashboard
 * @param {HTMLElement} rowElement - Table row element
 * @returns {Object} Extracted order data
 */
/**
 * Extract bank details from structured HTML cell
 * Looks for labels with field names and extracts values from adjacent labels
 */
function extractBankDetailsFromCell(cell) {
    const details = {
        bank_name: '',
        acc_number: '',
        acc_holder_name: '',
        ifsc: ''
    };

    if (!cell) return details;

    // Find all label elements in the cell
    const labels = cell.querySelectorAll('label');
    
    // Create a map of label text to values
    for (let i = 0; i < labels.length - 1; i++) {
        const labelText = labels[i].textContent.trim();
        const valueLabel = labels[i + 1];
        const value = valueLabel ? valueLabel.textContent.trim() : '';

        // Match field names and extract values
        if (labelText.includes('BANK NAME')) {
            details.bank_name = value;
        } else if (labelText.includes('ACCOUNT NUMBER') || labelText.includes('AC NUMBER')) {
            details.acc_number = value;
        } else if (labelText.includes('HOLDER NAME')) {
            // Backend logic: looks for 'HOLDER NAME' anywhere in the label text
            details.acc_holder_name = value;
        } else if (labelText.includes('IFSC CODE')) {
            details.ifsc = value;
        }
    }

    return details;
}

function extractOrderFromRow(rowElement) {
    // NOTE: These selectors need to be adjusted based on actual dashboard HTML structure
    // This is a template that should be customized after inspecting the actual page

    try {
        const cells = rowElement.querySelectorAll('td');

        // Log cell contents for debugging
        if (cells.length > 0) {
            console.log('[Scraper] Table row cells:', Array.from(cells).map((cell, idx) => ({
                index: idx,
                text: cell.textContent.trim().substring(0, 100)
            })));
        }

        // Extract all cell texts
        const cellTexts = Array.from(cells).map(cell => cell.textContent.trim());

        // Find amount - look for span with just a number, or search all cells
        let amount = '0';
        let amountValue = 0;
        
        // Strategy 1: Look for cell with span containing just a number (most reliable)
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            const span = cell.querySelector('span');
            
            if (span) {
                const spanText = span.textContent.trim();
                // Check if span contains only digits (possibly with commas)
                const cleanSpan = spanText.replace(/[,\s]/g, '');
                if (/^\d+$/.test(cleanSpan)) {
                    const num = parseInt(cleanSpan);
                    // Amount should be reasonable (at least 100)
                    if (num >= 100 && num > amountValue) {
                        amountValue = num;
                        amount = cleanSpan;
                        console.log(`[Scraper] Found amount in cell ${i} (span): ${amount}`);
                        break; // Found in span, use this
                    }
                }
            }
        }
        
        // Strategy 2: If not found in span, search all cells for number patterns
        if (amount === '0' || amountValue === 0) {
            for (let i = 0; i < cellTexts.length; i++) {
                const cellText = cellTexts[i];
                // Look for patterns like "₹1000", "1000", "1,000", etc.
                const amountMatches = cellText.match(/(?:₹|Rs\.?|INR)?\s*([\d,]+)/g);
                if (amountMatches) {
                    for (const match of amountMatches) {
                        const numStr = match.replace(/[₹Rs.,\s]/gi, '');
                        const num = parseInt(numStr);
                        // Amount should be reasonable (at least 100)
                        if (num >= 100 && num > amountValue) {
                            amountValue = num;
                            amount = numStr;
                            console.log(`[Scraper] Found amount in cell ${i}: ${amount} (from "${match}")`);
                        }
                    }
                }
            }
        }

        // Try to find order_id - usually first cell or contains "ORDER" or is a number
        let order_id = '';
        if (cells[0]) {
            order_id = cells[0].textContent.trim();
        }

        // Extract username from the "Username" column.
        // In the current Supago table the columns are:
        // 0: Sr No, 1: Account Data, 2: Agent Name, 3: Payment Type, 4: Payment Name, 5: Username, ...
        // We want the Username cell (e.g. Apg013), NOT Agent Name (agve11) or Payment Type (IMPS).
        let username = '';
        if (cells.length > 5 && cells[5]) {
            username = cells[5].textContent.trim();
            console.log(`[Scraper] Extracted username from Username column (cell[5]): "${username}"`);
        }
        
        // Fallback: Try to find username in early cells if cell[4] didn't work
        if (!username || username.length === 0) {
            console.warn('[Scraper] Username column empty, trying fallback search...');
            for (let i = 0; i < Math.min(5, cellTexts.length); i++) {
                const text = cellTexts[i];
                // Username might be alphanumeric, not too long
                if (text && text.length > 2 && text.length < 30 && /^[a-zA-Z0-9_]+$/.test(text)) {
                    // Skip if it looks like an order ID or amount
                    if (!/^\d+$/.test(text) && !text.includes('ORDER') && text !== order_id) {
                        username = text;
                        console.log(`[Scraper] Fallback: Found username in cell[${i}]: "${username}"`);
                        break;
                    }
                }
            }
        }

        // Extract transaction_date from Transaction Date column (cell[10])
        // Column order: 0: Sr No, 1: Account Data, 2: Agent Name, 3: Payment Type, 4: Payment Name, 
        // 5: Username, 6: Currency, 7: Amount, 8: Converted Amount, 9: Crypto Rate, 10: Transaction Date
        let transaction_date = '';
        if (cells.length > 10 && cells[10]) {
            transaction_date = cells[10].textContent.trim();
            console.log(`[Scraper] Extracted transaction_date from Transaction Date column (cell[10]): "${transaction_date}"`);
        }
        
        // Fallback: Try to find date - look for date patterns in all cells
        let date = transaction_date || '';
        if (!date) {
            for (const text of cellTexts) {
                // Look for date patterns: YYYY-MM-DD, DD/MM/YYYY, etc.
                const dateMatch = text.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/);
                if (dateMatch) {
                    date = dateMatch[0];
                    break;
                }
            }
        }

        // Find the cell containing bank details (structured HTML with labels)
        let bankDetails = {
            bank_name: '',
            acc_number: '',
            acc_holder_name: '',
            ifsc: ''
        };

        // Look for cell with structured bank details (has labels with "BANK NAME", "AC NUMBER", etc.)
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            const cellText = cellTexts[i];
            
            // Check if this cell contains bank details structure
            if (cellText.includes('BANK NAME') || cellText.includes('ACCOUNT NUMBER') || cellText.includes('AC NUMBER') || cellText.includes('AC HOLDER') || cellText.includes('IFSC CODE')) {
                // Extract from structured HTML
                bankDetails = extractBankDetailsFromCell(cell);
                console.log('[Scraper] Found structured bank details in cell', i, ':', bankDetails);
                break;
            }
        }

        // Fallback: If not found in structured format, try parsing from text
        // This handles cases where all bank details are concatenated on one line (like backend does)
        // Try text parsing if any field is missing (not just when both bank_name and acc_number are missing)
        if (!bankDetails.bank_name || !bankDetails.acc_number || !bankDetails.acc_holder_name || !bankDetails.ifsc) {
            for (const text of cellTexts) {
                if (text.includes('BANK NAME') || text.includes('ACCOUNT NUMBER') || text.includes('AC NUMBER') || text.includes('AC HOLDER') || text.includes('IFSC CODE')) {
                    // Try regex parsing - handle both "AC NUMBER" and "ACCOUNT NUMBER"
                    // Also handle cases where text is concatenated without newlines
                    
                    // Backend logic: Find field name, then split by ':' and take the value
                    // Only extract fields that weren't already found in structured HTML
                    
                    // Bank Name: Backend looks for 'BANK NAME' in line, then splits by ':'
                    if (!bankDetails.bank_name) {
                        const bankNameIdx = text.toUpperCase().indexOf('BANK NAME');
                        if (bankNameIdx !== -1) {
                            const afterBankName = text.substring(bankNameIdx);
                            const colonIdx = afterBankName.indexOf(':');
                            if (colonIdx !== -1) {
                                const valuePart = afterBankName.substring(colonIdx + 1);
                                // Extract value until next field (ACCOUNT NUMBER, AC NUMBER, or HOLDER NAME)
                                const nextFieldMatch = valuePart.match(/^(.*?)(?=ACCOUNT\s*NUMBER|AC\s*NUMBER|HOLDER\s*NAME|IFSC|$)/i);
                                if (nextFieldMatch) {
                                    bankDetails.bank_name = nextFieldMatch[1].trim();
                                }
                            }
                        }
                    }
                    
                    // Account Number: Backend checks 'NUMBER' in line AND 'BANK' NOT in line, then splits by ':'
                    if (!bankDetails.acc_number) {
                        const accNumIdx = text.toUpperCase().search(/(?:ACCOUNT\s*NUMBER|AC\s*NUMBER)/i);
                        if (accNumIdx !== -1) {
                            const afterAccNum = text.substring(accNumIdx);
                            const colonIdx = afterAccNum.indexOf(':');
                            if (colonIdx !== -1) {
                                const valuePart = afterAccNum.substring(colonIdx + 1);
                                // Extract digits only (account numbers are numeric)
                                const numMatch = valuePart.match(/^(\d+)/);
                                if (numMatch) {
                                    bankDetails.acc_number = numMatch[1].trim();
                                }
                            }
                        }
                    }
                    
                    // Account Holder Name: Backend looks for 'HOLDER NAME' anywhere, then splits by ':'
                    if (!bankDetails.acc_holder_name) {
                        const holderIdx = text.toUpperCase().indexOf('HOLDER NAME');
                        if (holderIdx !== -1) {
                            const afterHolder = text.substring(holderIdx);
                            const colonIdx = afterHolder.indexOf(':');
                            if (colonIdx !== -1) {
                                const valuePart = afterHolder.substring(colonIdx + 1);
                                // Extract value until IFSC or end (non-greedy match)
                                const valueMatch = valuePart.match(/^(.*?)(?=IFSC|$)/i);
                                if (valueMatch) {
                                    bankDetails.acc_holder_name = valueMatch[1].trim();
                                }
                            }
                        }
                    }
                    
                    // IFSC Code: Backend looks for 'IFSC' then splits by ':'
                    if (!bankDetails.ifsc) {
                        const ifscIdx = text.toUpperCase().indexOf('IFSC');
                        if (ifscIdx !== -1) {
                            const afterIfsc = text.substring(ifscIdx);
                            const colonIdx = afterIfsc.indexOf(':');
                            if (colonIdx !== -1) {
                                const valuePart = afterIfsc.substring(colonIdx + 1);
                                // IFSC codes are alphanumeric, extract alphanumeric characters
                                const ifscMatch = valuePart.match(/^([A-Z0-9]+)/);
                                if (ifscMatch) {
                                    bankDetails.ifsc = ifscMatch[1].trim();
                                }
                            }
                        }
                    }
                    
                    if (bankDetails.bank_name || bankDetails.acc_number) {
                        console.log('[Scraper] Found bank details via text parsing:', bankDetails);
                        break;
                    }
                }
            }
        }

        // Build order data object
        const orderData = {
            order_id: order_id || '',
            date: date || cellTexts[1] || '',
            // Transaction Date from Transaction Date column (cell[10]) - REQUIRED for hash and duplicate detection
            transaction_date: transaction_date || '',
            // Username column (actual end-user like Apg013)
            username: username || '',
            // Payment Name column text (cell[4] in current table)
            payment_name: cells.length > 4 ? cells[4].textContent.trim() : '',
            acc_holder_name: bankDetails.acc_holder_name || '',
            amount: amount,
            bank_name: bankDetails.bank_name || '',
            acc_number: bankDetails.acc_number || '',
            ifsc: bankDetails.ifsc || ''
        };

        // Log extracted data for debugging
        console.log('[Scraper] Extracted order data:', orderData);

        // Validate extracted data - but don't return null, return the data anyway
        // The caller will validate and decide whether to use it
        const missingFields = [];
        if (!orderData.amount || orderData.amount === '0') missingFields.push('amount');
        if (!orderData.acc_number) missingFields.push('acc_number');
        if (!orderData.ifsc) missingFields.push('ifsc');
        
        if (missingFields.length > 0) {
            console.warn('[Scraper] ⚠️ Missing fields:', missingFields);
            console.warn('[Scraper] Raw cell texts:', cellTexts.map((t, i) => `Cell ${i}: ${t.substring(0, 80)}`));
        }

        return orderData;
    } catch (error) {
        console.error('Error extracting order from row:', error);
        return null;
    }
}

/**
 * Check if a row contains actual order data (not empty state)
 * @param {HTMLElement} row - Table row element
 * @returns {boolean} True if row contains valid order data
 */
function isValidOrderRow(row) {
    const rowText = row.textContent.trim();
    const cells = row.querySelectorAll('td');
    
    // Row should have multiple cells (at least 3)
    if (cells.length < 3) {
        console.log('[Scraper] Row rejected: too few cells', cells.length);
        return false;
    }
    
    // Row should contain some actual data (not just empty)
    if (rowText.length < 10) {
        console.log('[Scraper] Row rejected: text too short', rowText.length);
        return false;
    }
    
    // Check if row contains actual order data indicators
    // Even if it has "No Records Found", if it also has order data, it's valid
    const hasOrderDataIndicators = 
        rowText.includes('BANK NAME') ||
        rowText.includes('AC NUMBER') ||
        rowText.includes('ACCOUNT NUMBER') ||
        rowText.includes('IFSC CODE') ||
        rowText.includes('IFSC') ||
        // Check for account number pattern (at least 8 digits)
        /\d{8,}/.test(rowText) ||
        // Check for amount pattern (numbers with currency or large numbers)
        /[₹$]?\s*\d{3,}/.test(rowText);
    
    // If row has order data indicators, it's valid (even if it also says "No Records Found")
    if (hasOrderDataIndicators) {
        console.log('[Scraper] Row has order data indicators - treating as valid');
        return true;
    }
    
    // If row ONLY contains empty state messages (no order data), reject it
    const emptyStatePatterns = [
        'no records found',
        'no data',
        'no orders',
        'empty',
        'no results',
        'no items'
    ];
    
    const lowerText = rowText.toLowerCase();
    let hasOnlyEmptyState = false;
    
    for (const pattern of emptyStatePatterns) {
        if (lowerText.includes(pattern)) {
            // Check if this is the ONLY content (or very little other content)
            // If row has "No Records Found" but also has substantial other content, it might be valid
            const patternIndex = lowerText.indexOf(pattern);
            const beforePattern = lowerText.substring(0, patternIndex).trim();
            const afterPattern = lowerText.substring(patternIndex + pattern.length).trim();
            
            // If there's significant content before or after the pattern, it's not just an empty state
            if (beforePattern.length < 5 && afterPattern.length < 5) {
                hasOnlyEmptyState = true;
                break;
            }
        }
    }
    
    if (hasOnlyEmptyState) {
        console.log('[Scraper] Row rejected: only contains empty state message');
        return false;
    }
    
    // Default: if we can't determine, assume it's valid and let extraction decide
    console.log('[Scraper] Row validation: defaulting to valid (will be validated during extraction)');
    return true;
}

/**
 * Scrape all orders from the current page
 * @returns {Array} Array of order objects
 */
function scrapeAllOrders() {
    // Try multiple patterns to support both classic <table> and div-based grids
    let tableRows = document.querySelectorAll('table tbody tr');

    if (!tableRows || tableRows.length === 0) {
        // Fallback 1: any <tr> on the page
        tableRows = document.querySelectorAll('tr');
    }

    if (!tableRows || tableRows.length === 0) {
        // Fallback 2: generic row-like elements (common in modern UI libraries)
        tableRows = document.querySelectorAll(
            'div[role="row"], [class*="table-row"], [class*="ant-table-row"], [class*="row"]'
        );
    }

    console.log(`[Scraper] Found ${tableRows.length} potential table rows on page`);
    
    const orders = [];
    let skippedCount = 0;
    let invalidCount = 0;
    let incompleteCount = 0;

    tableRows.forEach((row, index) => {
        const rowText = row.textContent.trim();
        console.log(`[Scraper] Processing row ${index + 1}/${tableRows.length}:`, rowText.substring(0, 100));
        
        // Skip invalid/empty rows
        if (!isValidOrderRow(row)) {
            invalidCount++;
            console.log(`[Scraper] ❌ Row ${index + 1} is invalid/empty. Text:`, rowText.substring(0, 100));
            return;
        }
        
        const orderData = extractOrderFromRow(row);
        console.log(`[Scraper] Row ${index + 1} extracted data:`, {
            order_id: orderData?.order_id,
            has_acc_number: !!orderData?.acc_number,
            has_amount: !!orderData?.amount,
            amount_value: orderData?.amount
        });
        
        if (!orderData) {
            skippedCount++;
            console.warn(`[Scraper] ⚠️ Row ${index + 1}: extractOrderFromRow returned null`);
            return;
        }
        
        if (!orderData.order_id || orderData.order_id === 'No Records Found') {
            skippedCount++;
            console.warn(`[Scraper] ⚠️ Row ${index + 1}: Invalid order_id:`, orderData.order_id);
            return;
        }
        
        // Additional validation: order should have required fields
        if (!orderData.acc_number) {
            incompleteCount++;
            console.warn(`[Scraper] ⚠️ Row ${index + 1}: Missing acc_number. Order data:`, orderData);
            return;
        }
        
        if (!orderData.amount || orderData.amount === '0') {
            incompleteCount++;
            console.warn(`[Scraper] ⚠️ Row ${index + 1}: Invalid amount: "${orderData.amount}". Order data:`, orderData);
            return;
        }
        
        // Order is valid, add it
        orders.push(orderData);
        console.log(`[Scraper] ✅ Row ${index + 1} added to orders list`);
    });

    console.log(`[Scraper] Summary: ${orders.length} valid orders, ${invalidCount} invalid rows, ${incompleteCount} incomplete orders, ${skippedCount} skipped`);
    return orders;
}

/**
 * Find the "in-process" button for a specific order
 * @param {Object} orderData - Order data to match (from the same row we extracted)
 * @returns {HTMLElement|null} Button element or null
 */
function findInProcessButton(orderData) {
    // Find the table row containing this order's data
    // Match by account number (most reliable unique identifier)
    let tableRows = document.querySelectorAll('table tbody tr');
    if (!tableRows || tableRows.length === 0) {
        tableRows = document.querySelectorAll('tr, div[role="row"], [class*="table-row"], [class*="ant-table-row"], [class*="row"]');
    }
    
    let targetRow = null;
    
    // Find the row that contains this order's data
    // Use account number as primary match (most unique)
    for (const row of tableRows) {
        // Skip invalid rows
        if (!isValidOrderRow(row)) {
            continue;
        }
        
        const rowText = row.textContent;
        
        // Primary match: account number (most reliable)
        if (orderData.acc_number && rowText.includes(orderData.acc_number)) {
            targetRow = row;
            console.log('[Scraper] Found order row by account number:', orderData.acc_number);
            break;
        }
    }
    
    // Fallback: match by combination of amount and bank name
    if (!targetRow && orderData.amount && orderData.bank_name) {
        for (const row of tableRows) {
            if (!isValidOrderRow(row)) continue;
            
            const rowText = row.textContent;
            if (rowText.includes(orderData.amount) && rowText.includes(orderData.bank_name)) {
                targetRow = row;
                console.log('[Scraper] Found order row by amount + bank:', orderData.amount, orderData.bank_name);
                break;
            }
        }
    }
    
    if (!targetRow) {
        console.warn('[Scraper] Could not find row for order:', {
            acc_number: orderData.acc_number,
            amount: orderData.amount,
            bank_name: orderData.bank_name
        });
        return null;
    }
    
    // Look for "In Process" button in this row
    // Match the specific button structure: button with text "In Process"
    const buttons = targetRow.querySelectorAll('button');
    
    console.log(`[Scraper] Found ${buttons.length} buttons in row, searching for "In Process"...`);
    
    for (const button of buttons) {
        const buttonText = button.textContent.trim();
        // Match exact text "In Process" (case insensitive)
        if (buttonText.toLowerCase() === 'in process' || 
            buttonText.toLowerCase() === 'in-process' ||
            buttonText.toLowerCase().includes('in process')) {
            console.log('[Scraper] ✅ Found "In Process" button:', buttonText);
            return button;
        }
    }
    
    // Log all button texts for debugging
    const buttonTexts = Array.from(buttons).map(btn => btn.textContent.trim());
    console.warn('[Scraper] "In Process" button not found. Available buttons:', buttonTexts);
    return null;
}

/**
 * Find approve button for an order
 * @param {Object} orderData - Order data to match (must include acc_number, amount, username, bank_name)
 * @returns {HTMLElement|null} Button element or null
 */
function findApproveButton(orderData) {
    // Find the table row containing this order's data
    let tableRows = document.querySelectorAll('table tbody tr');
    if (!tableRows || tableRows.length === 0) {
        tableRows = document.querySelectorAll('tr, div[role="row"], [class*="table-row"], [class*="ant-table-row"], [class*="row"]');
    }
    
    let targetRow = null;
    
    // ✅ CRITICAL: Must match ALL THREE: account number AND amount AND username
    // This prevents matching wrong orders when multiple orders share the same account number
    for (const row of tableRows) {
        if (!isValidOrderRow(row)) {
            continue;
        }
        
        const rowText = row.textContent || '';
        
        // ✅ ALL THREE must match: account number AND amount AND username
        let matchesAccNumber = false;
        let matchesAmount = false;
        let matchesUsername = false;
        
        // Check account number (required)
        if (orderData.acc_number && rowText.includes(orderData.acc_number)) {
            matchesAccNumber = true;
        }
        
        // Check amount (required - must match exactly to prevent wrong order)
        if (orderData.amount) {
            // Try to match amount - be strict about it
            const amountStr = String(orderData.amount).trim();
            // Match amount with currency symbol or without, but must be exact
            if (rowText.includes(amountStr) || 
                rowText.includes(`₹${amountStr}`) || 
                rowText.includes(`₹ ${amountStr}`) ||
                rowText.includes(amountStr.replace('.0', '')) || // Handle "1100" vs "1100.0"
                rowText.includes(amountStr.replace('.0', '') + '.0')) {
                matchesAmount = true;
            }
        }
        
        // Check username (required - critical for matching correct order)
        if (orderData.username && rowText.includes(orderData.username)) {
            matchesUsername = true;
        }
        
        // ✅ ALL THREE must match
        if (matchesAccNumber && matchesAmount && matchesUsername) {
            targetRow = row;
            console.log('[Scraper] ✅ Found order row for approve - ALL THREE match:', {
                acc_number: orderData.acc_number,
                amount: orderData.amount,
                username: orderData.username
            });
            break;
        }
    }
    
    if (!targetRow) {
        console.warn('[Scraper] ❌ Could not find row for approve - no row matches ALL THREE criteria:', {
            acc_number: orderData.acc_number,
            amount: orderData.amount,
            username: orderData.username,
            bank_name: orderData.bank_name
        });
        return null;
    }
    
    // Look for approve/accept button in this row
    const buttons = targetRow.querySelectorAll('button');
    
    for (const button of buttons) {
        const buttonText = button.textContent.trim().toLowerCase();
        // Match approve/accept buttons
        if (buttonText.includes('approve') || 
            buttonText.includes('accept') ||
            buttonText === 'approve' ||
            buttonText === 'accept') {
            console.log('[Scraper] ✅ Found approve/accept button:', buttonText);
            return button;
        }
    }
    
    // Log all button texts for debugging
    const buttonTexts = Array.from(buttons).map(btn => btn.textContent.trim());
    console.warn('[Scraper] Approve/accept button not found. Available buttons:', buttonTexts);
    return null;
}

/**
 * Find reject button for an order
 * @param {Object} orderData - Order data to match (must include acc_number, amount, username, bank_name)
 * @returns {HTMLElement|null} Button element or null
 */
function findRejectButton(orderData) {
    // Find the table row containing this order's data
    let tableRows = document.querySelectorAll('table tbody tr');
    if (!tableRows || tableRows.length === 0) {
        tableRows = document.querySelectorAll('tr, div[role="row"], [class*="table-row"], [class*="ant-table-row"], [class*="row"]');
    }
    
    let targetRow = null;
    
    // ✅ CRITICAL: Must match ALL THREE: account number AND amount AND username
    // This prevents matching wrong orders when multiple orders share the same account number
    for (const row of tableRows) {
        if (!isValidOrderRow(row)) {
            continue;
        }
        
        const rowText = row.textContent || '';
        
        // ✅ ALL THREE must match: account number AND amount AND username
        let matchesAccNumber = false;
        let matchesAmount = false;
        let matchesUsername = false;
        
        // Check account number (required)
        if (orderData.acc_number && rowText.includes(orderData.acc_number)) {
            matchesAccNumber = true;
        }
        
        // Check amount (required - must match exactly to prevent wrong order)
        if (orderData.amount) {
            // Try to match amount - be strict about it
            const amountStr = String(orderData.amount).trim();
            // Match amount with currency symbol or without, but must be exact
            if (rowText.includes(amountStr) || 
                rowText.includes(`₹${amountStr}`) || 
                rowText.includes(`₹ ${amountStr}`) ||
                rowText.includes(amountStr.replace('.0', '')) || // Handle "1100" vs "1100.0"
                rowText.includes(amountStr.replace('.0', '') + '.0')) {
                matchesAmount = true;
            }
        }
        
        // Check username (required - critical for matching correct order)
        if (orderData.username && rowText.includes(orderData.username)) {
            matchesUsername = true;
        }
        
        // ✅ ALL THREE must match
        if (matchesAccNumber && matchesAmount && matchesUsername) {
            targetRow = row;
            console.log('[Scraper] ✅ Found order row for reject - ALL THREE match:', {
                acc_number: orderData.acc_number,
                amount: orderData.amount,
                username: orderData.username
            });
            break;
        }
    }
    
    if (!targetRow) {
        console.warn('[Scraper] ❌ Could not find row for reject - no row matches ALL THREE criteria:', {
            acc_number: orderData.acc_number,
            amount: orderData.amount,
            username: orderData.username,
            bank_name: orderData.bank_name
        });
        return null;
    }
    
    // Look for reject button in this row
    const buttons = targetRow.querySelectorAll('button');
    
    for (const button of buttons) {
        const buttonText = button.textContent.trim().toLowerCase();
        // Match reject buttons
        if (buttonText.includes('reject') || 
            buttonText === 'reject') {
            console.log('[Scraper] ✅ Found reject button:', buttonText);
            return button;
        }
    }
    
    // Log all button texts for debugging
    const buttonTexts = Array.from(buttons).map(btn => btn.textContent.trim());
    console.warn('[Scraper] Reject button not found. Available buttons:', buttonTexts);
    return null;
}

/**
 * Wait for element to appear
 * @param {string} selector - CSS selector
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<HTMLElement>} Element when found
 */
function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const element = document.querySelector(selector);
        if (element) {
            resolve(element);
            return;
        }

        const observer = new MutationObserver(() => {
            const element = document.querySelector(selector);
            if (element) {
                observer.disconnect();
                resolve(element);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Element ${selector} not found within ${timeout}ms`));
        }, timeout);
    });
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Export functions
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        extractOrderFromRow,
        scrapeAllOrders,
        findInProcessButton,
        findApproveButton,
        findRejectButton,
        waitForElement,
        sleep
    };
}
