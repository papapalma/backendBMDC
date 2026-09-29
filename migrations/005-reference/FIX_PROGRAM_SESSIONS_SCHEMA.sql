-- =============================================================================
-- FIX: Program Sessions Table Schema - Add Missing Columns
-- =============================================================================
--
-- ISSUE: Creating sessions returns error:
--   "Database error: column program_sessions.title does not exist"
--
-- ROOT CAUSE: The program_sessions table in Normalize_full_schema.sql was incomplete
--   Missing columns:
--     - title (VARCHAR(255)) NOT NULL - session name/title
--     - description (TEXT) - session description
--     - session_type (VARCHAR(50)) - lecture, lab, workshop, exam, seminar, field_trip
--     - status (VARCHAR(50)) - scheduled, completed, cancelled, postponed
--   Removed columns (not in full_schema):
--     - topic (replaced by title)
--     - instructor_id (not used in core schema)
--
-- SOLUTION: Recreate the table with all required columns
--
-- =============================================================================

-- Step 1: Drop the old incomplete table
DROP TABLE IF EXISTS program_sessions CASCADE;

-- Step 2: Create the corrected program_sessions table
CREATE TABLE IF NOT EXISTS program_sessions (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID          NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  program_id   UUID          NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  title        VARCHAR(255)  NOT NULL,
  description  TEXT,
  session_date DATE          NOT NULL,
  start_time   TIME          NOT NULL,
  end_time     TIME          NOT NULL,
  location     VARCHAR(255),
  session_type VARCHAR(50)   NOT NULL DEFAULT 'lecture'
                             CHECK (session_type IN ('lecture', 'lab', 'workshop', 'exam', 'seminar', 'field_trip')),
  status       VARCHAR(50)   NOT NULL DEFAULT 'scheduled'
                             CHECK (status IN ('scheduled', 'completed', 'cancelled', 'postponed')),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Step 3: Create trigger for updated_at
DROP TRIGGER IF EXISTS set_updated_at_program_sessions ON program_sessions;
CREATE TRIGGER set_updated_at_program_sessions
  BEFORE UPDATE ON program_sessions
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Step 4: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_program_sessions_tenant_id ON program_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_program_sessions_program_id ON program_sessions(program_id);
CREATE INDEX IF NOT EXISTS idx_program_sessions_date ON program_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_program_sessions_status ON program_sessions(status);

-- Step 5: Recreate the foreign key reference in attendance table
-- (This is deferred because attendance is created before program_sessions)
ALTER TABLE attendance
  ADD CONSTRAINT fk_attendance_session_id
  FOREIGN KEY (session_id) REFERENCES program_sessions(id) ON DELETE CASCADE
  NOT VALID;

-- Step 6: Verify the fix
-- Run this to confirm all columns exist:
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name = 'program_sessions' ORDER BY ordinal_position;

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================

-- Check if the fix was successful:
SELECT 
  COUNT(*) as column_count,
  STRING_AGG(column_name, ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns 
WHERE table_name = 'program_sessions';

-- List all columns with their types:
SELECT 
  ordinal_position,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'program_sessions'
ORDER BY ordinal_position;

-- =============================================================================
-- SUCCESS INDICATORS
-- =============================================================================
-- ✅ Columns should be (in order):
--   1. id (uuid)
--   2. tenant_id (uuid)
--   3. program_id (uuid)
--   4. title (character varying) ← CRITICAL
--   5. description (text)
--   6. session_date (date)
--   7. start_time (time without time zone)
--   8. end_time (time without time zone)
--   9. location (character varying)
--   10. session_type (character varying)
--   11. status (character varying)
--   12. created_at (timestamp with time zone)
--   13. updated_at (timestamp with time zone)
--
-- ✅ Indexes should exist:
--   - idx_program_sessions_tenant_id
--   - idx_program_sessions_program_id
--   - idx_program_sessions_date
--   - idx_program_sessions_status
--
-- ✅ Trigger should exist:
--   - set_updated_at_program_sessions
--
-- =============================================================================
