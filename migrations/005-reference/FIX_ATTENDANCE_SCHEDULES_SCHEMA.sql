-- =============================================================================
-- FIX: Attendance Schedules Table - CREATE MISSING TABLE
-- =============================================================================
--
-- ISSUE: Attendance module completely blocked
--   Cannot create attendance sessions without schedule definitions
--
-- ROOT CAUSE: attendance_schedules table NOT CREATED in Normalize_full_schema.sql
--   This is a CRITICAL table required for the entire attendance system to work
--
-- SOLUTION: Create the missing table with all required columns from full_schema.sql
--
-- =============================================================================

-- Step 1: Create the attendance_schedules table
CREATE TABLE IF NOT EXISTS attendance_schedules (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  program_id              UUID          NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  name                    VARCHAR(255)  NOT NULL,
  effective_date_start    DATE          NOT NULL,
  effective_date_end      DATE,
  morning_open            TIME          NOT NULL,
  morning_close           TIME          NOT NULL,
  morning_late_threshold  INTEGER       DEFAULT 15,
  afternoon_open          TIME          NOT NULL,
  afternoon_close         TIME          NOT NULL,
  afternoon_late_threshold INTEGER      DEFAULT 15,
  status                  VARCHAR(50)   NOT NULL DEFAULT 'active'
                                        CHECK (status IN ('active', 'inactive', 'archived')),
  created_by              UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT check_morning_times CHECK (morning_close > morning_open),
  CONSTRAINT check_afternoon_times CHECK (afternoon_close > afternoon_open),
  CONSTRAINT check_date_range CHECK (effective_date_end IS NULL OR effective_date_end >= effective_date_start),
  UNIQUE (program_id, effective_date_start, effective_date_end)
);

-- Step 2: Create trigger for updated_at
DROP TRIGGER IF EXISTS set_updated_at_attendance_schedules ON attendance_schedules;
CREATE TRIGGER set_updated_at_attendance_schedules
  BEFORE UPDATE ON attendance_schedules
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Step 3: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_attendance_schedules_tenant ON attendance_schedules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_attendance_schedules_program ON attendance_schedules(program_id);
CREATE INDEX IF NOT EXISTS idx_attendance_schedules_status ON attendance_schedules(status);
CREATE INDEX IF NOT EXISTS idx_attendance_schedules_effective_dates ON attendance_schedules(effective_date_start, effective_date_end);

-- Step 4: Verify the fix
-- Run this to confirm all columns exist:
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name = 'attendance_schedules' ORDER BY ordinal_position;

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================

-- Check if the fix was successful:
SELECT 
  COUNT(*) as column_count,
  STRING_AGG(column_name, ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns 
WHERE table_name = 'attendance_schedules';

-- List all columns with their types:
SELECT 
  ordinal_position,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'attendance_schedules'
ORDER BY ordinal_position;

-- =============================================================================
-- SUCCESS INDICATORS
-- =============================================================================
-- ✅ Columns should be (16 total):
--   1. id (uuid)
--   2. tenant_id (uuid)
--   3. program_id (uuid)
--   4. name (character varying)
--   5. effective_date_start (date)
--   6. effective_date_end (date)
--   7. morning_open (time without time zone)
--   8. morning_close (time without time zone)
--   9. morning_late_threshold (integer)
--   10. afternoon_open (time without time zone)
--   11. afternoon_close (time without time zone)
--   12. afternoon_late_threshold (integer)
--   13. status (character varying)
--   14. created_by (uuid)
--   15. created_at (timestamp with time zone)
--   16. updated_at (timestamp with time zone)
--
-- ✅ Constraints should exist:
--   - check_morning_times: morning_close > morning_open
--   - check_afternoon_times: afternoon_close > afternoon_open
--   - check_date_range: effective_date_end >= effective_date_start
--   - UNIQUE(program_id, effective_date_start, effective_date_end)
--
-- ✅ Indexes should exist:
--   - idx_attendance_schedules_tenant
--   - idx_attendance_schedules_program
--   - idx_attendance_schedules_status
--   - idx_attendance_schedules_effective_dates
--
-- ✅ Trigger should exist:
--   - set_updated_at_attendance_schedules
--
-- =============================================================================
