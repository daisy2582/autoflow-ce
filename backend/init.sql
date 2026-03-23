-- Supago Orders Database Schema
-- This schema stores withdrawal orders with hash-based duplicate prevention

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_hash VARCHAR(64) UNIQUE NOT NULL,  -- SHA-256 hash for duplicate detection
  order_id VARCHAR(255),                    -- Order ID from dashboard (may not be unique)
  username VARCHAR(255),
  acc_holder_name VARCHAR(255),
  amount INTEGER,
  bank_name VARCHAR(255),
  acc_number VARCHAR(255),
  ifsc VARCHAR(50),
  order_date VARCHAR(100),                  -- Date from dashboard
  status VARCHAR(50) DEFAULT 'pending',     -- 'pending', 'in-process', 'approved', 'rejected', 'failed'
  scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  txn_id VARCHAR(255),
  utr VARCHAR(255),
  api_status VARCHAR(50),                   -- 'success' or 'failed'
  processed_at TIMESTAMP,
  final_action VARCHAR(50),                 -- 'approved' or 'rejected'
  final_action_at TIMESTAMP
);

-- Indexes for performance
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_hash ON orders(order_hash);
CREATE INDEX IF NOT EXISTS idx_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_id ON orders(order_id);
CREATE INDEX IF NOT EXISTS idx_scraped_at ON orders(scraped_at DESC);

-- Insert a test record (optional)
-- This will be commented out in production
-- INSERT INTO orders (order_hash, order_id, username, amount, status) 
-- VALUES ('test_hash_123', 'TEST001', 'test_user', 1000, 'pending')
-- ON CONFLICT (order_hash) DO NOTHING;
