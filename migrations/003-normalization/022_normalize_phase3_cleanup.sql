-- =============================================================================
-- 022_normalize_to_3nf_phase3_cleanup.sql
-- 
-- Phase 3: Remove denormalized columns and obsolete tables
-- 
-- After data has been migrated to normalized tables (Phase 2), this migration
-- performs cleanup by:
-- 1. Removing denormalized columns from trainees table (program_id, enrollment_date)
-- 2. Removing JSONB columns from tenants (configuration.branding, configuration.notifications, configuration.features)
-- 3. Dropping obsolete tables (non_attendance_dates, attendance_schedule_overrides)
-- 4. Keeping pending_registrations for now (Phase 4 will handle deprecation)
--
-- WARNING: These changes are irreversible. Ensure Phase 2 data migration
--          has completed successfully before running this migration.
--
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Remove trainees.program_id and trainees.enrollment_date
-- 
-- These columns violated multi-valued dependency (3NF violation).
-- Enrollment relationship is now exclusively managed by enrollments table.
-- =============================================================================

-- Create index on enrollments for "primary program" lookups
CREATE INDEX IF NOT EXISTS idx_enrollments_trainee_status 
ON enrollments(trainee_id, status)
WHERE status IN ('enrolled', 'active');

-- Drop the columns
ALTER TABLE trainees
DROP COLUMN IF EXISTS program_id CASCADE;

ALTER TABLE trainees
DROP COLUMN IF EXISTS enrollment_date CASCADE;

-- Log removal
INSERT INTO audit_logs (
  action,
  entity_type,
  entity_id,
  details,
  created_at
)
VALUES (
  'migration.remove_denormalized_columns',
  'migration',
  'trainees',
  jsonb_build_object(
    'removed_columns', ARRAY['program_id', 'enrollment_date'],
    'reason', 'Multi-valued dependency violation (3NF)'
  ),
  NOW()
);


-- =============================================================================
-- 2. Clean up tenants.configuration JSONB
-- 
-- Remove branding, notifications, and features from configuration JSONB.
-- Keep announcements for backward compatibility (can be migrated later).
-- =============================================================================

UPDATE tenants
SET configuration = jsonb_set(
  configuration - 'branding' - 'features' - 'notifications',
  '{}',
  configuration
)
WHERE configuration IS NOT NULL;

-- Log cleanup
INSERT INTO audit_logs (
  action,
  entity_type,
  entity_id,
  details,
  created_at
)
VALUES (
  'migration.remove_jsonb_columns',
  'migration',
  'tenants',
  jsonb_build_object(
    'removed_keys', ARRAY['branding', 'features', 'notifications'],
    'kept_keys', ARRAY['announcements'],
    'reason', '1NF violation (non-atomic JSONB values)'
  ),
  NOW()
);


-- =============================================================================
-- 3. Drop obsolete attendance tables
-- 
-- These tables have been consolidated into attendance_exceptions.
-- =============================================================================

-- Archive records to an archive table first (optional but recommended)
-- CREATE TABLE IF NOT EXISTS archive_non_attendance_dates AS
-- SELECT * FROM non_attendance_dates WHERE 1 = 0;
-- 
-- INSERT INTO archive_non_attendance_dates
-- SELECT * FROM non_attendance_dates;

-- Drop the table
DROP TABLE IF EXISTS non_attendance_dates CASCADE;

-- Log removal
INSERT INTO audit_logs (
  action,
  entity_type,
  entity_id,
  details,
  created_at
)
VALUES (
  'migration.drop_obsolete_table',
  'migration',
  'non_attendance_dates',
  jsonb_build_object(
    'reason', 'Consolidated into attendance_exceptions table',
    'replacement', 'attendance_exceptions (exception_type = no_attendance_day)'
  ),
  NOW()
);


-- Archive attendance_schedule_overrides records
-- CREATE TABLE IF NOT EXISTS archive_attendance_schedule_overrides AS
-- SELECT * FROM attendance_schedule_overrides WHERE 1 = 0;
-- 
-- INSERT INTO archive_attendance_schedule_overrides
-- SELECT * FROM attendance_schedule_overrides;

-- Drop the table
DROP TABLE IF EXISTS attendance_schedule_overrides CASCADE;

-- Log removal
INSERT INTO audit_logs (
  action,
  entity_type,
  entity_id,
  details,
  created_at
)
VALUES (
  'migration.drop_obsolete_table',
  'migration',
  'attendance_schedule_overrides',
  jsonb_build_object(
    'reason', 'Consolidated into attendance_exceptions table',
    'replacement', 'attendance_exceptions (exception_type = schedule_override)'
  ),
  NOW()
);


-- =============================================================================
-- 4. Update UNIQUE constraint on trainees (no more program_id)
-- 
-- The previous check constraint linking program_id to enrollment_date is no longer valid.
-- =============================================================================

ALTER TABLE trainees
DROP CONSTRAINT IF EXISTS check_program_enrollment_consistency CASCADE;


-- =============================================================================
-- 5. Add constraints to enforce 3NF invariants
-- =============================================================================

-- Ensure trainee status is valid
ALTER TABLE trainees
ADD CONSTRAINT check_trainee_status_valid CHECK (
  status IN ('active', 'inactive', 'completed', 'dropped')
);

-- Ensure registration status is valid
ALTER TABLE trainees
ADD CONSTRAINT check_registration_status_valid CHECK (
  registration_status IN ('pending', 'approved', 'rejected', 'completed')
);

-- If registration is rejected, rejection_reason should be provided
ALTER TABLE trainees
ADD CONSTRAINT check_rejection_reason_consistency CHECK (
  (registration_status = 'rejected' AND registration_rejection_reason IS NOT NULL) OR
  (registration_status != 'rejected')
);

-- If registration was reviewed, reviewed_at should be set
ALTER TABLE trainees
ADD CONSTRAINT check_review_timestamp_consistency CHECK (
  (registration_reviewed_at IS NOT NULL AND registration_reviewed_by IS NOT NULL) OR
  (registration_reviewed_at IS NULL AND registration_reviewed_by IS NULL)
);


-- =============================================================================
-- 6. Add indexes for new query patterns
-- =============================================================================

-- Query trainees by registration status
CREATE INDEX IF NOT EXISTS idx_trainees_registration_status_pending
ON trainees(tenant_id, registration_status)
WHERE registration_status = 'pending' AND deleted_at IS NULL;

-- Query primary program for trainee (join through enrollments)
CREATE INDEX IF NOT EXISTS idx_enrollments_trainee_primary_program
ON enrollments(trainee_id, status)
WHERE status IN ('enrolled', 'active')
ORDER BY created_at DESC;


-- =============================================================================
-- 7. Summary of removals
-- =============================================================================

-- Columns removed:
-- - trainees.program_id (FK to programs)
-- - trainees.enrollment_date (DATE)
-- - tenants.configuration.branding (JSONB)
-- - tenants.configuration.features (JSONB)
-- - tenants.configuration.notifications (JSONB)

-- Tables dropped:
-- - non_attendance_dates
-- - attendance_schedule_overrides

-- Constraints added:
-- - check_trainee_status_valid
-- - check_registration_status_valid
-- - check_rejection_reason_consistency
-- - check_review_timestamp_consistency

-- Tables now used for:
-- - tenant_branding: Replaces tenants.configuration.branding
-- - tenant_features: Replaces tenants.configuration.features
-- - tenant_notification_channels: Replaces tenants.configuration.notifications
-- - attendance_exceptions: Consolidates non_attendance_dates + attendance_schedule_overrides
-- - trainees (registration_* columns): Replaces pending_registrations (Phase 4)
-- - enrollments: Exclusively manages program enrollments (no longer denormalized in trainees)

COMMIT;

-- =============================================================================
-- POST-CLEANUP VERIFICATION
-- =============================================================================
--
-- Run these queries to verify cleanup:
--
-- 1. Verify program_id removed from trainees:
--    SELECT COUNT(*) FROM information_schema.columns 
--    WHERE table_name = 'trainees' AND column_name = 'program_id';
--    -- Should return 0
--
-- 2. Verify enrollment_date removed:
--    SELECT COUNT(*) FROM information_schema.columns 
--    WHERE table_name = 'trainees' AND column_name = 'enrollment_date';
--    -- Should return 0
--
-- 3. Verify non_attendance_dates table dropped:
--    SELECT COUNT(*) FROM information_schema.tables 
--    WHERE table_name = 'non_attendance_dates';
--    -- Should return 0
--
-- 4. Verify attendance_schedule_overrides table dropped:
--    SELECT COUNT(*) FROM information_schema.tables 
--    WHERE table_name = 'attendance_schedule_overrides';
--    -- Should return 0
--
-- 5. Count attendance_exceptions records:
--    SELECT exception_type, COUNT(*) as count 
--    FROM attendance_exceptions 
--    GROUP BY exception_type;
--
-- 6. Verify no data loss in trainees:
--    SELECT COUNT(*) FROM trainees WHERE deleted_at IS NULL;
--
-- =============================================================================
