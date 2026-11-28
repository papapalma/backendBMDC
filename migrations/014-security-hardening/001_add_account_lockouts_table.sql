-- Migration: Add account_lockouts table for brute force prevention
-- Task 16: Attempt Spam Prevention & Lockout
-- Purpose: Track failed login attempts and lock accounts temporarily

CREATE TABLE IF NOT EXISTS account_lockouts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  failed_attempts INT DEFAULT 0,
  locked_until TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for efficient lookups by locked_until for cleanup
CREATE INDEX IF NOT EXISTS idx_account_lockouts_locked_until 
ON account_lockouts(locked_until);

-- Update trigger to maintain updated_at timestamp
CREATE OR REPLACE FUNCTION update_account_lockouts_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER account_lockouts_updated_at_trigger
BEFORE UPDATE ON account_lockouts
FOR EACH ROW
EXECUTE FUNCTION update_account_lockouts_timestamp();
