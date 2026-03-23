const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

// Load environment variables
// Use .env.example for staging/testing, .env for production
  const envFile = process.env.NODE_ENV === 'staging' || process.env.NODE_ENV === 'test'
    ? '.env.example'
    : '.env';
require('dotenv').config({ path: envFile });

console.log(`📋 Loading environment from: ${envFile} (NODE_ENV: ${process.env.NODE_ENV || 'production'})`);

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection pool
// ⚠️ Important: default to the same database used by the Autoflow (Python) backend
// so that both systems see the same data (supago_bot on the same Postgres instance).
// You can override via env vars (DB_USER, DB_PASSWORD, DB_NAME, DB_HOST, DB_PORT, DB_SSL, DB_SSL_REJECT_UNAUTHORIZED).
let dbConfig = {
  // Default to local supago_bot DB exposed by auto-flow/docker-compose.yml (db:5432 -> localhost:5433)
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'supago_bot',
  password: process.env.DB_PASSWORD || 'postgres',
  port: parseInt(process.env.DB_PORT || '5433', 10),
};

// Configure SSL for managed databases (e.g., AWS RDS)
// - If DB_SSL is explicitly set to 'false', disable SSL.
// - Otherwise, enable SSL and default rejectUnauthorized=false for easier staging/prod setup.
if (process.env.DB_SSL !== 'false') {
  const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true';
  dbConfig = {
    ...dbConfig,
    ssl: { rejectUnauthorized },
  };
}

// If connecting to an RDS/amazonaws host and SSL is not explicitly disabled,
// make sure we at least enable SSL with rejectUnauthorized=false by default.
if (
  dbConfig.host &&
  (dbConfig.host.includes('rds.amazonaws.com') || dbConfig.host.includes('amazonaws.com'))
) {
  if (process.env.DB_SSL === 'false') {
    // Respect explicit disable, but note this may fail if RDS requires SSL.
    console.warn(
      '⚠️ DB_SSL=false while connecting to an RDS/amazonaws host. Ensure pg_hba.conf allows non-SSL or enable SSL.'
    );
  } else if (!dbConfig.ssl) {
    dbConfig = {
      ...dbConfig,
      ssl: { rejectUnauthorized: false },
    };
  }
}

console.log('📡 Database connection config:', {
  ...dbConfig,
  password: '***',
  ssl: dbConfig.ssl ? { rejectUnauthorized: dbConfig.ssl.rejectUnauthorized } : undefined,
});

const pool = new Pool(dbConfig);

// Handle pool errors
pool.on('error', (err) => {
  console.error('❌ Unexpected database pool error:', err.message);
  console.error('   This might happen if the database connection is lost.');
});

// Test database connection on startup
async function testDatabaseConnection() {
  try {
    const result = await pool.query('SELECT NOW() as current_time, version() as pg_version');
    console.log('✅ Database connected successfully!');
    console.log(`   PostgreSQL version: ${result.rows[0].pg_version.split(',')[0]}`);
    console.log(`   Server time: ${result.rows[0].current_time}`);
    
    // Verify the transactions table exists (shared with Autoflow)
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'transactions'
      )
    `);
    
    if (tableCheck.rows[0].exists) {
      console.log('✅ transactions table exists (shared with Autoflow)');
    } else {
      console.log('⚠️  Warning: transactions table does not exist. Ensure supago_bot schema is migrated.');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Database connection failed!');
    console.error(`   Error: ${error.message}`);
    console.error('\n💡 Troubleshooting:');
    console.error(`   1. Ensure PostgreSQL is running: pg_isready -h localhost -p ${dbConfig.port}`);
    console.error('   2. Check your .env file has correct DB credentials:');
    console.error('      DB_USER, DB_PASSWORD, DB_NAME, DB_HOST, DB_PORT');
    console.error('   3. Verify database exists: psql -U postgres -c "\\l"');
    console.error('   4. Create database if needed: createdb supago_bot');
    return false;
  }
}

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files (webhook tester)
app.use(express.static(path.join(__dirname)));

// Serve webhook tester at root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'webhook_tester.html'));
});

// Also serve at /webhook-tester
app.get('/webhook-tester', (req, res) => {
  res.sendFile(path.join(__dirname, 'webhook_tester.html'));
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
});

// GET /api/config - Expose API keys to local extension
app.get('/api/config', (req, res) => {
  // Only allow connection from localhost extensions or local origin
  // Since we use CORS middleware globally for development, this is accessible
  res.json({
    WINFIX: {
      public_key: process.env.GATEWAYHUB_WINFIX_PUBLIC_KEY,
      private_key: process.env.GATEWAYHUB_WINFIX_PRIVATE_KEY
    },
    AUTOEXCHANGE: {
      public_key: process.env.GATEWAYHUB_AUTOEXCHANGE_PUBLIC_KEY,
      private_key: process.env.GATEWAYHUB_AUTOEXCHANGE_PRIVATE_KEY
    }
  });
});

// NOTE: The original implementation used a separate `orders` table in a separate DB.
// We now write directly into the shared `transactions` table in supago_bot so that
// Autobot and Chrome Extension see the same rows.

// Helper: find transaction by supago_withdrawal_hash (order_hash)
async function findTransactionByHash(orderHash) {
  const result = await pool.query(
    'SELECT * FROM transactions WHERE supago_withdrawal_hash = $1',
    [orderHash]
  );
  return result.rows[0] || null;
}

// Helper: find login row by panel username (maps extension panel to Autoflow login)
async function findLoginByUsername(panelUsername) {
  if (!panelUsername) return null;
  const result = await pool.query(
    'SELECT id, login_group_key FROM logins WHERE username = $1',
    [panelUsername]
  );
  return result.rows[0] || null;
}

// GET /api/login/by-panel-username/:username - Expose login config for a given panel username
app.get('/api/login/by-panel-username/:username', async (req, res) => {
  try {
    const row = await findLoginByUsername(req.params.username);
    if (!row) {
      return res.json({ found: false, login: null });
    }
    // Also fetch execution_channel, group key, and per-role flags
    const details = await pool.query(
      'SELECT id, username, is_active, execution_channel, login_group_key, handles_pending, handles_in_process FROM logins WHERE id = $1',
      [row.id]
    );
    const login = details.rows[0] || null;
    return res.json({ found: !!login, login });
  } catch (error) {
    console.error('Error fetching login by panel username:', error);
    res.status(500).json({ found: false, error: error.message });
  }
});

// POST /api/orders - Save a new order into transactions (via supago_withdrawal_hash)
app.post('/api/orders', async (req, res) => {
  const {
    order_hash,
    order_id,
    username,          // end-user username (Supago Username column, e.g. Apg013)
    payment_name,      // Supago Payment Name column (optional; stored in name or status_detail later if needed)
    panel_username,    // panel/login username (e.g. agve11) used to link to Autoflow Login
    acc_holder_name,
    amount,
    bank_name,
    acc_number,
    ifsc,
    order_date,
    status,
    txn_id,
    utr,
    api_status
  } = req.body;

  try {
    // If a transaction with this hash already exists, just return it
    const existing = await findTransactionByHash(order_hash);
    if (existing) {
      return res.status(409).json({ success: false, message: 'Transaction already exists', transactionId: existing.id });
    }

    // Try to link this transaction to an existing Autoflow Login by panel username
    let loginId = null;
    let loginGroupKey = null;
    const loginRow = await findLoginByUsername(panel_username || null);
    if (loginRow) {
      loginId = loginRow.id;
      loginGroupKey = loginRow.login_group_key || null;
    }

    const insertResult = await pool.query(
      `INSERT INTO transactions (
        supago_withdrawal_hash,
        order_id,
        username,
        acc_holder_name,
        amount,
        bank_name,
        acc_number,
        ifsc,
        status,
        gateway_status,
        txn_id,
        utr,
        in_process_executor_channel,
        login_id,
        processing_login_id,
        login_group_key,
        in_process_executor_login_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING id`,
      [
        order_hash,
        order_id,
        username,
        acc_holder_name,
        amount,
        bank_name,
        acc_number,
        ifsc,
        status || 'pending',
        api_status || null,
        txn_id || null,
        utr || null,
        'chrome_extension',
        loginId,
        loginId,
        loginGroupKey,
        loginId
      ]
    );

    res.json({ success: true, transactionId: insertResult.rows[0].id });
  } catch (error) {
    console.error('Error saving transaction from extension:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/orders/with-mismatch - Get transactions with status mismatch (status != gateway_status)
// Matches Autoflow's mismatch detection logic:
// - status is NOT 'success' or 'failed' (still pending/in_process)
// - gateway_status exists and is 'success' or 'failed' (webhook received)
// - final_action is NULL (not yet processed)
// Optional query param: login_group_key - filter by login_group_key (e.g., 'gagve11' filters for all orders in that group)
app.get('/api/orders/with-mismatch', async (req, res) => {
  try {
    const loginGroupKey = req.query.login_group_key ? req.query.login_group_key.trim() : null;
    
    let query = `
      SELECT t.*, t.supago_withdrawal_hash AS order_hash 
      FROM transactions t
      WHERE t.status NOT IN ('success', 'failed')
        AND t.gateway_status IS NOT NULL
        AND t.gateway_status IN ('success', 'failed')
        AND (t.final_action IS NULL OR t.final_action = '')
    `;
    
    const params = [];
    
    // If login_group_key provided, filter by login_group_key (use column directly on transactions table)
    if (loginGroupKey) {
      query += ` AND t.login_group_key = $1`;
      params.push(loginGroupKey);
    }
    
    query += ` ORDER BY t.created_at DESC`;
    
    const result = await pool.query(query, params);

    res.json({ orders: result.rows, count: result.rows.length });
  } catch (error) {
    console.error('Error fetching transactions with mismatch:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/orders/:order_id - Get transaction by order_id
app.get('/api/orders/:order_id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT *, supago_withdrawal_hash AS order_hash FROM transactions WHERE order_id = $1',
      [req.params.order_id]
    );

    if (result.rows.length > 0) {
      res.json({ order: result.rows[0] });
    } else {
      res.status(404).json({ error: 'Order not found' });
    }
  } catch (error) {
    console.error('Error fetching transaction:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/orders/exists/:order_hash - Check if transaction exists by hash
app.get('/api/orders/exists/:order_hash', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT *, supago_withdrawal_hash AS order_hash FROM transactions WHERE supago_withdrawal_hash = $1',
      [req.params.order_hash]
    );

    if (result.rows.length > 0) {
      res.json({ exists: true, order: result.rows[0] });
    } else {
      res.json({ exists: false, order: null });
    }
  } catch (error) {
    console.error('Error checking transaction:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/orders/hash/:order_hash/status - Update transaction status (e.g., to 'in_process' after clicking In Process button)
// This does NOT set gateway_status - that's only set by webhooks
app.put('/api/orders/hash/:order_hash/status', async (req, res) => {
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ success: false, error: 'status is required' });
  }

  try {
    const result = await pool.query(
      `UPDATE transactions
       SET status = $1,
           -- If this endpoint is being called, we know the extension has clicked \"In Process\"
           -- To avoid Postgres type inference issues with $1, we don't branch on $1 here.
           processed_at = COALESCE(processed_at, NOW()),
           in_process_executor_channel = COALESCE(in_process_executor_channel, 'chrome_extension')
       WHERE supago_withdrawal_hash = $2
       RETURNING id, order_id, status`,
      [status, req.params.order_hash]
    );

    if (result.rows.length > 0) {
      res.json({ success: true, transaction: result.rows[0] });
    } else {
      res.status(404).json({ success: false, error: 'Transaction not found' });
    }
  } catch (error) {
    console.error('Error updating transaction status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/orders/:order_id/status - Update final action on transactions
app.put('/api/orders/:order_id/status', async (req, res) => {
  const { finalAction, statusDetail } = req.body;

  try {
    // Map finalAction -> terminal status, same as Autoflow
    let mappedStatus = null;
    let defaultStatusDetail = null;
    if (finalAction === 'approved') {
      mappedStatus = 'success';
      defaultStatusDetail = 'Webhook success processed automatically via Chrome Extension (Supago Accept button)';
    } else if (finalAction === 'rejected') {
      mappedStatus = 'failed';
      defaultStatusDetail = 'Webhook failure confirmed automatically via Chrome Extension (Supago Reject button)';
    }

    // Use provided statusDetail if given, otherwise use default
    // Always set status_detail when final_action is set (overwrite old values)
    const finalStatusDetail = statusDetail || defaultStatusDetail;

    const result = await pool.query(
      `UPDATE transactions
       SET final_action = $1,
           -- Keep status aligned with gateway outcome: approved -> success, rejected -> failed
           status = COALESCE($3, status),
           -- Always update status_detail when final_action is set (even if already exists)
           status_detail = $4,
           final_action_at = NOW(),
           final_action_executor_channel = 'chrome_extension'
       WHERE order_id = $2
       RETURNING id`,
      [finalAction, req.params.order_id, mappedStatus, finalStatusDetail]
    );

    if (result.rows.length > 0) {
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, error: 'Order not found' });
    }
  } catch (error) {
    console.error('Error updating transaction final action:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/orders/hash/:order_hash/callback - Update gateway_status/txn_id/utr from GatewayHub webhook
// ⚠️ IMPORTANT: This endpoint is ONLY called by GatewayHub webhooks, NOT by the extension after API calls
// The extension updates status to 'in_process' via /api/orders/hash/:order_hash/status endpoint
app.put('/api/orders/hash/:order_hash/callback', async (req, res) => {
  const { api_status, txn_id, utr } = req.body;

  if (!api_status || !['success', 'failed'].includes(api_status)) {
    return res.status(400).json({ success: false, error: 'api_status must be "success" or "failed"' });
  }

  try {
    // ⚠️ IMPORTANT: Only update gateway_status, txn_id, utr from webhook
    // Do NOT update status here - that's already set to 'in_process' when extension clicked the button
    // gateway_status is ONLY set by webhooks, not by extension API calls
    const query = `UPDATE transactions
                   SET gateway_status = $1,
                       txn_id = COALESCE($2, txn_id),
                       utr = COALESCE($3, utr)
                   WHERE supago_withdrawal_hash = $4
                   RETURNING id, order_id, gateway_status, status`;
    const params = [api_status, txn_id || null, utr || null, req.params.order_hash];

    const result = await pool.query(query, params);

    if (result.rows.length > 0) {
      const txResult = await pool.query(
        'SELECT *, supago_withdrawal_hash AS order_hash FROM transactions WHERE supago_withdrawal_hash = $1',
        [req.params.order_hash]
      );

      const updatedTx = txResult.rows[0];
      console.log(`✅ Webhook received for transaction ${updatedTx.order_id}: gateway_status = ${api_status}, utr = ${utr || 'N/A'}, current status = ${updatedTx.status}`);
      res.json({ success: true, order: updatedTx });
    } else {
      res.status(404).json({ success: false, error: 'Transaction not found' });
    }
  } catch (error) {
    console.error('Error updating transaction callback status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/orders/status/:status - Get transactions by status
app.get('/api/orders/status/:status', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT *, supago_withdrawal_hash AS order_hash FROM transactions WHERE status = $1 ORDER BY created_at DESC',
      [req.params.status]
    );

    res.json({ orders: result.rows });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/orders - Get all transactions created by Chrome Extension (UUID format order_id)
// Aliases supago_withdrawal_hash as order_hash for backward compatibility
// Filters to only show transactions with UUID-format order_id (CE format) vs timestamp format (autobot)
app.get('/api/orders', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '100', 10);
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (8-4-4-4-12 hex digits)
    // Chrome Extension uses UUID format, autobot uses timestamp format
    // Use ~* for case-insensitive regex match
    // Chrome Extension order_id format:
    //   base: UUID v4
    //   CE:   UUID_v4_loginTag (e.g. 123e4567-e89b-12d3-a456-426614174000_apg012)
    const result = await pool.query(
      `SELECT *, supago_withdrawal_hash AS order_hash 
       FROM transactions 
       WHERE order_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_[a-z0-9_]+)?$'
       ORDER BY created_at DESC 
       LIMIT $1`,
      [limit]
    );

    res.json({ orders: result.rows, count: result.rows.length });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Supago Backend API running on http://localhost:${PORT}`);
  console.log(`📊 Database: ${process.env.DB_NAME || 'supago_bot'}`);
  console.log(`🔍 Health check: http://localhost:${PORT}/health`);
  console.log('');
  
  // Test database connection
  const dbConnected = await testDatabaseConnection();
  if (!dbConnected) {
    console.log('\n⚠️  Server started but database is not connected. API endpoints may fail.');
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await pool.end();
  process.exit(0);
});
