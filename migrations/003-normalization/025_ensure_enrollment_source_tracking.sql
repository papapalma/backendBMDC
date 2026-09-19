-- Migration 025: Ensure trainees registration and enrollments tracking is set up correctly
-- 
-- In the normalized schema (Normalize_full_schema.sql), pending registrations are stored
-- in the trainees table using registration_status field, and enrollment sources are tracked
-- in the enrollments table using the source field.
--
-- This migration verifies that:
-- 1. trainees table has all required registration status fields
-- 2. enrollments table has the source field for tracking enrollment source
-- 3. All required indexes exist for query performance
--
-- This is a validation/verification migration - it should not fail on existing systems
-- that already have these fields from the Normalize_full_schema.sql

BEGIN;

-- ============================================================================
-- Verify trainees table has all required registration fields
-- ============================================================================

-- Check trainees.registration_status field exists
-- If not present, add it (though it should exist from schema initialization)
ALTER TABLE trainees
ADD COLUMN IF NOT EXISTS registration_status VARCHAR(50) NOT NULL DEFAULT 'completed'
  CHECK (registration_status IN ('pending', 'approved', 'rejected', 'completed'));

-- Add registration review fields if missing
ALTER TABLE trainees
ADD COLUMN IF NOT EXISTS registration_rejection_reason TEXT;

ALTER TABLE trainees
ADD COLUMN IF NOT EXISTS registration_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE trainees
ADD COLUMN IF NOT EXISTS registration_reviewed_at TIMESTAMPTZ;

-- ============================================================================
-- Verify enrollments table has source field for enrollment tracking
-- ============================================================================

-- Check enrollments.source field exists
-- If not present, add it (though it should exist from schema initialization)
ALTER TABLE enrollments
ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'direct'
  CHECK (source IN ('social_share', 'direct', 'admin_assigned'));

-- ============================================================================
-- Create indexes for query performance
-- ============================================================================

-- Index for finding pending registrations
CREATE INDEX IF NOT EXISTS idx_trainees_registration_status_pending
  ON trainees(tenant_id, registration_status)
  WHERE registration_status IN ('pending', 'rejected');

-- Index for finding registrations by review status
CREATE INDEX IF NOT EXISTS idx_trainees_registration_reviewed
  ON trainees(tenant_id, registration_reviewed_at)
  WHERE registration_reviewed_at IS NOT NULL;

-- Index for enrollment source tracking (filtering registrations by source)
CREATE INDEX IF NOT EXISTS idx_enrollments_source
  ON enrollments(tenant_id, source);

-- Index for enrollment source with status
CREATE INDEX IF NOT EXISTS idx_enrollments_source_status
  ON enrollments(tenant_id, source, status);

-- ============================================================================
-- Create triggers for registration state transitions
-- ============================================================================

-- Enforce valid registration_status transitions
-- Transitions allowed: completed → pending → approved/rejected → completed
-- Cannot skip steps or go backwards (except completed → pending for re-registration)

CREATE OR REPLACE FUNCTION enforce_registration_status_transitions()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow state transitions only through the state machine
  IF NEW.registration_status != OLD.registration_status THEN
    -- completed → pending: allowed (re-registration)
    IF OLD.registration_status = 'completed' AND NEW.registration_status = 'pending' THEN
      NULL; -- Allow transition
    -- pending → approved: allowed (with review fields)
    ELSIF OLD.registration_status = 'pending' AND NEW.registration_status = 'approved' THEN
      IF NEW.registration_reviewed_by IS NULL OR NEW.registration_reviewed_at IS NULL THEN
        RAISE EXCEPTION 'Approval requires registration_reviewed_by and registration_reviewed_at to be set';
      END IF;
    -- pending → rejected: allowed (with review fields and rejection reason)
    ELSIF OLD.registration_status = 'pending' AND NEW.registration_status = 'rejected' THEN
      IF NEW.registration_reviewed_by IS NULL OR NEW.registration_reviewed_at IS NULL THEN
        RAISE EXCEPTION 'Rejection requires registration_reviewed_by and registration_reviewed_at to be set';
      END IF;
      IF NEW.registration_rejection_reason IS NULL OR NEW.registration_rejection_reason = '' THEN
        RAISE EXCEPTION 'Rejection requires registration_rejection_reason to be provided';
      END IF;
    -- approved/rejected → completed: allowed
    ELSIF (OLD.registration_status IN ('approved', 'rejected')) AND NEW.registration_status = 'completed' THEN
      NULL; -- Allow transition
    -- All other transitions are forbidden
    ELSE
      RAISE EXCEPTION 'Invalid registration status transition: % → %', OLD.registration_status, NEW.registration_status;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_registration_transitions ON trainees;
CREATE TRIGGER trg_enforce_registration_transitions
  BEFORE UPDATE ON trainees
  FOR EACH ROW
  WHEN (OLD.registration_status IS DISTINCT FROM NEW.registration_status)
  EXECUTE FUNCTION enforce_registration_status_transitions();

-- ============================================================================
-- Create trigger for trainee status consistency
-- ============================================================================

-- Enforce that active trainees must have registration_status = 'completed'
-- and rejected trainees cannot be active

CREATE OR REPLACE FUNCTION enforce_trainee_status_consistency()
RETURNS TRIGGER AS $$
BEGIN
  -- Active trainees must have completed registration
  IF NEW.status = 'active' AND NEW.registration_status != 'completed' THEN
    RAISE EXCEPTION 'Active trainees must have registration_status = ''completed''';
  END IF;
  
  -- Rejected trainees cannot be active
  IF NEW.registration_status = 'rejected' AND NEW.status = 'active' THEN
    RAISE EXCEPTION 'Rejected trainees cannot have status = ''active''';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_trainee_consistency ON trainees;
CREATE TRIGGER trg_enforce_trainee_consistency
  BEFORE UPDATE ON trainees
  FOR EACH ROW
  EXECUTE FUNCTION enforce_trainee_status_consistency();

COMMIT;
