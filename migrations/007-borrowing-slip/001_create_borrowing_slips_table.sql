-- ============================================================================
-- CREATE BORROWING SLIPS TABLE
-- ============================================================================
-- Purpose: Store physical or digital borrowing slips for item lending
-- A borrowing slip records who borrowed what, when, and when it's due back
-- This facilitates better item tracking and provides a physical receipt

-- Step 1: Create the borrowing_slips table
CREATE TABLE IF NOT EXISTS borrowing_slips (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lending_id           UUID          NOT NULL REFERENCES lendings(id) ON DELETE CASCADE,
  item_id              UUID          NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  borrower_name        VARCHAR(255)  NOT NULL,
  item_name            VARCHAR(255)  NOT NULL,
  borrowing_date       DATE          NOT NULL DEFAULT CURRENT_DATE,
  due_date             DATE          NOT NULL,
  quantity             INTEGER       NOT NULL DEFAULT 1,
  item_description     TEXT,
  borrower_contact     VARCHAR(50),
  notes                TEXT,
  slip_number          VARCHAR(50)   UNIQUE,
  status               VARCHAR(50)   NOT NULL DEFAULT 'active'
                                     CHECK (status IN ('active', 'returned', 'overdue')),
  generated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  returned_at          TIMESTAMPTZ,
  created_by           UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Step 2: Create trigger for updated_at
DROP TRIGGER IF EXISTS set_updated_at_borrowing_slips ON borrowing_slips;
CREATE TRIGGER set_updated_at_borrowing_slips
  BEFORE UPDATE ON borrowing_slips
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Step 3: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_borrowing_slips_tenant_id ON borrowing_slips(tenant_id);
CREATE INDEX IF NOT EXISTS idx_borrowing_slips_lending_id ON borrowing_slips(lending_id);
CREATE INDEX IF NOT EXISTS idx_borrowing_slips_item_id ON borrowing_slips(item_id);
CREATE INDEX IF NOT EXISTS idx_borrowing_slips_status ON borrowing_slips(status);
CREATE INDEX IF NOT EXISTS idx_borrowing_slips_borrowing_date ON borrowing_slips(borrowing_date);
CREATE INDEX IF NOT EXISTS idx_borrowing_slips_due_date ON borrowing_slips(due_date);
CREATE INDEX IF NOT EXISTS idx_borrowing_slips_slip_number ON borrowing_slips(slip_number);

-- Step 4: Verify the table structure
SELECT 
  COUNT(*) as column_count,
  STRING_AGG(column_name, ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns 
WHERE table_name = 'borrowing_slips';

-- ============================================================================
-- SUCCESS INDICATORS
-- ============================================================================
-- ✅ Columns should include:
--   id, tenant_id, lending_id, item_id, borrower_name, item_name, borrowing_date,
--   due_date, quantity, item_description, borrower_contact, notes, slip_number,
--   status, generated_at, returned_at, created_by, created_at, updated_at
--
-- ✅ Indexes created:
--   - idx_borrowing_slips_tenant_id
--   - idx_borrowing_slips_lending_id
--   - idx_borrowing_slips_item_id
--   - idx_borrowing_slips_status
--   - idx_borrowing_slips_borrowing_date
--   - idx_borrowing_slips_due_date
--   - idx_borrowing_slips_slip_number
