-- Add soft delete support to items table
-- Allows querying active items by filtering WHERE deleted_at IS NULL

ALTER TABLE items ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Create index for efficient soft-delete queries
CREATE INDEX idx_items_deleted_at ON items(tenant_id, deleted_at);

-- Update RLS policy to exclude soft-deleted items by default
-- (RLS policies will be applied separately if needed)
