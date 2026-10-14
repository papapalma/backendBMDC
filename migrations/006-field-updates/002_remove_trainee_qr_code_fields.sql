-- ============================================================================
-- MIGRATION: Remove QR Code Fields from Trainees
-- ============================================================================
-- Purpose: Remove QR code fields from the trainees table as they are no longer needed
-- 
-- Fields to remove:
--   - qr_code (VARCHAR 255, UNIQUE)
--   - qr_code_path (VARCHAR 500)
-- 
-- Impact:
--   - Removes QR code based identification system
--   - All trainees will be identified by their UUID (id) or email instead
--   - Indexes on qr_code will be dropped
--   - UNIQUE constraint on qr_code will be removed

-- ============================================================================
-- Step 1: Drop indexes that reference qr_code
-- ============================================================================
DROP INDEX IF EXISTS idx_trainees_qr CASCADE;

-- ============================================================================
-- Step 2: Remove the QR code columns from trainees table
-- ============================================================================
ALTER TABLE trainees
DROP COLUMN IF EXISTS qr_code CASCADE;

ALTER TABLE trainees
DROP COLUMN IF EXISTS qr_code_path;

-- ============================================================================
-- Step 3: Verify the changes
-- ============================================================================
-- Check that the columns have been removed
SELECT 
  column_name,
  data_type
FROM information_schema.columns 
WHERE table_name = 'trainees'
  AND column_name IN ('qr_code', 'qr_code_path')
ORDER BY ordinal_position;

-- Result should be empty if removal was successful

-- ============================================================================
-- Success Indicators
-- ============================================================================
-- ✅ qr_code column removed from trainees table
-- ✅ qr_code_path column removed from trainees table
-- ✅ idx_trainees_qr index dropped
-- ✅ Verification query returns 0 rows (no columns found)
