-- Migration 011: Training Requirement Files Table
-- Creates table to store training requirement file uploads with tenant isolation
-- Tracks: Accomplished Learner's Profile, Birth Certificate, ID Pictures, Valid ID, Report Card, Barangay Certification

CREATE TABLE IF NOT EXISTS public.training_requirement_files (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign Keys
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trainee_id UUID NOT NULL REFERENCES public.trainees(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  
  -- File Metadata
  requirement_type VARCHAR(255) NOT NULL,
    -- Valid values:
    -- - accomplished_learners_profile_form
    -- - birth_certificate_copy
    -- - marriage_certificate_copy (optional)
    -- - id_pictures
    -- - valid_id_copy
    -- - report_card_tor_copy
    -- - barangay_no_grade_certification
  
  file_path VARCHAR(1024) NOT NULL,
    -- Relative path: /uploads/{tenant_id}/documents/trainees/{trainee_id}/{filename}
  
  file_name VARCHAR(255) NOT NULL,
    -- Original filename as uploaded by user
  
  file_size_bytes BIGINT NOT NULL,
    -- For quota tracking and validation
  
  mime_type VARCHAR(100),
    -- e.g., application/pdf, image/jpeg
  
  -- Timestamps
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
    -- Soft delete for audit trail
  
  -- Constraints
  CONSTRAINT fk_training_req_tenant FOREIGN KEY(tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_training_req_trainee FOREIGN KEY(trainee_id) REFERENCES public.trainees(id) ON DELETE CASCADE,
  CONSTRAINT fk_training_req_uploaded_by FOREIGN KEY(uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL,
  
  -- One file per requirement type per trainee (not deleted)
  UNIQUE(tenant_id, trainee_id, requirement_type, deleted_at)
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_training_requirement_files_trainee 
  ON public.training_requirement_files(trainee_id);

CREATE INDEX IF NOT EXISTS idx_training_requirement_files_tenant 
  ON public.training_requirement_files(tenant_id);

CREATE INDEX IF NOT EXISTS idx_training_requirement_files_uploaded_by 
  ON public.training_requirement_files(uploaded_by);

CREATE INDEX IF NOT EXISTS idx_training_requirement_files_requirement_type 
  ON public.training_requirement_files(requirement_type);

CREATE INDEX IF NOT EXISTS idx_training_requirement_files_deleted 
  ON public.training_requirement_files(deleted_at) 
  WHERE deleted_at IS NULL;

-- Enable RLS for tenant isolation
ALTER TABLE public.training_requirement_files ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access requirement files for their tenant
CREATE POLICY training_requirement_files_tenant_isolation ON public.training_requirement_files
  FOR SELECT
  USING (
    tenant_id = (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

-- RLS Policy: Users can insert requirement files for their tenant
CREATE POLICY training_requirement_files_insert_own_tenant ON public.training_requirement_files
  FOR INSERT
  WITH CHECK (
    tenant_id = (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

-- RLS Policy: Users can update (soft delete) their own uploads
CREATE POLICY training_requirement_files_delete_own ON public.training_requirement_files
  FOR UPDATE
  USING (
    tenant_id = (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON public.training_requirement_files TO authenticated;
GRANT ALL ON public.training_requirement_files TO postgres;

-- Add comments for documentation
COMMENT ON TABLE public.training_requirement_files IS 
  'Stores training requirement file uploads with tenant isolation. One file per requirement type per trainee. Supports soft deletes for audit trail.';

COMMENT ON COLUMN public.training_requirement_files.requirement_type IS
  'Type of requirement: accomplished_learners_profile_form, birth_certificate_copy, marriage_certificate_copy, id_pictures, valid_id_copy, report_card_tor_copy, barangay_no_grade_certification';

COMMENT ON COLUMN public.training_requirement_files.file_path IS
  'Tenant-scoped path: /uploads/{tenant_id}/documents/trainees/{trainee_id}/{filename}';
