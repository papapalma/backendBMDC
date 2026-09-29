-- =============================================================================
-- FIX: Instructors Table - Add Missing Columns
-- =============================================================================
--
-- ISSUE: Instructor management broken
--   Missing 6 critical columns: first_name, last_name, middle_name, specialization, photo_path, status
--
-- ROOT CAUSE: instructors table in Normalize_full_schema.sql was oversimplified
--   Used combined "name" column instead of separate first_name/last_name
--   Missing specialization, photo_path, status columns
--   Missing status CHECK constraint
--
-- SOLUTION: Recreate the table with all required columns from full_schema.sql
--
-- =============================================================================

-- Step 1: Drop the old incomplete table
DROP TABLE IF EXISTS instructors CASCADE;

-- Step 2: Create the corrected instructors table
CREATE TABLE IF NOT EXISTS instructors (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  first_name        VARCHAR(100)  NOT NULL,
  last_name         VARCHAR(100)  NOT NULL,
  middle_name       VARCHAR(100),
  email             VARCHAR(255)  NOT NULL UNIQUE,
  phone             VARCHAR(20),
  specialization    VARCHAR(255),
  bio               TEXT,
  photo_path        VARCHAR(500),
  status            VARCHAR(50)   NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'inactive', 'on_leave')),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Step 3: Create trigger for updated_at
DROP TRIGGER IF EXISTS set_updated_at_instructors ON instructors;
CREATE TRIGGER set_updated_at_instructors
  BEFORE UPDATE ON instructors
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Step 4: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_instructors_tenant ON instructors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_instructors_email ON instructors(email);
CREATE INDEX IF NOT EXISTS idx_instructors_status ON instructors(status);
CREATE INDEX IF NOT EXISTS idx_instructors_name ON instructors(last_name, first_name);

-- Step 5: Verify the fix
-- Run this to confirm all columns exist:
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name = 'instructors' ORDER BY ordinal_position;

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================

-- Check if the fix was successful:
SELECT 
  COUNT(*) as column_count,
  STRING_AGG(column_name, ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns 
WHERE table_name = 'instructors';

-- List all columns with their types:
SELECT 
  ordinal_position,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'instructors'
ORDER BY ordinal_position;

-- =============================================================================
-- SUCCESS INDICATORS
-- =============================================================================
-- ✅ Columns should be (12 total):
--   1. id (uuid)
--   2. tenant_id (uuid)
--   3. first_name (character varying) ← ADDED
--   4. last_name (character varying) ← ADDED
--   5. middle_name (character varying) ← ADDED
--   6. email (character varying)
--   7. phone (character varying)
--   8. specialization (character varying) ← ADDED
--   9. bio (text)
--   10. photo_path (character varying) ← ADDED
--   11. status (character varying) ← ADDED
--   12. created_at (timestamp with time zone)
--   13. updated_at (timestamp with time zone)
--
-- ✅ Constraints should exist:
--   - UNIQUE(email)
--   - status CHECK: ('active', 'inactive', 'on_leave')
--
-- ✅ Indexes should exist:
--   - idx_instructors_tenant
--   - idx_instructors_email
--   - idx_instructors_status
--   - idx_instructors_name
--
-- ✅ Trigger should exist:
--   - set_updated_at_instructors
--
-- =============================================================================
