-- ============================================================================
-- MIGRATION: Create Enrollment Requirements Table
-- ============================================================================
-- Purpose: Track training enrollment requirements per trainee enrollment
--
-- Links enrollments to requirement definitions and tracks submission status
-- Captures requirement submission lifecycle: pending → submitted → verified/rejected/waived
--
-- Table Structure:
--   - id: unique identifier
--   - enrollment_id: foreign key to enrollments
--   - requirement_id: foreign key to requirement_definitions
--   - tenant_id: multi-tenancy isolation
--   - is_applicable: whether this requirement applies to this trainee
--   - submission_status: current status in the submission lifecycle
--   - document_url: URL to submitted requirement document
--   - submitted_at, verified_at: timestamps
--   - verified_by: user who verified the requirement
--   - rejection_reason: reason for rejection if status is rejected
--   - created_at, updated_at: audit trail

-- ============================================================================
-- Step 1: Create ENUM type for submission_status
-- ============================================================================
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'requirement_submission_status_enum') THEN
    CREATE TYPE requirement_submission_status_enum AS ENUM (
      'pending',
      'submitted',
      'verified',
      'rejected',
      'waived'
    );
  END IF;
END $$;

-- ============================================================================
-- Step 2: Create enrollment_requirements table
-- ============================================================================
CREATE TABLE IF NOT EXISTS enrollment_requirements (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id             UUID          NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  requirement_id            UUID          NOT NULL REFERENCES requirement_definitions(id) ON DELETE CASCADE,
  tenant_id                 UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Applicability and status
  is_applicable             BOOLEAN       NOT NULL DEFAULT true,
  submission_status         requirement_submission_status_enum NOT NULL DEFAULT 'pending',
  
  -- Document submission
  document_url              VARCHAR(2048),
  
  -- Submission tracking
  submitted_at              TIMESTAMPTZ,
  verified_at               TIMESTAMPTZ,
  verified_by               UUID REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason          TEXT,
  
  -- Audit trail
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  
  -- Composite unique constraint: one requirement per enrollment
  UNIQUE(enrollment_id, requirement_id)
);

-- ============================================================================
-- Step 3: Create trigger for updated_at
-- ============================================================================
DROP TRIGGER IF EXISTS set_updated_at_enrollment_requirements ON enrollment_requirements;
CREATE TRIGGER set_updated_at_enrollment_requirements
  BEFORE UPDATE ON enrollment_requirements
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================================================
-- Step 4: Create indexes for common queries
-- ============================================================================
-- Primary index for tenant-level queries
CREATE INDEX IF NOT EXISTS idx_enrollment_requirements_tenant_id 
  ON enrollment_requirements(tenant_id);

-- Index for enrollment queries (finding all requirements for an enrollment)
CREATE INDEX IF NOT EXISTS idx_enrollment_requirements_enrollment_id 
  ON enrollment_requirements(enrollment_id);

-- Composite index for requirement queries (all enrollments needing a requirement)
CREATE INDEX IF NOT EXISTS idx_enrollment_requirements_requirement_id 
  ON enrollment_requirements(requirement_id);

-- Index for status queries (pending requirements)
CREATE INDEX IF NOT EXISTS idx_enrollment_requirements_status 
  ON enrollment_requirements(submission_status);

-- Composite index for finding applicable requirements needing action
CREATE INDEX IF NOT EXISTS idx_enrollment_requirements_applicable_pending 
  ON enrollment_requirements(enrollment_id, is_applicable, submission_status)
  WHERE is_applicable = true AND submission_status = 'pending';

-- Index for verified_by queries (finding who verified requirements)
CREATE INDEX IF NOT EXISTS idx_enrollment_requirements_verified_by 
  ON enrollment_requirements(verified_by) 
  WHERE verified_by IS NOT NULL;

-- ============================================================================
-- Step 5: Verify the table structure
-- ============================================================================
SELECT 
  COUNT(*) as column_count,
  STRING_AGG(column_name, ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns 
WHERE table_name = 'enrollment_requirements';

-- ============================================================================
-- Success Indicators
-- ============================================================================
-- ✅ requirement_submission_status_enum ENUM type created with 5 statuses
-- ✅ enrollment_requirements table created with all fields
-- ✅ Columns include:
--   - id (UUID PK)
--   - enrollment_id (UUID FK)
--   - requirement_id (UUID FK)
--   - tenant_id (UUID FK)
--   - is_applicable (BOOLEAN)
--   - submission_status (ENUM)
--   - document_url (VARCHAR)
--   - submitted_at, verified_at, verified_by (tracking)
--   - rejection_reason (TEXT)
--   - created_at, updated_at (TIMESTAMPTZ)
-- ✅ Indexes created for performance:
--   - idx_enrollment_requirements_tenant_id
--   - idx_enrollment_requirements_enrollment_id
--   - idx_enrollment_requirements_requirement_id
--   - idx_enrollment_requirements_status
--   - idx_enrollment_requirements_applicable_pending
--   - idx_enrollment_requirements_verified_by
-- ✅ Trigger set_updated_at_enrollment_requirements created for updated_at
-- ✅ UNIQUE constraint on (enrollment_id, requirement_id) prevents duplicates
-- ✅ FK constraints with CASCADE delete for data integrity
