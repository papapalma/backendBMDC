-- ============================================================================
-- MIGRATION: Add Trainee Status Record Link to Enrollments
-- ============================================================================
-- Purpose: Link enrollments to their corresponding trainee status records
-- This allows easy navigation from an enrollment to its post-graduation tracking
-- 
-- Changes:
--   - Add trainee_status_record_id column to enrollments table
--   - Create foreign key to trainee_status_records table
--   - Create index for fast lookups

-- ============================================================================
-- Step 1: Add trainee_status_record_id column to enrollments
-- ============================================================================
ALTER TABLE enrollments
ADD COLUMN trainee_status_record_id UUID REFERENCES trainee_status_records(id) ON DELETE SET NULL;

-- ============================================================================
-- Step 2: Create index for fast lookups
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_enrollments_trainee_status_record_id 
  ON enrollments(trainee_status_record_id);

-- ============================================================================
-- Step 3: Create composite index for common queries
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_enrollments_status_and_record
  ON enrollments(status, trainee_status_record_id)
  WHERE trainee_status_record_id IS NOT NULL;

-- ============================================================================
-- Step 4: Verify the changes
-- ============================================================================
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'enrollments' 
  AND column_name = 'trainee_status_record_id';

-- ============================================================================
-- Success Indicators
-- ============================================================================
-- ✅ trainee_status_record_id column added to enrollments table
-- ✅ Foreign key constraint created to trainee_status_records
-- ✅ Indexes created:
--   - idx_enrollments_trainee_status_record_id
--   - idx_enrollments_status_and_record
-- ✅ Column allows NULL values (status records are created after/separately)
