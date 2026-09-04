-- =============================================================================
-- 015_add_enrollment_limit.sql
-- Add enrollment_limit column to programs table
--
-- This migration adds capacity management to training programs by introducing
-- an enrollment_limit field that tracks the maximum number of trainees allowed
-- to enroll in each program.
--
-- Migration Strategy:
--   1. Add enrollment_limit column to programs table
--   2. Set CHECK constraint: enrollment_limit >= 1 AND enrollment_limit <= 10000
--   3. Existing programs default to NULL (unlimited capacity)
--   4. Create index on (tenant_id, enrollment_limit) for query optimization
--   5. Migration is idempotent (safe to run multiple times)
-- =============================================================================

BEGIN;

-- Add enrollment_limit column to programs table
-- NULL represents unlimited capacity for existing programs
ALTER TABLE programs
ADD COLUMN IF NOT EXISTS enrollment_limit INTEGER
  CHECK (enrollment_limit IS NULL OR (enrollment_limit >= 1 AND enrollment_limit <= 10000));

-- Create index to optimize queries filtering by enrollment_limit status
-- This index helps quickly find programs that are at or near capacity
CREATE INDEX IF NOT EXISTS idx_programs_tenant_enrollment_limit
  ON programs(tenant_id, enrollment_limit)
  WHERE enrollment_limit IS NOT NULL;

COMMIT;
