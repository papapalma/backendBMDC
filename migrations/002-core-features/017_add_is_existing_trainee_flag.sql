-- Migration 017: Add is_existing_trainee flag to pending_registrations
-- Tracks whether a registration is for a new trainee account or an existing trainee applying to a new program
-- This allows the approval logic to handle each scenario differently

ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS is_existing_trainee BOOLEAN NOT NULL DEFAULT FALSE;

-- Create an index for filtering registrations by type
CREATE INDEX IF NOT EXISTS idx_pending_registrations_is_existing
  ON pending_registrations(is_existing_trainee, tenant_id);

-- Add comment explaining the column
COMMENT ON COLUMN pending_registrations.is_existing_trainee IS 
  'TRUE: This is an existing trainee applying to a new program (skip account creation on approval)
   FALSE: This is a new trainee account registration (create user account on approval)';
