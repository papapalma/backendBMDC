-- =============================================================================
-- FIX: Program Instructors Table - Add Missing Constraints
-- =============================================================================
--
-- ISSUE: Data integrity constraints missing
--   Missing DEFAULT value for role column
--   Missing CHECK constraint to validate role values
--   Missing NOT NULL constraint on role
--
-- ROOT CAUSE: program_instructors table in Normalize_full_schema.sql was incomplete
--   role column exists but lacks DEFAULT, NOT NULL, and CHECK constraints
--
-- SOLUTION: Recreate the table with all required constraints from full_schema.sql
--
-- =============================================================================

-- Step 1: Drop the old incomplete table
DROP TABLE IF EXISTS program_instructors CASCADE;

-- Step 2: Create the corrected program_instructors table
CREATE TABLE IF NOT EXISTS program_instructors (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  program_id      UUID          NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  instructor_id   UUID          NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  role            VARCHAR(100)  NOT NULL DEFAULT 'instructor'
                                CHECK (role IN ('instructor', 'assistant', 'guest')),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (program_id, instructor_id),
  CONSTRAINT fk_program_instructors_program FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE,
  CONSTRAINT fk_program_instructors_instructor FOREIGN KEY (instructor_id) REFERENCES instructors(id) ON DELETE CASCADE
);

-- Step 3: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_program_instructors_tenant ON program_instructors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_program_instructors_program ON program_instructors(program_id);
CREATE INDEX IF NOT EXISTS idx_program_instructors_instructor ON program_instructors(instructor_id);
CREATE INDEX IF NOT EXISTS idx_program_instructors_role ON program_instructors(role);

-- Step 4: Verify the fix
-- Run this to confirm all columns exist:
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name = 'program_instructors' ORDER BY ordinal_position;

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================

-- Check if the fix was successful:
SELECT 
  COUNT(*) as column_count,
  STRING_AGG(column_name, ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns 
WHERE table_name = 'program_instructors';

-- List all columns with their types:
SELECT 
  ordinal_position,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'program_instructors'
ORDER BY ordinal_position;

-- =============================================================================
-- SUCCESS INDICATORS
-- =============================================================================
-- ✅ Columns should be (6 total):
--   1. id (uuid)
--   2. tenant_id (uuid)
--   3. program_id (uuid)
--   4. instructor_id (uuid)
--   5. role (character varying)
--   6. created_at (timestamp with time zone)
--
-- ✅ Constraints should exist:
--   - role NOT NULL ← ADDED
--   - role DEFAULT 'instructor' ← ADDED
--   - role CHECK: ('instructor', 'assistant', 'guest') ← ADDED
--   - UNIQUE(program_id, instructor_id)
--   - Foreign keys on program_id and instructor_id
--
-- ✅ Indexes should exist:
--   - idx_program_instructors_tenant
--   - idx_program_instructors_program
--   - idx_program_instructors_instructor
--   - idx_program_instructors_role
--
-- =============================================================================
