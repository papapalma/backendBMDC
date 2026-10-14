-- Add soft-delete support to programs table
-- Aligns programs table with archive feature requirements (Phase 2)

BEGIN;

-- Add deleted_at column for soft-delete support
ALTER TABLE programs ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Create indexes for efficient archive queries
CREATE INDEX IF NOT EXISTS idx_programs_deleted_at ON programs(deleted_at);
CREATE INDEX IF NOT EXISTS idx_programs_tenant_deleted ON programs(tenant_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Verify the column was added successfully
-- This will fail the entire transaction if the column already exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'programs' AND column_name = 'deleted_at'
  ) THEN
    RAISE EXCEPTION 'Column deleted_at was not added to programs table';
  END IF;
  RAISE NOTICE 'Successfully added deleted_at column to programs table';
END $$;

COMMIT;
