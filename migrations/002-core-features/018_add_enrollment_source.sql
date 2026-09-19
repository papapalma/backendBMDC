-- =============================================================================
-- 018_add_enrollment_source.sql
-- Add source column to enrollments table for enrollment source tracking
--
-- This migration adds a column to track the source of enrollment creation
-- (social_share, direct, admin_assigned). This enables tracking of enrollment
-- conversions from different channels and improves analytics capabilities.
--
-- Migration Strategy:
--   1. Add source column with DEFAULT 'direct' and NOT NULL constraint
--   2. Add CHECK constraint to enforce valid source values
--   3. Create indexes on source for query performance
--   4. Backfill existing enrollments with source='direct'
--   5. Migration is idempotent (safe to run multiple times)
-- =============================================================================

BEGIN;

-- Add source column with DEFAULT value and CHECK constraint
ALTER TABLE IF EXISTS enrollments
ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'direct'
  CHECK (source IN ('social_share', 'direct', 'admin_assigned'));

-- Create index on source column for query performance
CREATE INDEX IF NOT EXISTS idx_enrollments_source
  ON enrollments(source, tenant_id);

-- Create composite index for filtering enrollments by source and date
CREATE INDEX IF NOT EXISTS idx_enrollments_source_date
  ON enrollments(source, created_at);

-- Backfill existing enrollments with source='direct' (already default, but ensure all are set)
UPDATE enrollments 
SET source = 'direct' 
WHERE source IS NULL 
  OR source = '';

-- Add comment explaining the column
COMMENT ON COLUMN enrollments.source IS 
  'Tracks the source of enrollment creation:
   - direct: Manual enrollment or direct registration
   - social_share: Enrollment from shared social media link
   - admin_assigned: Enrollment created by administrator';

COMMIT;
