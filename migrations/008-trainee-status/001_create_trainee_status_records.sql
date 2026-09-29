-- ============================================================================
-- MIGRATION: Create Trainee Status Records Table
-- ============================================================================
-- Purpose: Track post-graduation outcomes for trainees after completing training
-- Captures: graduation status, employment status, and skills-job match feedback
-- 
-- Table Structure:
--   - trainee_id + enrollment_id: links to completed enrollments
--   - status: graduated, unemployed, deceased (with dates)
--   - employment_status: employed, unemployed, self_employed, deceased
--   - job_title: if employed
--   - skills_match: whether job matches training skills
--   - remarks: qualitative feedback on outcome and job match
--   - timestamps: when status was recorded

-- ============================================================================
-- Step 1: Create trainee_status_records table
-- ============================================================================
CREATE TABLE IF NOT EXISTS trainee_status_records (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trainee_id                UUID          NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  enrollment_id             UUID          NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  
  -- Graduation status (after training completion)
  graduation_status         VARCHAR(20)   NOT NULL DEFAULT 'pending'
                                          CHECK (graduation_status IN ('pending', 'graduated', 'not_completed', 'suspended')),
  graduation_date           DATE,
  certificate_id            UUID          REFERENCES certificates(id) ON DELETE SET NULL,
  
  -- Post-graduation employment/outcome status
  employment_status         VARCHAR(50)   NOT NULL DEFAULT 'pending'
                                          CHECK (employment_status IN (
                                            'pending',           -- not yet recorded
                                            'employed',          -- has a job
                                            'unemployed',        -- no job
                                            'self_employed',     -- self-employed
                                            'pursuing_education', -- continuing studies
                                            'deceased'           -- passed away
                                          )),
  
  -- Employment details (if employed or self-employed)
  job_title                 VARCHAR(255),
  employer_name             VARCHAR(255),
  job_start_date            DATE,
  job_sector                VARCHAR(100),  -- e.g., "Manufacturing", "Healthcare", "IT"
  
  -- Skills match assessment
  -- Indicates whether the job closely aligns with training received
  skills_match              VARCHAR(20)   CHECK (skills_match IN ('exact_match', 'partial_match', 'no_match', 'not_applicable')),
  skills_match_percentage   DECIMAL(5,2),  -- 0-100: how well does job match skills
  
  -- Qualitative feedback
  remarks                   TEXT,          -- Admin/staff notes on trainee outcome and job fit
  
  -- Unemployment reason (if unemployed)
  unemployment_reason       VARCHAR(255),  -- e.g., "No available jobs", "Personal reasons", "Relocation"
  
  -- Outcome recorded by
  recorded_by               UUID          NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  recorded_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  
  -- Audit trail
  last_updated_by           UUID          REFERENCES users(id) ON DELETE SET NULL,
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  
  -- Soft delete support
  deleted_at                TIMESTAMPTZ   DEFAULT NULL,
  
  -- One status record per enrollment (unique trainee + enrollment)
  UNIQUE(tenant_id, enrollment_id)
);

-- ============================================================================
-- Step 2: Create trigger for updated_at
-- ============================================================================
DROP TRIGGER IF EXISTS set_updated_at_trainee_status_records ON trainee_status_records;
CREATE TRIGGER set_updated_at_trainee_status_records
  BEFORE UPDATE ON trainee_status_records
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================================================
-- Step 3: Create indexes for common queries
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_trainee_status_tenant_id 
  ON trainee_status_records(tenant_id);

CREATE INDEX IF NOT EXISTS idx_trainee_status_trainee_id 
  ON trainee_status_records(trainee_id);

CREATE INDEX IF NOT EXISTS idx_trainee_status_enrollment_id 
  ON trainee_status_records(enrollment_id);

CREATE INDEX IF NOT EXISTS idx_trainee_status_employment_status 
  ON trainee_status_records(tenant_id, employment_status);

CREATE INDEX IF NOT EXISTS idx_trainee_status_graduation_status 
  ON trainee_status_records(tenant_id, graduation_status);

CREATE INDEX IF NOT EXISTS idx_trainee_status_recorded_at 
  ON trainee_status_records(tenant_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_trainee_status_skills_match 
  ON trainee_status_records(tenant_id, skills_match) 
  WHERE skills_match IS NOT NULL;

-- ============================================================================
-- Step 4: Verify the table structure
-- ============================================================================
SELECT 
  COUNT(*) as column_count,
  STRING_AGG(column_name, ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns 
WHERE table_name = 'trainee_status_records';

-- ============================================================================
-- Success Indicators
-- ============================================================================
-- ✅ trainee_status_records table created with all fields
-- ✅ Indexes created for performance:
--   - idx_trainee_status_tenant_id
--   - idx_trainee_status_trainee_id
--   - idx_trainee_status_enrollment_id
--   - idx_trainee_status_employment_status
--   - idx_trainee_status_graduation_status
--   - idx_trainee_status_recorded_at
--   - idx_trainee_status_skills_match
-- ✅ Trigger set_updated_at_trainee_status_records created
-- ✅ UNIQUE constraint on (tenant_id, enrollment_id) ensures one record per enrollment
