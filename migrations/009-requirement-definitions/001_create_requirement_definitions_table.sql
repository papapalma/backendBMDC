-- ============================================================================
-- MIGRATION: Create Requirement Definitions Table
-- ============================================================================
-- Purpose: Store training enrollment requirement definitions that trainees 
-- must fulfill for enrollments
-- 
-- Captures: requirement metadata (name, description, mandatory flag), 
-- applicability rules (e.g., which trainees need which requirements),
-- and display/ordering information
--
-- Table Structure:
--   - id: unique identifier for requirement definition
--   - tenant_id: multi-tenancy isolation
--   - requirement_type: enum for the 7 core requirement types
--   - display_name: user-friendly name shown to admins and trainees
--   - description: detailed instructions/description for trainees
--   - is_mandatory: whether requirement is required for all applicable trainees
--   - is_active: soft flag to enable/disable requirements without deletion
--   - applicability_rules: JSONB for conditional requirements (e.g., marriage cert only for married)
--   - display_order: sort order in UI
--   - created_at, updated_at, deleted_at: audit trail and soft delete

-- ============================================================================
-- Step 1: Create ENUM type for requirement_type
-- ============================================================================
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'requirement_type_enum') THEN
    CREATE TYPE requirement_type_enum AS ENUM (
      'accomplished_learners_profile_form',
      'birth_certificate_copy',
      'marriage_certificate_copy',
      'id_pictures',
      'valid_id_copy',
      'report_card_tor_copy',
      'barangay_no_grade_certification'
    );
  END IF;
END $$;

-- ============================================================================
-- Step 2: Create requirement_definitions table
-- ============================================================================
CREATE TABLE IF NOT EXISTS requirement_definitions (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requirement_type          requirement_type_enum NOT NULL,
  
  -- Display and content
  display_name              VARCHAR(255)  NOT NULL,
  description               TEXT,
  
  -- Requirement configuration
  is_mandatory              BOOLEAN       NOT NULL DEFAULT true,
  is_active                 BOOLEAN       NOT NULL DEFAULT true,
  
  -- Applicability rules for conditional requirements
  -- Example: { "applicable_to": { "marital_status": ["married"] } }
  -- If NULL or empty: requirement applies to all trainees
  applicability_rules       JSONB,
  
  -- Display order in UI (lower numbers = higher priority/earlier in list)
  display_order             INTEGER       NOT NULL DEFAULT 0,
  
  -- Audit trail
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  
  -- Soft delete support
  deleted_at                TIMESTAMPTZ   DEFAULT NULL,
  
  -- Unique requirement type per tenant (can't have duplicate requirement types)
  UNIQUE(tenant_id, requirement_type)
);

-- ============================================================================
-- Step 3: Create trigger for updated_at
-- ============================================================================
DROP TRIGGER IF EXISTS set_updated_at_requirement_definitions ON requirement_definitions;
CREATE TRIGGER set_updated_at_requirement_definitions
  BEFORE UPDATE ON requirement_definitions
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================================================
-- Step 4: Create indexes for common queries
-- ============================================================================
-- Primary index for tenant-level queries
CREATE INDEX IF NOT EXISTS idx_requirement_definitions_tenant_id 
  ON requirement_definitions(tenant_id);

-- Composite index for tenant + requirement_type lookups
CREATE INDEX IF NOT EXISTS idx_requirement_definitions_tenant_type 
  ON requirement_definitions(tenant_id, requirement_type);

-- Index for filtering by active status
CREATE INDEX IF NOT EXISTS idx_requirement_definitions_tenant_active 
  ON requirement_definitions(tenant_id, is_active);

-- Index for mandatory requirement queries
CREATE INDEX IF NOT EXISTS idx_requirement_definitions_tenant_mandatory 
  ON requirement_definitions(tenant_id, is_mandatory);

-- Index for display order (used in UI sorting)
CREATE INDEX IF NOT EXISTS idx_requirement_definitions_display_order 
  ON requirement_definitions(tenant_id, display_order);

-- ============================================================================
-- Step 5: Verify the table structure
-- ============================================================================
SELECT 
  COUNT(*) as column_count,
  STRING_AGG(column_name, ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns 
WHERE table_name = 'requirement_definitions';

-- ============================================================================
-- Success Indicators
-- ============================================================================
-- ✅ requirement_type_enum ENUM type created with 7 core requirement types
-- ✅ requirement_definitions table created with all fields
-- ✅ Columns include:
--   - id (UUID PK)
--   - tenant_id (UUID FK)
--   - requirement_type (ENUM)
--   - display_name (VARCHAR)
--   - description (TEXT)
--   - is_mandatory (BOOLEAN)
--   - is_active (BOOLEAN)
--   - applicability_rules (JSONB)
--   - display_order (INTEGER)
--   - created_at, updated_at, deleted_at (TIMESTAMPTZ)
-- ✅ Indexes created for performance:
--   - idx_requirement_definitions_tenant_id
--   - idx_requirement_definitions_tenant_type (composite)
--   - idx_requirement_definitions_tenant_active (composite)
--   - idx_requirement_definitions_tenant_mandatory (composite)
--   - idx_requirement_definitions_display_order (composite)
-- ✅ Trigger set_updated_at_requirement_definitions created for updated_at
-- ✅ UNIQUE constraint on (tenant_id, requirement_type) prevents duplicates
-- ✅ FK constraint on tenant_id with CASCADE delete
