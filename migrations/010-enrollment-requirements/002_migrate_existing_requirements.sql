-- ============================================================================
-- MIGRATION: Migrate Existing Requirements to Link with requirement_definitions
-- ============================================================================
-- Purpose: For existing enrollments (if any), create enrollment_requirements 
-- records that link to requirement_definitions
--
-- This handles the case where enrollments already exist before this migration
-- and need to be linked to the new requirement_definitions system.
--
-- Steps:
-- 1. Ensure requirement_definitions are populated with all 7 core requirement types
-- 2. For each existing enrollment, create enrollment_requirements for each definition
--
-- Note: This migration assumes:
-- - requirement_definitions table exists with all 7 core requirements
-- - enrollments table exists
-- - enrollment_requirements table has been created
-- - trainee_status_records table exists with marital_status field

-- ============================================================================
-- Step 1: Verify requirement_definitions are populated
-- ============================================================================
-- Check how many requirement definitions exist per tenant
SELECT 
  tenant_id,
  COUNT(*) as definition_count,
  STRING_AGG(requirement_type::text, ', ') as types
FROM requirement_definitions
WHERE deleted_at IS NULL
GROUP BY tenant_id;

-- ============================================================================
-- Step 2: For each tenant, ensure all 7 core requirements exist
-- ============================================================================
-- Note: This assumes seeds have been run. If not, uncomment the block below.
-- For each tenant that has active enrollments but no requirements,
-- we would need to either:
-- A) Skip those tenants (requirements will be seeded separately)
-- B) Insert the requirements here
-- 
-- We'll use approach A for now - assume seeds handle this

-- ============================================================================
-- Step 3: Migrate existing enrollments to enrollment_requirements
-- ============================================================================
-- For each enrollment that doesn't have enrollment_requirements yet,
-- create them by joining with requirement_definitions

INSERT INTO enrollment_requirements (
  enrollment_id,
  requirement_id,
  tenant_id,
  is_applicable,
  submission_status,
  created_at,
  updated_at
)
SELECT
  e.id as enrollment_id,
  rd.id as requirement_id,
  e.tenant_id,
  -- Determine applicability based on applicability_rules
  CASE 
    -- Marriage certificate only for married trainees
    WHEN rd.requirement_type = 'marriage_certificate_copy' THEN
      (tsr.marital_status = 'married')
    -- All other requirements apply to all trainees
    ELSE TRUE
  END as is_applicable,
  'pending' as submission_status,
  NOW() as created_at,
  NOW() as updated_at
FROM enrollments e
CROSS JOIN requirement_definitions rd
LEFT JOIN trainee_status_records tsr ON tsr.trainee_id = e.trainee_id AND tsr.tenant_id = e.tenant_id
WHERE 
  e.tenant_id = rd.tenant_id
  AND rd.is_active = true
  AND rd.deleted_at IS NULL
  -- Only for enrollments that don't have requirements yet
  AND NOT EXISTS (
    SELECT 1 FROM enrollment_requirements er
    WHERE er.enrollment_id = e.id AND er.requirement_id = rd.id
  )
ON CONFLICT (enrollment_id, requirement_id) DO NOTHING;

-- ============================================================================
-- Step 4: Verify migration
-- ============================================================================
-- Show summary of migrated requirements
SELECT
  e.tenant_id,
  COUNT(DISTINCT e.id) as enrollment_count,
  COUNT(DISTINCT er.id) as requirement_assignment_count,
  COUNT(DISTINCT CASE WHEN er.is_applicable THEN er.id END) as applicable_count,
  COUNT(DISTINCT CASE WHEN NOT er.is_applicable THEN er.id END) as non_applicable_count
FROM enrollments e
LEFT JOIN enrollment_requirements er ON er.enrollment_id = e.id
GROUP BY e.tenant_id;

-- Show sample of migrated requirements (first 10)
SELECT
  e.id as enrollment_id,
  e.trainee_id,
  t.first_name || ' ' || t.last_name as trainee_name,
  rd.requirement_type,
  rd.display_name,
  er.is_applicable,
  er.submission_status,
  er.created_at
FROM enrollment_requirements er
JOIN enrollments e ON e.id = er.enrollment_id
JOIN trainees t ON t.id = e.trainee_id
JOIN requirement_definitions rd ON rd.id = er.requirement_id
ORDER BY er.created_at DESC
LIMIT 10;

-- ============================================================================
-- Success Indicators
-- ============================================================================
-- ✅ All requirement_definitions populated (7 per active tenant)
-- ✅ For each existing enrollment, enrollment_requirements created for each definition
-- ✅ Applicability correctly evaluated (marriage_certificate only for married trainees)
-- ✅ All new records set to submission_status = 'pending'
-- ✅ Created_at and updated_at timestamps set to NOW()
-- ✅ Migration respects existing data (no duplicates due to ON CONFLICT)
-- ✅ Summary query shows enrollment and requirement assignment counts
