-- =============================================================================
-- 021_normalize_to_3nf_phase2_data_migration.sql
-- 
-- Phase 2: Data migration from denormalized JSONB to normalized tables
-- 
-- This migration populates the new normalized tables with data from existing
-- JSONB columns and redundant tables. After this runs, the database contains
-- data in both old and new locations for a period (before Phase 3 cleanup).
--
-- Migration Steps:
-- 1. Populate trainee_notification_preferences from trainees.notification_preferences
-- 2. Populate tenant_branding from tenants.configuration -> branding
-- 3. Populate tenant_notification_channels from tenants.configuration -> notifications
-- 4. Populate tenant_features from tenants.configuration -> features
-- 5. Populate attendance_exceptions from non_attendance_dates + attendance_schedule_overrides
-- 6. Backfill pending_registrations data into trainees table with registration_status
--
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Populate trainee_notification_preferences from trainees JSONB
-- =============================================================================

INSERT INTO trainee_notification_preferences (
  tenant_id,
  trainee_id,
  email_enabled,
  sms_enabled,
  push_enabled,
  in_app_enabled,
  weekly_digest,
  event_reminders,
  enrollment_updates,
  created_at,
  updated_at
)
SELECT
  t.tenant_id,
  t.id,
  COALESCE((t.notification_preferences->>'emailEnabled')::boolean, true),
  COALESCE((t.notification_preferences->>'smsEnabled')::boolean, true),
  COALESCE((t.notification_preferences->>'pushEnabled')::boolean, true),
  COALESCE((t.notification_preferences->>'inAppEnabled')::boolean, true),
  COALESCE((t.notification_preferences->>'weeklyDigest')::boolean, true),
  COALESCE((t.notification_preferences->>'eventReminders')::boolean, true),
  COALESCE((t.notification_preferences->>'enrollmentUpdates')::boolean, true),
  NOW(),
  NOW()
FROM trainees t
WHERE t.notification_preferences IS NOT NULL
  AND t.notification_preferences != '{}'::jsonb
ON CONFLICT (tenant_id, trainee_id) DO UPDATE
SET
  email_enabled = EXCLUDED.email_enabled,
  sms_enabled = EXCLUDED.sms_enabled,
  push_enabled = EXCLUDED.push_enabled,
  in_app_enabled = EXCLUDED.in_app_enabled,
  weekly_digest = EXCLUDED.weekly_digest,
  event_reminders = EXCLUDED.event_reminders,
  enrollment_updates = EXCLUDED.enrollment_updates,
  updated_at = NOW();

-- For trainees without preferences, create default record
INSERT INTO trainee_notification_preferences (
  tenant_id,
  trainee_id,
  email_enabled,
  sms_enabled,
  push_enabled,
  in_app_enabled,
  weekly_digest,
  event_reminders,
  enrollment_updates,
  created_at,
  updated_at
)
SELECT
  t.tenant_id,
  t.id,
  true, true, true, true, true, true, true,
  NOW(),
  NOW()
FROM trainees t
WHERE NOT EXISTS (
  SELECT 1 FROM trainee_notification_preferences tnp
  WHERE tnp.trainee_id = t.id AND tnp.tenant_id = t.tenant_id
)
ON CONFLICT (tenant_id, trainee_id) DO NOTHING;

-- Log migration
INSERT INTO audit_logs (
  tenant_id,
  action,
  entity_type,
  entity_id,
  details,
  created_at
)
SELECT
  DISTINCT tenant_id,
  'migration.trainee_notification_preferences',
  'migration',
  'batch',
  jsonb_build_object('count', COUNT(*)),
  NOW()
FROM trainee_notification_preferences
GROUP BY tenant_id;


-- =============================================================================
-- 2. Populate tenant_branding from tenants.configuration
-- =============================================================================

INSERT INTO tenant_branding (
  tenant_id,
  logo_url,
  primary_color,
  secondary_color,
  welcome_message,
  created_at,
  updated_at
)
SELECT
  t.id,
  (t.configuration->'branding'->>'logoUrl'),
  COALESCE((t.configuration->'branding'->>'primaryColor'), '#007bff'),
  COALESCE((t.configuration->'branding'->>'secondaryColor'), '#6c757d'),
  COALESCE((t.configuration->'branding'->>'welcomeMessage'), ''),
  t.created_at,
  t.updated_at
FROM tenants t
WHERE t.configuration IS NOT NULL
  AND t.configuration->'branding' IS NOT NULL
ON CONFLICT (tenant_id) DO UPDATE
SET
  logo_url = EXCLUDED.logo_url,
  primary_color = EXCLUDED.primary_color,
  secondary_color = EXCLUDED.secondary_color,
  welcome_message = EXCLUDED.welcome_message,
  updated_at = NOW();

-- Ensure all tenants have branding record (with defaults)
INSERT INTO tenant_branding (
  tenant_id,
  logo_url,
  primary_color,
  secondary_color,
  welcome_message,
  created_at,
  updated_at
)
SELECT
  t.id,
  NULL,
  '#007bff',
  '#6c757d',
  '',
  NOW(),
  NOW()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_branding tb WHERE tb.tenant_id = t.id
)
ON CONFLICT (tenant_id) DO NOTHING;


-- =============================================================================
-- 3. Populate tenant_notification_channels from tenants.configuration
-- =============================================================================

-- Email channel
INSERT INTO tenant_notification_channels (
  tenant_id,
  channel_type,
  is_enabled,
  configuration,
  created_at,
  updated_at
)
SELECT
  t.id,
  'email',
  (t.configuration->'notifications'->>'email') IS NOT NULL,
  COALESCE(t.configuration->'notifications'->'email', '{}'),
  t.created_at,
  t.updated_at
FROM tenants t
WHERE t.configuration IS NOT NULL
  AND t.configuration->'notifications' IS NOT NULL
ON CONFLICT (tenant_id, channel_type) DO UPDATE
SET
  is_enabled = EXCLUDED.is_enabled,
  configuration = EXCLUDED.configuration,
  updated_at = NOW();

-- SMS/WhatsApp channel
INSERT INTO tenant_notification_channels (
  tenant_id,
  channel_type,
  is_enabled,
  configuration,
  created_at,
  updated_at
)
SELECT
  t.id,
  'sms',
  (t.configuration->'notifications'->>'whatsapp') IS NOT NULL,
  COALESCE(t.configuration->'notifications'->'whatsapp', '{}'),
  t.created_at,
  t.updated_at
FROM tenants t
WHERE t.configuration IS NOT NULL
  AND t.configuration->'notifications' IS NOT NULL
ON CONFLICT (tenant_id, channel_type) DO UPDATE
SET
  is_enabled = EXCLUDED.is_enabled,
  configuration = EXCLUDED.configuration,
  updated_at = NOW();

-- Push notification channel
INSERT INTO tenant_notification_channels (
  tenant_id,
  channel_type,
  is_enabled,
  configuration,
  created_at,
  updated_at
)
SELECT
  t.id,
  'push',
  (t.configuration->'notifications'->>'pushNotifications') IS NOT NULL,
  COALESCE(t.configuration->'notifications'->'pushNotifications', '{}'),
  t.created_at,
  t.updated_at
FROM tenants t
WHERE t.configuration IS NOT NULL
  AND t.configuration->'notifications' IS NOT NULL
ON CONFLICT (tenant_id, channel_type) DO UPDATE
SET
  is_enabled = EXCLUDED.is_enabled,
  configuration = EXCLUDED.configuration,
  updated_at = NOW();

-- WhatsApp channel (if separate)
INSERT INTO tenant_notification_channels (
  tenant_id,
  channel_type,
  is_enabled,
  configuration,
  created_at,
  updated_at
)
SELECT
  t.id,
  'whatsapp',
  (t.configuration->'notifications'->>'whatsapp') IS NOT NULL,
  COALESCE(t.configuration->'notifications'->'whatsapp', '{}'),
  t.created_at,
  t.updated_at
FROM tenants t
WHERE t.configuration IS NOT NULL
  AND t.configuration->'notifications' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM tenant_notification_channels tnc
    WHERE tnc.tenant_id = t.id AND tnc.channel_type = 'whatsapp'
  )
ON CONFLICT (tenant_id, channel_type) DO UPDATE
SET
  is_enabled = EXCLUDED.is_enabled,
  configuration = EXCLUDED.configuration,
  updated_at = NOW();


-- =============================================================================
-- 4. Populate tenant_features from tenants.configuration
-- =============================================================================

INSERT INTO tenant_features (
  tenant_id,
  feature_name,
  is_enabled,
  created_at,
  updated_at
)
SELECT
  t.id,
  'inventory_management',
  COALESCE((t.configuration->'features'->>'inventoryManagement')::boolean, false),
  t.created_at,
  t.updated_at
FROM tenants t
WHERE t.configuration IS NOT NULL
  AND t.configuration->'features' IS NOT NULL
ON CONFLICT (tenant_id, feature_name) DO UPDATE
SET
  is_enabled = EXCLUDED.is_enabled,
  updated_at = NOW();

INSERT INTO tenant_features (
  tenant_id,
  feature_name,
  is_enabled,
  created_at,
  updated_at
)
SELECT
  t.id,
  'certificate_generation',
  COALESCE((t.configuration->'features'->>'certificateGeneration')::boolean, false),
  t.created_at,
  t.updated_at
FROM tenants t
WHERE t.configuration IS NOT NULL
  AND t.configuration->'features' IS NOT NULL
ON CONFLICT (tenant_id, feature_name) DO UPDATE
SET
  is_enabled = EXCLUDED.is_enabled,
  updated_at = NOW();

INSERT INTO tenant_features (
  tenant_id,
  feature_name,
  is_enabled,
  created_at,
  updated_at
)
SELECT
  t.id,
  'qr_code_attendance',
  COALESCE((t.configuration->'features'->>'qrCodeAttendance')::boolean, false),
  t.created_at,
  t.updated_at
FROM tenants t
WHERE t.configuration IS NOT NULL
  AND t.configuration->'features' IS NOT NULL
ON CONFLICT (tenant_id, feature_name) DO UPDATE
SET
  is_enabled = EXCLUDED.is_enabled,
  updated_at = NOW();

INSERT INTO tenant_features (
  tenant_id,
  feature_name,
  is_enabled,
  created_at,
  updated_at
)
SELECT
  t.id,
  'mobile_app_access',
  COALESCE((t.configuration->'features'->>'mobileAppAccess')::boolean, false),
  t.created_at,
  t.updated_at
FROM tenants t
WHERE t.configuration IS NOT NULL
  AND t.configuration->'features' IS NOT NULL
ON CONFLICT (tenant_id, feature_name) DO UPDATE
SET
  is_enabled = EXCLUDED.is_enabled,
  updated_at = NOW();


-- =============================================================================
-- 5. Populate attendance_exceptions from legacy tables
-- =============================================================================

-- Migrate non_attendance_dates
INSERT INTO attendance_exceptions (
  tenant_id,
  exception_type,
  program_id,
  trainee_id,
  exception_date,
  reason,
  created_at,
  updated_at
)
SELECT
  nad.tenant_id,
  'no_attendance_day',
  nad.program_id,
  NULL,  -- non_attendance_dates are program-wide or tenant-wide
  nad.date,
  nad.reason,
  nad.created_at,
  nad.updated_at
FROM non_attendance_dates nad
ON CONFLICT DO NOTHING;

-- Migrate attendance_schedule_overrides
INSERT INTO attendance_exceptions (
  tenant_id,
  exception_type,
  program_id,
  trainee_id,
  exception_date,
  exception_start_time,
  exception_end_time,
  reason,
  created_at,
  updated_at
)
SELECT
  aso.tenant_id,
  'schedule_override',
  aso.program_id,
  aso.trainee_id,
  aso.override_date,
  aso.start_time,
  aso.end_time,
  aso.reason,
  aso.created_at,
  aso.updated_at
FROM attendance_schedule_overrides aso
ON CONFLICT DO NOTHING;


-- =============================================================================
-- 6. Backfill pending_registrations data into trainees
-- =============================================================================

-- Update trainees table with registration_status from pending_registrations
UPDATE trainees t
SET
  registration_status = CASE
    WHEN pr.status = 'pending' THEN 'pending'
    WHEN pr.status = 'approved' THEN 'approved'
    WHEN pr.status = 'rejected' THEN 'rejected'
    ELSE 'completed'
  END,
  registration_rejection_reason = pr.rejection_reason,
  registration_reviewed_by = pr.reviewed_by,
  registration_reviewed_at = pr.reviewed_at,
  updated_at = NOW()
FROM pending_registrations pr
WHERE pr.email = t.email
  AND pr.tenant_id = t.tenant_id
  AND t.registration_status = 'completed'  -- Only update if not already set
  AND pr.status IN ('pending', 'rejected');

-- All other trainees have registration_status = 'completed' (set as default in migration 020)


COMMIT;

-- =============================================================================
-- POST-MIGRATION VERIFICATION
-- =============================================================================
--
-- Run these queries to verify data migration:
--
-- 1. Check trainee_notification_preferences population:
--    SELECT COUNT(*) as total_prefs FROM trainee_notification_preferences;
--
-- 2. Check tenant_branding population:
--    SELECT COUNT(*) as total_branding FROM tenant_branding;
--
-- 3. Check tenant_notification_channels population:
--    SELECT COUNT(*) as total_channels FROM tenant_notification_channels;
--
-- 4. Check tenant_features population:
--    SELECT COUNT(*) as total_features FROM tenant_features;
--
-- 5. Check attendance_exceptions population:
--    SELECT COUNT(*) as total_exceptions FROM attendance_exceptions;
--
-- 6. Check pending_registrations merged into trainees:
--    SELECT COUNT(*) as pending_count FROM trainees WHERE registration_status = 'pending';
--    SELECT COUNT(*) as rejected_count FROM trainees WHERE registration_status = 'rejected';
--
-- =============================================================================
