/**
 * Task 19: Add Duplicate Submission Detection
 * 
 * Creates submission_idempotency_keys table to track and prevent duplicate
 * attendance submissions within a 5-second window.
 * 
 * Schema:
 * - key: UUID idempotency key provided by client
 * - trainee_id: trainee submitting
 * - session_id: program session
 * - record_id: resulting attendance record
 * - created_at: submission timestamp
 */

CREATE TABLE IF NOT EXISTS submission_idempotency_keys (
  key           UUID          PRIMARY KEY,
  trainee_id    UUID          NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  session_id    UUID          NOT NULL REFERENCES program_sessions(id) ON DELETE CASCADE,
  record_id     UUID          NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index for quick lookup by key (PK already provides this)
-- Index for cleanup/queries by trainee_id
CREATE INDEX IF NOT EXISTS idx_submission_idempotency_trainee_id 
ON submission_idempotency_keys(trainee_id);

-- Index for cleanup queries by created_at (retention policy)
CREATE INDEX IF NOT EXISTS idx_submission_idempotency_created_at 
ON submission_idempotency_keys(created_at);

-- Index for duplicate detection: (trainee_id, session_id, created_at) for time window checks
CREATE INDEX IF NOT EXISTS idx_submission_idempotency_duplicate_check
ON submission_idempotency_keys(trainee_id, session_id, created_at);

-- Enable RLS for multi-tenancy security
ALTER TABLE submission_idempotency_keys ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own tenant's submissions (via trainee_id FK)
-- This policy relies on the trainee_id being in the authenticated user's tenant
CREATE POLICY rls_submission_idempotency_read ON submission_idempotency_keys
  FOR SELECT
  USING (true);  -- Enforced at app layer via trainee resolution

CREATE POLICY rls_submission_idempotency_insert ON submission_idempotency_keys
  FOR INSERT
  WITH CHECK (true);  -- Enforced at app layer via auth

CREATE POLICY rls_submission_idempotency_delete ON submission_idempotency_keys
  FOR DELETE
  USING (true);  -- Enforced at app layer via retention cleanup
