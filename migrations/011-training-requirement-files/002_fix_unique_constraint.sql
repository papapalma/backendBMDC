-- Migration 011-002: Fix Unique Constraint for Training Requirement Files
-- Problem: The UNIQUE constraint includes deleted_at which prevents re-uploading files
-- Solution: Create a unique partial index that only applies when deleted_at IS NULL

-- Drop the old constraint
ALTER TABLE public.training_requirement_files 
  DROP CONSTRAINT IF EXISTS training_requirement_files_tenant_id_trainee_id_requirement_t_key;

-- Create a partial unique index instead
-- This ensures one active (not deleted) file per requirement type per trainee
CREATE UNIQUE INDEX IF NOT EXISTS idx_training_req_files_unique_active
  ON public.training_requirement_files(tenant_id, trainee_id, requirement_type)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX idx_training_req_files_unique_active IS
  'Ensures only one active (non-deleted) file per requirement type per trainee per tenant';
