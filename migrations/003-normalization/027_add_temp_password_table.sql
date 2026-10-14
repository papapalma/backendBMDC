-- =============================================================================
-- Migration 027: Create pending_registration_passwords table
--
-- Purpose:
--   During registration, the trainee submits their desired password. This
--   password must be stored temporarily so that when the admin approves the
--   registration, we can create the user account with the trainee's chosen
--   password (not a random temporary password).
--
--   This temporary storage uses a separate table (not trainees) to keep
--   password data isolated and clearly temporary. It's deleted after
--   the user account is created during approval.
--
-- Implementation:
--   - Create pending_registration_passwords table
--   - Store trainee_id -> hashed_password mapping during registration
--   - During approval, retrieve password and create user account
--   - Delete the temporary password record after user creation
--
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS pending_registration_passwords (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id        UUID          NOT NULL UNIQUE REFERENCES trainees(id) ON DELETE CASCADE,
  password_hash     VARCHAR(255)  NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index for quick lookup by trainee_id during approval
CREATE INDEX IF NOT EXISTS idx_pending_passwords_trainee_id 
ON pending_registration_passwords(trainee_id);

COMMIT;

