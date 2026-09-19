-- =============================================================================
-- FIX: Refresh Tokens Schema - Add Missing Columns
-- =============================================================================
-- 
-- ISSUE: authRecoveryService.issueRefreshToken() tries to INSERT:
--   - created_ip (INET)
--   - created_user_agent (TEXT)
--   - expires_at (TIMESTAMPTZ)
--   - token_hash (TEXT)
--   - rotated_from (UUID)
--
-- But refresh_tokens table only had:
--   - id, user_id, token, expires_at, created_at
--
-- SOLUTION: Recreate table with all required columns
--
-- ERROR BEFORE: 
--   "Could not find the 'created_ip' column of 'refresh_tokens' in the schema cache"
--
-- =============================================================================

-- Step 1: Drop the old table (will cascade to any dependent tables)
DROP TABLE IF EXISTS refresh_tokens CASCADE;

-- Step 2: Create the corrected refresh_tokens table
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash          TEXT          NOT NULL UNIQUE,
  expires_at          TIMESTAMPTZ   NOT NULL,
  revoked_at          TIMESTAMPTZ,
  last_used_at        TIMESTAMPTZ,
  rotated_from        UUID          REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  created_ip          INET,
  created_user_agent  TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Step 3: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user      ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash      ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires   ON refresh_tokens(expires_at);

-- Step 4: Verify the fix
-- Run this to confirm columns exist:
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name = 'refresh_tokens' ORDER BY ordinal_position;

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================

-- Check if the fix was successful:
SELECT 
  COUNT(*) as column_count,
  STRING_AGG(column_name, ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns 
WHERE table_name = 'refresh_tokens';

-- List all columns with their types:
SELECT 
  ordinal_position,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'refresh_tokens'
ORDER BY ordinal_position;

-- =============================================================================
-- SUCCESS INDICATORS
-- =============================================================================
-- ✅ Columns should be (in order):
--   1. id (uuid)
--   2. user_id (uuid)
--   3. token_hash (text)
--   4. expires_at (timestamp with time zone)
--   5. revoked_at (timestamp with time zone)
--   6. last_used_at (timestamp with time zone)
--   7. rotated_from (uuid)
--   8. created_ip (inet)
--   9. created_user_agent (text)
--   10. created_at (timestamp with time zone)
--
-- ✅ Indexes should exist:
--   - idx_refresh_tokens_user
--   - idx_refresh_tokens_hash
--   - idx_refresh_tokens_expires
--
-- =============================================================================
