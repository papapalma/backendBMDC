-- Migration 026: Fix enrollment constraints trigger
-- Issue: enforce_enrollment_constraints() was referencing non-existent fields (end_date, start_date)
-- Fix: Replace with correct field names for enrollments table (enrollment_date, completion_date)

CREATE OR REPLACE FUNCTION enforce_enrollment_constraints()
RETURNS TRIGGER AS $$
DECLARE
  duplicate_count INT;
  current_program_capacity INT;
  current_enrollment_count INT;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM enrollments
  WHERE trainee_id = NEW.trainee_id
    AND program_id = NEW.program_id
    AND tenant_id = NEW.tenant_id
    AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000')
    AND status IN ('enrolled', 'active');

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Trainee is already enrolled in this program';
  END IF;

  SELECT max_trainees INTO current_program_capacity
  FROM programs
  WHERE id = NEW.program_id AND tenant_id = NEW.tenant_id;

  IF current_program_capacity IS NOT NULL THEN
    SELECT COUNT(*) INTO current_enrollment_count
    FROM enrollments
    WHERE program_id = NEW.program_id
      AND tenant_id = NEW.tenant_id
      AND status IN ('enrolled', 'active')
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000');

    IF current_enrollment_count >= current_program_capacity THEN
      RAISE EXCEPTION 'Program has reached maximum capacity';
    END IF;
  END IF;

  -- enrollment_date and completion_date validation (if completion_date is set)
  IF NEW.completion_date IS NOT NULL AND NEW.completion_date < NEW.enrollment_date THEN
    RAISE EXCEPTION 'Completion date must be after enrollment date';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
