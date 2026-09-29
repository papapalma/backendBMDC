-- =============================================================================
-- 016_add_push_subscriptions.sql
-- Add push_subscriptions table for Web Push Notifications
--
-- This migration creates a table to store device push notification subscriptions.
-- Each subscription is tied to a user and device, allowing the backend to send
-- push notifications to installed PWA instances.
--
-- Migration Strategy:
--   1. Create push_subscriptions table with endpoint, auth, and p256dh keys
--   2. Enforce unique constraint on (user_id, endpoint) to prevent duplicates
--   3. Add tenant_id for multi-tenant isolation
--   4. Include device_identifier for distinguishing multiple devices per user
--   5. Track subscription metadata (user_agent, created_at, updated_at)
--   6. Create indexes for efficient queries
--   7. Migration is idempotent (safe to run multiple times)
-- =============================================================================

BEGIN;

-- Create push_subscriptions table
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User reference
  user_id UUID NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Web Push subscription endpoint and keys
  endpoint TEXT NOT NULL,
  auth_secret TEXT NOT NULL, -- base64-encoded auth secret from browser
  p256dh_key TEXT NOT NULL,  -- base64-encoded elliptic curve public key from browser
  
  -- Device identification
  device_identifier VARCHAR(255), -- e.g., "chrome-windows-desktop", "safari-ios"
  user_agent TEXT,
  
  -- Metadata
  is_active BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(user_id, endpoint),
  CHECK (char_length(endpoint) > 0),
  CHECK (char_length(auth_secret) > 0),
  CHECK (char_length(p256dh_key) > 0)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id 
  ON push_subscriptions(user_id);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_tenant_id 
  ON push_subscriptions(tenant_id);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active 
  ON push_subscriptions(is_active) 
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_active 
  ON push_subscriptions(user_id, is_active) 
  WHERE is_active = TRUE;

-- Add RLS policies for push_subscriptions (if RLS is enabled)
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own subscriptions
CREATE POLICY push_subscriptions_user_read 
  ON push_subscriptions 
  FOR SELECT 
  USING (user_id = auth.uid());

-- Policy: Users can only insert their own subscriptions
CREATE POLICY push_subscriptions_user_insert 
  ON push_subscriptions 
  FOR INSERT 
  WITH CHECK (user_id = auth.uid() AND tenant_id = (
    SELECT tenant_id FROM trainees WHERE id = auth.uid()
  ));

-- Policy: Users can only update their own subscriptions
CREATE POLICY push_subscriptions_user_update 
  ON push_subscriptions 
  FOR UPDATE 
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Policy: Users can only delete their own subscriptions
CREATE POLICY push_subscriptions_user_delete 
  ON push_subscriptions 
  FOR DELETE 
  USING (user_id = auth.uid());

-- Admin policy: Admins can manage subscriptions in their tenant
CREATE POLICY push_subscriptions_admin_all 
  ON push_subscriptions 
  FOR ALL 
  USING (
    tenant_id IN (
      SELECT ut.tenant_id FROM users_tenants ut
      INNER JOIN users u ON u.id = ut.user_id
      WHERE u.id = auth.uid()
      AND u.role IN ('super_admin', 'local_admin')
    )
  );

COMMIT;
