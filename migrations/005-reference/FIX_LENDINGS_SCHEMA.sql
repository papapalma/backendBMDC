-- =============================================================================
-- FIX: Lendings Table Schema - Add Missing Columns and Status
-- =============================================================================
--
-- ISSUE: GET /api/lendings/overdue returns 400 with error:
--   "Database error: column lendings.status does not exist"
--
-- ROOT CAUSE: The lendings table in Normalize_full_schema.sql was incomplete
--   Missing columns:
--     - status (VARCHAR(50)) - tracks 'active', 'returned', 'overdue', 'lost'
--     - lent_by (UUID) - user who issued the lending
--     - returned_by (UUID) - user who received the return
--     - actual_return_date should be TIMESTAMPTZ not DATE
--     - quantity column name inconsistency
--
-- SOLUTION: Recreate the table with all required columns
--
-- =============================================================================

-- Step 1: Drop the old incomplete table
DROP TABLE IF EXISTS lendings CASCADE;

-- Step 2: Create the corrected lendings table
CREATE TABLE IF NOT EXISTS lendings (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID          NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  item_id              UUID          NOT NULL REFERENCES items(id)     ON DELETE CASCADE,
  trainee_id           UUID          REFERENCES trainees(id) ON DELETE SET NULL,
  borrower_name        VARCHAR(255),
  borrower_contact     VARCHAR(50),
  quantity             INTEGER       NOT NULL,
  lent_date            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  expected_return_date DATE          NOT NULL,
  actual_return_date   TIMESTAMPTZ,
  status               VARCHAR(50)   NOT NULL DEFAULT 'active'
                                     CHECK (status IN ('active', 'returned', 'overdue', 'lost')),
  notes                TEXT,
  lent_by              UUID          REFERENCES users(id) ON DELETE SET NULL,
  returned_by          UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Step 3: Create trigger for updated_at
DROP TRIGGER IF EXISTS set_updated_at_lendings ON lendings;
CREATE TRIGGER set_updated_at_lendings
  BEFORE UPDATE ON lendings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Step 4: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_lendings_tenant_id ON lendings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lendings_item_id ON lendings(item_id);
CREATE INDEX IF NOT EXISTS idx_lendings_trainee_id ON lendings(trainee_id);
CREATE INDEX IF NOT EXISTS idx_lendings_status ON lendings(status);
CREATE INDEX IF NOT EXISTS idx_lendings_lent_date ON lendings(lent_date);
CREATE INDEX IF NOT EXISTS idx_lendings_expected_return ON lendings(expected_return_date);

-- Step 5: Verify the fix
-- Run this to confirm all columns exist:
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name = 'lendings' ORDER BY ordinal_position;

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================

-- Check if the fix was successful:
SELECT 
  COUNT(*) as column_count,
  STRING_AGG(column_name, ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns 
WHERE table_name = 'lendings';

-- List all columns with their types:
SELECT 
  ordinal_position,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'lendings'
ORDER BY ordinal_position;

-- =============================================================================
-- SUCCESS INDICATORS
-- =============================================================================
-- ✅ Columns should be (in order):
--   1. id (uuid)
--   2. tenant_id (uuid)
--   3. item_id (uuid)
--   4. trainee_id (uuid)
--   5. borrower_name (character varying)
--   6. borrower_contact (character varying)
--   7. quantity (integer)
--   8. lent_date (timestamp with time zone)
--   9. expected_return_date (date)
--   10. actual_return_date (timestamp with time zone)
--   11. status (character varying) <- THIS IS THE CRITICAL ONE
--   12. notes (text)
--   13. lent_by (uuid)
--   14. returned_by (uuid)
--   15. created_at (timestamp with time zone)
--   16. updated_at (timestamp with time zone)
--
-- ✅ Indexes should exist:
--   - idx_lendings_tenant_id
--   - idx_lendings_item_id
--   - idx_lendings_trainee_id
--   - idx_lendings_status
--   - idx_lendings_lent_date
--   - idx_lendings_expected_return
--
-- ✅ Trigger should exist:
--   - set_updated_at_lendings
--
-- =============================================================================
