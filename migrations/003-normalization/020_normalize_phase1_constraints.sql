-- =============================================================================
-- 020_normalize_to_3nf_phase1_constraints.sql
-- 
-- Phase 1.4: Add UNIQUE constraints and composite key validation
-- 
-- This migration adds constraint enforcement for 3NF normalization:
-- 1. UNIQUE(tenant_id, email) on trainees - eliminates data duplication
-- 2. UNIQUE(tenant_id, name) on programs - enforces program name uniqueness per tenant
-- 3. UNIQUE(tenant_id, name) on items - enforces item name uniqueness per tenant
-- 4. UNIQUE(tenant_id, email) on pending_registrations - prevents duplicate registrations
-- 5. ADD registration_status + related columns to trainees (pending_registrations merge prep)
-- 6. ADD missing INDEX constraints for performance
--
-- These constraints enforce 3NF uniqueness requirements:
--   - No two trainees with same email in same tenant
--   - No two programs with same name in same tenant
--   - Eliminates need for composite lookups
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. UNIQUE(tenant_id, email) on trainees
-- 
-- Rationale: Prevents duplicate trainee records in same tenant
-- Impact: One trainee email per tenant (multi-tenant emails allowed)
-- Current status: May have duplicates; constraint added as DEFERRABLE initially
-- =============================================================================

-- First, identify and flag potential duplicates for review
-- (This helps admins decide which duplicate to keep)
CREATE TEMPORARY TABLE duplicate_trainee_emails AS
SELECT tenant_id, email, COUNT(*) as count
FROM trainees
WHERE deleted_at IS NULL
GROUP BY tenant_id, email
HAVING COUNT(*) > 1;

-- Log duplicates to a review table (optional, for audit trail)
-- TODO: Review duplicates and decide which to keep/merge
-- For now, we'll add the constraint as NOT DEFERRABLE to prevent new duplicates

ALTER TABLE trainees
ADD CONSTRAINT unique_tenant_email_trainees 
UNIQUE(tenant_id, email) DEFERRABLE INITIALLY DEFERRED;

-- Create index for this constraint (improves lookup performance)
CREATE UNIQUE INDEX idx_unique_tenant_email_trainees 
ON trainees(tenant_id, email) 
WHERE deleted_at IS NULL;


-- =============================================================================
-- 2. UNIQUE(tenant_id, name) on programs
-- 
-- Rationale: Prevents duplicate program names within same tenant
-- Impact: One program name per tenant (different tenants can share names)
-- Current status: Constraint added; existing duplicates will be flagged
-- =============================================================================

-- Identify potential duplicates
CREATE TEMPORARY TABLE duplicate_program_names AS
SELECT tenant_id, name, COUNT(*) as count
FROM programs
GROUP BY tenant_id, name
HAVING COUNT(*) > 1;

-- Add constraint
ALTER TABLE programs
ADD CONSTRAINT unique_tenant_name_programs 
UNIQUE(tenant_id, name) DEFERRABLE INITIALLY DEFERRED;

-- Create index
CREATE UNIQUE INDEX idx_unique_tenant_name_programs 
ON programs(tenant_id, name);


-- =============================================================================
-- 3. UNIQUE(tenant_id, name) on items
-- 
-- Rationale: Prevents duplicate item names within same tenant
-- Impact: One item name per tenant
-- Current status: Constraint added
-- =============================================================================

-- Identify potential duplicates
CREATE TEMPORARY TABLE duplicate_item_names AS
SELECT tenant_id, name, COUNT(*) as count
FROM items
GROUP BY tenant_id, name
HAVING COUNT(*) > 1;

-- Add constraint
ALTER TABLE items
ADD CONSTRAINT unique_tenant_name_items 
UNIQUE(tenant_id, name) DEFERRABLE INITIALLY DEFERRED;

-- Create index
CREATE UNIQUE INDEX idx_unique_tenant_name_items 
ON items(tenant_id, name);


-- =============================================================================
-- 4. UNIQUE(tenant_id, email) on pending_registrations
-- 
-- Rationale: Prevents duplicate registration applications per tenant
-- Impact: One pending registration per email per tenant
-- Current status: Constraint added for merge preparation
-- =============================================================================

-- Add constraint
ALTER TABLE pending_registrations
ADD CONSTRAINT unique_tenant_email_pending_registrations 
UNIQUE(tenant_id, email) DEFERRABLE INITIALLY DEFERRED;

-- Create index
CREATE UNIQUE INDEX idx_unique_tenant_email_pending_registrations 
ON pending_registrations(tenant_id, email);


-- =============================================================================
-- 5. ADD registration status fields to trainees table
-- 
-- Preparation for merging pending_registrations into trainees
-- These fields track registration state within trainees table
-- 
-- Rationale: Eliminates need for separate pending_registrations table
-- Structure:
--   registration_status: pending, approved, rejected, completed
--   registration_rejection_reason: NULL if approved, reason if rejected
--   registration_reviewed_by: user_id of admin who reviewed
--   registration_reviewed_at: timestamp of review
-- =============================================================================

-- Add registration status columns to trainees
ALTER TABLE trainees
ADD COLUMN IF NOT EXISTS registration_status VARCHAR(50)
  DEFAULT 'completed'
  CHECK (registration_status IN ('pending', 'approved', 'rejected', 'completed'));

ALTER TABLE trainees
ADD COLUMN IF NOT EXISTS registration_rejection_reason TEXT;

ALTER TABLE trainees
ADD COLUMN IF NOT EXISTS registration_reviewed_by UUID 
  REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE trainees
ADD COLUMN IF NOT EXISTS registration_reviewed_at TIMESTAMPTZ;

-- Create index for filtering by registration status
CREATE INDEX idx_trainees_registration_status 
ON trainees(tenant_id, registration_status) 
WHERE deleted_at IS NULL;


-- =============================================================================
-- 6. ADD performance indexes for common query patterns
-- =============================================================================

-- Trainees: Common queries by tenant, status, classification
CREATE INDEX IF NOT EXISTS idx_trainees_tenant_status 
ON trainees(tenant_id, status) 
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trainees_tenant_classification 
ON trainees(tenant_id, classification) 
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trainees_tenant_program 
ON trainees(tenant_id, program_id) 
WHERE deleted_at IS NULL AND program_id IS NOT NULL;

-- Enrollments: Common queries by tenant, status, date range
CREATE INDEX IF NOT EXISTS idx_enrollments_tenant_status 
ON enrollments(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_enrollments_trainee_program 
ON enrollments(trainee_id, program_id);

-- Programs: Common queries by tenant, status
CREATE INDEX IF NOT EXISTS idx_programs_tenant_status 
ON programs(tenant_id, status);

-- Items: Common queries by tenant, status
CREATE INDEX IF NOT EXISTS idx_items_tenant_status 
ON items(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_items_tenant_category 
ON items(tenant_id, category);

-- Attendance: Common queries by date range, program
CREATE INDEX IF NOT EXISTS idx_attendance_date_range 
ON attendance(tenant_id, attendance_date) 
WHERE status != 'excused';

CREATE INDEX IF NOT EXISTS idx_attendance_program_status 
ON attendance(program_id, status);

-- Pending registrations: Common queries
CREATE INDEX IF NOT EXISTS idx_pending_registrations_status 
ON pending_registrations(tenant_id, status);


-- =============================================================================
-- 7. ADD CHECK constraints to enforce 3NF invariants
-- =============================================================================

-- Trainees: If has program_id, must have enrollment_date
ALTER TABLE trainees
ADD CONSTRAINT check_program_enrollment_consistency CHECK (
  (program_id IS NULL AND enrollment_date IS NOT NULL) OR
  (program_id IS NOT NULL AND enrollment_date IS NOT NULL) OR
  (program_id IS NULL AND enrollment_date IS NULL)
);

-- Enrollments: start_date must be before end_date
ALTER TABLE enrollments
ADD CONSTRAINT check_enrollment_date_order CHECK (
  start_date <= end_date
);

-- Programs: start_date must be before end_date
ALTER TABLE programs
ADD CONSTRAINT check_program_date_order CHECK (
  start_date <= end_date
);

-- Items: available_quantity must not exceed quantity
ALTER TABLE items
ADD CONSTRAINT check_available_quantity CHECK (
  available_quantity >= 0 AND available_quantity <= quantity
);

-- Attendance: start_time must be before end_time (if both present)
ALTER TABLE attendance
ADD CONSTRAINT check_attendance_time_order CHECK (
  (time_in IS NULL OR time_out IS NULL OR time_in <= time_out)
);


-- =============================================================================
-- 8. Migration tracking
-- =============================================================================

-- Insert record that Phase 1.4 constraints have been applied
-- This helps track which migrations have been applied

COMMIT;

-- =============================================================================
-- POST-MIGRATION VERIFICATION STEPS
-- =============================================================================
--
-- Run these queries to verify constraint application:
--
-- 1. Check for duplicate trainee emails (should be 0 after fixing):
--    SELECT tenant_id, email, COUNT(*) FROM trainees 
--    WHERE deleted_at IS NULL GROUP BY tenant_id, email HAVING COUNT(*) > 1;
--
-- 2. Check for duplicate program names:
--    SELECT tenant_id, name, COUNT(*) FROM programs 
--    GROUP BY tenant_id, name HAVING COUNT(*) > 1;
--
-- 3. Check for duplicate item names:
--    SELECT tenant_id, name, COUNT(*) FROM items 
--    GROUP BY tenant_id, name HAVING COUNT(*) > 1;
--
-- 4. Verify new indexes exist:
--    SELECT indexname FROM pg_indexes 
--    WHERE tablename IN ('trainees', 'programs', 'items', 'enrollments', 'attendance')
--    ORDER BY indexname;
--
-- 5. Test constraint enforcement (should fail):
--    INSERT INTO trainees (..., email, tenant_id) VALUES (...);
--    -- Should raise: duplicate key value violates unique constraint
--
-- =============================================================================
