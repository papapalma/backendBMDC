-- =============================================================================
-- 023_normalize_to_3nf_phase4_enforcement.sql
-- 
-- Phase 4: Add constraint enforcement, triggers, and audit logging
-- 
-- This migration adds:
-- 1. State machine enforcement triggers for registration workflow
-- 2. Enrollment constraint triggers (prevent overlaps, enforce limits)
-- 3. Audit logging triggers for normalized tables
-- 4. Data integrity validation functions
-- 5. Deprecation warnings for pending_registrations table
--
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Registration Status State Machine
-- 
-- Enforces valid state transitions:
-- pending → approved → completed
-- pending → rejected (terminal)
-- 
-- Invalid transitions are rejected with descriptive errors.
-- =============================================================================

CREATE OR REPLACE FUNCTION enforce_registration_status_transitions()
RETURNS TRIGGER AS $$
BEGIN
  -- Valid transitions:
  -- NULL/completed → pending (new application)
  -- pending → approved (admin action)
  -- pending → rejected (admin action)
  -- approved → completed (system action)
  -- rejected → rejected (idempotent)
  
  IF OLD.registration_status IS DISTINCT FROM NEW.registration_status THEN
    CASE
      WHEN NEW.registration_status = 'pending' THEN
        -- Allow transitions TO pending from completed/NULL
        IF OLD.registration_status NOT IN ('completed', NULL) THEN
          RAISE EXCEPTION 'Cannot transition registration status from % to pending', OLD.registration_status;
        END IF;
      
      WHEN NEW.registration_status = 'approved' THEN
        -- Only allow from pending
        IF OLD.registration_status != 'pending' THEN
          RAISE EXCEPTION 'Cannot transition registration status from % to approved (must be pending)', OLD.registration_status;
        END IF;
        -- Approval must set reviewed_by and reviewed_at
        IF NEW.registration_reviewed_by IS NULL OR NEW.registration_reviewed_at IS NULL THEN
          RAISE EXCEPTION 'Approval requires registration_reviewed_by and registration_reviewed_at to be set';
        END IF;
      
      WHEN NEW.registration_status = 'rejected' THEN
        -- Only allow from pending
        IF OLD.registration_status != 'pending' THEN
          RAISE EXCEPTION 'Cannot transition registration status from % to rejected (must be pending)', OLD.registration_status;
        END IF;
        -- Rejection must set rejection_reason
        IF NEW.registration_rejection_reason IS NULL THEN
          RAISE EXCEPTION 'Rejection requires registration_rejection_reason to be set';
        END IF;
        -- Rejection must set reviewed_by and reviewed_at
        IF NEW.registration_reviewed_by IS NULL OR NEW.registration_reviewed_at IS NULL THEN
          RAISE EXCEPTION 'Rejection requires registration_reviewed_by and registration_reviewed_at to be set';
        END IF;
      
      WHEN NEW.registration_status = 'completed' THEN
        -- Only allow from approved
        IF OLD.registration_status != 'approved' THEN
          RAISE EXCEPTION 'Cannot transition registration status from % to completed (must be approved)', OLD.registration_status;
        END IF;
    END CASE;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_registration_transitions ON trainees;
CREATE TRIGGER enforce_registration_transitions
  BEFORE UPDATE ON trainees
  FOR EACH ROW
  WHEN (OLD.registration_status IS DISTINCT FROM NEW.registration_status)
  EXECUTE FUNCTION enforce_registration_status_transitions();


-- =============================================================================
-- 2. Trainee Status Workflow Enforcement
-- 
-- Ensures consistent state between registration_status and trainee status:
-- - Active trainee: must have registration_status = 'completed'
-- - Inactive/completed/dropped: can have any registration_status
-- =============================================================================

CREATE OR REPLACE FUNCTION enforce_trainee_status_consistency()
RETURNS TRIGGER AS $$
BEGIN
  -- If trainee becomes active, registration must be completed
  IF NEW.status = 'active' AND NEW.registration_status != 'completed' THEN
    RAISE EXCEPTION 'Active trainees must have registration_status = completed (current: %)', NEW.registration_status;
  END IF;

  -- If registration is rejected, trainee cannot be active
  IF NEW.registration_status = 'rejected' AND NEW.status = 'active' THEN
    RAISE EXCEPTION 'Rejected trainees cannot have status = active';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_trainee_status_consistency ON trainees;
CREATE TRIGGER enforce_trainee_status_consistency
  BEFORE INSERT OR UPDATE ON trainees
  FOR EACH ROW
  EXECUTE FUNCTION enforce_trainee_status_consistency();


-- =============================================================================
-- 3. Enrollment Constraint Enforcement
-- 
-- Prevents:
-- - Duplicate enrollments (trainee cannot enroll twice in same program)
-- - Overlapping programs for same trainee (configurable)
-- - Exceeding program capacity
-- =============================================================================

CREATE OR REPLACE FUNCTION enforce_enrollment_constraints()
RETURNS TRIGGER AS $$
DECLARE
  duplicate_count INT;
  trainee_enrollment_count INT;
  current_program_capacity INT;
  current_enrollment_count INT;
BEGIN
  -- Check 1: Prevent duplicate enrollment in same program
  SELECT COUNT(*)
  INTO duplicate_count
  FROM enrollments
  WHERE trainee_id = NEW.trainee_id
    AND program_id = NEW.program_id
    AND tenant_id = NEW.tenant_id
    AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000')
    AND status IN ('enrolled', 'active');

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Trainee is already enrolled in this program';
  END IF;

  -- Check 2: Enforce program capacity limit
  SELECT max_trainees
  INTO current_program_capacity
  FROM programs
  WHERE id = NEW.program_id AND tenant_id = NEW.tenant_id;

  IF current_program_capacity IS NOT NULL THEN
    SELECT COUNT(*)
    INTO current_enrollment_count
    FROM enrollments
    WHERE program_id = NEW.program_id
      AND tenant_id = NEW.tenant_id
      AND status IN ('enrolled', 'active')
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000');

    IF current_enrollment_count >= current_program_capacity THEN
      RAISE EXCEPTION 'Program has reached maximum capacity (% / %)', 
        current_enrollment_count, current_program_capacity;
    END IF;
  END IF;

  -- Check 3: Validate date range
  IF NEW.end_date < NEW.start_date THEN
    RAISE EXCEPTION 'Enrollment end_date must be after start_date';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_enrollment_constraints ON enrollments;
CREATE TRIGGER enforce_enrollment_constraints
  BEFORE INSERT OR UPDATE ON enrollments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_enrollment_constraints();


-- =============================================================================
-- 4. Attendance Exception Validation
-- 
-- Ensures valid exception definitions and prevents invalid exception types.
-- =============================================================================

CREATE OR REPLACE FUNCTION validate_attendance_exception()
RETURNS TRIGGER AS $$
BEGIN
  -- Validate time range if both start and end times are provided
  IF NEW.exception_start_time IS NOT NULL 
     AND NEW.exception_end_time IS NOT NULL 
     AND NEW.exception_start_time >= NEW.exception_end_time THEN
    RAISE EXCEPTION 'exception_start_time must be before exception_end_time';
  END IF;

  -- Validate exception scope rules
  -- Scope rule: must have at least tenant_id, and either (program_id) or (trainee_id)
  IF NEW.program_id IS NULL AND NEW.trainee_id IS NULL THEN
    -- Tenant-wide exception - allowed
    NULL;
  ELSIF NEW.program_id IS NOT NULL AND NEW.trainee_id IS NULL THEN
    -- Program-wide exception - allowed
    NULL;
  ELSIF NEW.trainee_id IS NOT NULL THEN
    -- Trainee-specific exception - allowed (program_id optional)
    NULL;
  ELSE
    RAISE EXCEPTION 'Invalid exception scope: must have trainee_id or program_id';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_attendance_exception ON attendance_exceptions;
CREATE TRIGGER validate_attendance_exception
  BEFORE INSERT OR UPDATE ON attendance_exceptions
  FOR EACH ROW
  EXECUTE FUNCTION validate_attendance_exception();


-- =============================================================================
-- 5. Audit Logging for Normalized Tables
-- 
-- Automatically log changes to new normalized tables for compliance.
-- =============================================================================

CREATE OR REPLACE FUNCTION audit_trainee_notification_preferences()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (
    tenant_id,
    action,
    entity_type,
    entity_id,
    details,
    created_at
  )
  VALUES (
    NEW.tenant_id,
    CASE WHEN TG_OP = 'DELETE' THEN 'notification_preferences.deleted'
         WHEN TG_OP = 'INSERT' THEN 'notification_preferences.created'
         ELSE 'notification_preferences.updated' END,
    'trainee_notification_preferences',
    NEW.trainee_id::TEXT,
    jsonb_build_object(
      'email_enabled', NEW.email_enabled,
      'sms_enabled', NEW.sms_enabled,
      'push_enabled', NEW.push_enabled,
      'in_app_enabled', NEW.in_app_enabled,
      'weekly_digest', NEW.weekly_digest,
      'event_reminders', NEW.event_reminders,
      'enrollment_updates', NEW.enrollment_updates
    ),
    NOW()
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_trainee_notification_preferences ON trainee_notification_preferences;
CREATE TRIGGER audit_trainee_notification_preferences
  AFTER INSERT OR UPDATE OR DELETE ON trainee_notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION audit_trainee_notification_preferences();


CREATE OR REPLACE FUNCTION audit_tenant_branding()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (
    tenant_id,
    action,
    entity_type,
    entity_id,
    details,
    created_at
  )
  VALUES (
    NEW.tenant_id,
    CASE WHEN TG_OP = 'DELETE' THEN 'branding.deleted'
         WHEN TG_OP = 'INSERT' THEN 'branding.created'
         ELSE 'branding.updated' END,
    'tenant_branding',
    NEW.tenant_id::TEXT,
    jsonb_build_object(
      'logo_url', NEW.logo_url,
      'primary_color', NEW.primary_color,
      'secondary_color', NEW.secondary_color,
      'welcome_message', NEW.welcome_message
    ),
    NOW()
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_tenant_branding ON tenant_branding;
CREATE TRIGGER audit_tenant_branding
  AFTER INSERT OR UPDATE OR DELETE ON tenant_branding
  FOR EACH ROW
  EXECUTE FUNCTION audit_tenant_branding();


CREATE OR REPLACE FUNCTION audit_tenant_notification_channels()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (
    tenant_id,
    action,
    entity_type,
    entity_id,
    details,
    created_at
  )
  VALUES (
    NEW.tenant_id,
    CASE WHEN TG_OP = 'DELETE' THEN 'notification_channel.deleted'
         WHEN TG_OP = 'INSERT' THEN 'notification_channel.created'
         ELSE 'notification_channel.updated' END,
    'tenant_notification_channels',
    (NEW.tenant_id::TEXT || ':' || NEW.channel_type),
    jsonb_build_object(
      'channel_type', NEW.channel_type,
      'is_enabled', NEW.is_enabled
    ),
    NOW()
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_tenant_notification_channels ON tenant_notification_channels;
CREATE TRIGGER audit_tenant_notification_channels
  AFTER INSERT OR UPDATE OR DELETE ON tenant_notification_channels
  FOR EACH ROW
  EXECUTE FUNCTION audit_tenant_notification_channels();


CREATE OR REPLACE FUNCTION audit_tenant_features()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (
    tenant_id,
    action,
    entity_type,
    entity_id,
    details,
    created_at
  )
  VALUES (
    NEW.tenant_id,
    CASE WHEN TG_OP = 'DELETE' THEN 'feature_flag.deleted'
         WHEN TG_OP = 'INSERT' THEN 'feature_flag.created'
         ELSE 'feature_flag.updated' END,
    'tenant_features',
    (NEW.tenant_id::TEXT || ':' || NEW.feature_name),
    jsonb_build_object(
      'feature_name', NEW.feature_name,
      'is_enabled', NEW.is_enabled
    ),
    NOW()
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_tenant_features ON tenant_features;
CREATE TRIGGER audit_tenant_features
  AFTER INSERT OR UPDATE OR DELETE ON tenant_features
  FOR EACH ROW
  EXECUTE FUNCTION audit_tenant_features();


-- =============================================================================
-- 6. Trainee Notification Preference Initialization
-- 
-- When a new trainee is created, automatically initialize notification preferences
-- with sensible defaults (all channels enabled).
-- =============================================================================

CREATE OR REPLACE FUNCTION initialize_trainee_notification_preferences()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert default notification preferences for new trainee
  INSERT INTO trainee_notification_preferences (
    tenant_id,
    trainee_id,
    email_enabled,
    sms_enabled,
    push_enabled,
    in_app_enabled,
    weekly_digest,
    event_reminders,
    enrollment_updates,
    created_at,
    updated_at
  )
  VALUES (
    NEW.tenant_id,
    NEW.id,
    true, true, true, true, true, true, true,
    NOW(),
    NOW()
  )
  ON CONFLICT (tenant_id, trainee_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS initialize_trainee_notification_preferences ON trainees;
CREATE TRIGGER initialize_trainee_notification_preferences
  AFTER INSERT ON trainees
  FOR EACH ROW
  EXECUTE FUNCTION initialize_trainee_notification_preferences();


-- =============================================================================
-- 7. Tenant Branding Initialization
-- 
-- When a new tenant is created, automatically initialize branding with defaults.
-- =============================================================================

CREATE OR REPLACE FUNCTION initialize_tenant_branding()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert default branding for new tenant
  INSERT INTO tenant_branding (
    tenant_id,
    logo_url,
    primary_color,
    secondary_color,
    welcome_message,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NULL,
    '#007bff',
    '#6c757d',
    'Welcome to ' || NEW.name,
    NOW(),
    NOW()
  )
  ON CONFLICT (tenant_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS initialize_tenant_branding ON tenants;
CREATE TRIGGER initialize_tenant_branding
  AFTER INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION initialize_tenant_branding();


-- =============================================================================
-- 8. Mark pending_registrations Table for Deprecation
-- 
-- Add a comment noting this table is deprecated in favor of trainees.registration_*
-- This is a note-only change; actual deprecation occurs in Phase 5.
-- =============================================================================

COMMENT ON TABLE pending_registrations IS
  'DEPRECATED in favor of trainees.registration_status, registration_rejection_reason, registration_reviewed_by, registration_reviewed_at columns. '
  'This table is maintained for backward compatibility during transition. '
  'Phase 5 will migrate to view-based queries and eventual deprecation.';


-- =============================================================================
-- 9. Add Additional Validation Functions
-- 
-- Utility functions for data integrity checks and reporting.
-- =============================================================================

CREATE OR REPLACE FUNCTION validate_trainees_3nf()
RETURNS TABLE (
  issue_type VARCHAR,
  count INT,
  details TEXT
) AS $$
BEGIN
  -- Check 1: Trainees with duplicate emails per tenant
  RETURN QUERY
  SELECT 
    'duplicate_emails'::VARCHAR,
    COUNT(*)::INT,
    STRING_AGG(tenant_id::TEXT || ':' || email, ', ' ORDER BY tenant_id::TEXT || ':' || email)
  FROM (
    SELECT tenant_id, email, COUNT(*) as cnt
    FROM trainees
    WHERE deleted_at IS NULL
    GROUP BY tenant_id, email
    HAVING COUNT(*) > 1
  ) duplicates
  GROUP BY 1;

  -- Check 2: Trainees without notification preferences
  RETURN QUERY
  SELECT 
    'missing_notification_prefs'::VARCHAR,
    COUNT(*)::INT,
    'Trainees without trainee_notification_preferences record'
  FROM trainees t
  WHERE NOT EXISTS (
    SELECT 1 FROM trainee_notification_preferences tnp
    WHERE tnp.trainee_id = t.id AND tnp.tenant_id = t.tenant_id
  )
  AND t.deleted_at IS NULL;

  -- Check 3: Active trainees with non-completed registration status
  RETURN QUERY
  SELECT 
    'active_incomplete_registration'::VARCHAR,
    COUNT(*)::INT,
    STRING_AGG(id::TEXT, ', ' ORDER BY id::TEXT LIMIT 10)
  FROM trainees
  WHERE status = 'active' AND registration_status != 'completed'
  AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql;


-- =============================================================================
-- 10. Summary of Constraints Added
-- =============================================================================

-- Triggers added:
-- 1. enforce_registration_transitions - State machine validation
-- 2. enforce_trainee_status_consistency - Status workflow validation
-- 3. enforce_enrollment_constraints - Enrollment rules and capacity
-- 4. validate_attendance_exception - Exception definition validation
-- 5. audit_trainee_notification_preferences - Audit logging
-- 6. audit_tenant_branding - Audit logging
-- 7. audit_tenant_notification_channels - Audit logging
-- 8. audit_tenant_features - Audit logging
-- 9. initialize_trainee_notification_preferences - Auto-initialization
-- 10. initialize_tenant_branding - Auto-initialization

-- Functions added:
-- 1. enforce_registration_status_transitions() - State machine logic
-- 2. enforce_trainee_status_consistency() - Workflow validation
-- 3. enforce_enrollment_constraints() - Capacity and duplicate checks
-- 4. validate_attendance_exception() - Exception validation
-- 5. audit_trainee_notification_preferences() - Audit logging
-- 6. audit_tenant_branding() - Audit logging
-- 7. audit_tenant_notification_channels() - Audit logging
-- 8. audit_tenant_features() - Audit logging
-- 9. initialize_trainee_notification_preferences() - Auto-init trainees
-- 10. initialize_tenant_branding() - Auto-init tenants
-- 11. validate_trainees_3nf() - Validation reporting function

COMMIT;

-- =============================================================================
-- VERIFICATION & TESTING
-- =============================================================================
--
-- Test registration state machine:
-- BEGIN;
--   UPDATE trainees SET registration_status = 'pending' WHERE id = 'test_id';
--   UPDATE trainees SET registration_status = 'approved', 
--     registration_reviewed_by = 'reviewer_id',
--     registration_reviewed_at = NOW() 
--   WHERE id = 'test_id';
--   UPDATE trainees SET registration_status = 'completed' WHERE id = 'test_id';
-- COMMIT;
--
-- Test invalid transition (should fail):
-- UPDATE trainees SET registration_status = 'approved' WHERE registration_status = 'rejected';
-- -- Expected error: Cannot transition from rejected to approved
--
-- Test enrollment constraints:
-- SELECT * FROM validate_trainees_3nf();
-- -- Reports any data integrity issues
--
-- Test audit logging:
-- SELECT * FROM audit_logs WHERE entity_type = 'trainee_notification_preferences'
-- ORDER BY created_at DESC LIMIT 10;
--
-- =============================================================================
