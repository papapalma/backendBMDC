-- Migration: Create trainee_remarks table
-- Purpose: Store remarks/notes about trainees added by staff/admins
-- Author: System
-- Date: 2026-09-25

-- Create trainee_remarks table
CREATE TABLE IF NOT EXISTS trainee_remarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id UUID NOT NULL,
  remark TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  tenant_id UUID NOT NULL,
  
  -- Foreign key constraints
  CONSTRAINT fk_trainee_remarks_trainee 
    FOREIGN KEY (trainee_id) 
    REFERENCES trainees(id) 
    ON DELETE CASCADE,
  
  CONSTRAINT fk_trainee_remarks_creator 
    FOREIGN KEY (created_by) 
    REFERENCES users(id) 
    ON DELETE CASCADE,
  
  CONSTRAINT fk_trainee_remarks_tenant 
    FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) 
    ON DELETE CASCADE
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_trainee_remarks_trainee_id 
  ON trainee_remarks(trainee_id);

CREATE INDEX IF NOT EXISTS idx_trainee_remarks_tenant_id 
  ON trainee_remarks(tenant_id);

CREATE INDEX IF NOT EXISTS idx_trainee_remarks_created_at 
  ON trainee_remarks(created_at DESC);

-- Add comment to table
COMMENT ON TABLE trainee_remarks IS 'Stores remarks and notes about trainees added by staff and administrators';
COMMENT ON COLUMN trainee_remarks.trainee_id IS 'Reference to the trainee this remark is about';
COMMENT ON COLUMN trainee_remarks.remark IS 'The remark/note text content';
COMMENT ON COLUMN trainee_remarks.created_by IS 'User who created this remark';
COMMENT ON COLUMN trainee_remarks.tenant_id IS 'Tenant isolation for multi-tenancy support';
