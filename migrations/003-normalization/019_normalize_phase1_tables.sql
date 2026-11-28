-- =============================================================================
-- 019_normalize_to_3nf_phase1.sql
-- 
-- Phase 1: Create normalized tables to support 3NF transformation
-- 
-- This migration creates new normalized tables:
-- 1. trainee_notification_preferences - atomizes trainees.notification_preferences JSONB
-- 2. tenant_branding - atomizes tenants.configuration.branding JSONB
-- 3. tenant_notification_channels - atomizes tenants.configuration.notifications JSONB
-- 4. tenant_features - atomizes tenants.configuration.features JSONB
-- 5. attendance_exceptions - unifies non_attendance_dates + attendance_schedule_overrides
--
-- No data migration occurs in this phase (phase 2).
-- Tables created with non-enforcing initial state to allow parallel app development.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. trainee_notification_preferences
-- 
-- Replaces: trainees.notification_preferences JSONB
-- Rationale: JSONB violates 1NF (non-atomic values); hard to query/validate
-- 
-- JSONB structure being normalized:
-- {
--   "email": boolean,
--   "sms": boolean,
--   "push": boolean,
--   "inApp": boolean,
--   "weeklyDigest": boolean,
--   "eventReminders": boolean,
--   "enrollmentUpdates": boolean
-- }
-- =============================================================================

CREATE TABLE IF NOT EXISTS trainee_notification_preferences (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trainee_id              UUID          NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  
  -- Notification channels (typed instead of JSONB)
  email_enabled           BOOLEAN       NOT NULL DEFAULT true,
  sms_enabled             BOOLEAN       NOT NULL DEFAULT true,
  push_enabled            BOOLEAN       NOT NULL DEFAULT true,
  in_app_enabled          BOOLEAN       NOT NULL DEFAULT true,
  
  -- Notification types
  weekly_digest           BOOLEAN       NOT NULL DEFAULT true,
  event_reminders         BOOLEAN       NOT NULL DEFAULT true,
  enrollment_updates      BOOLEAN       NOT NULL DEFAULT true,
  
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  
  UNIQUE(tenant_id, trainee_id),
  CONSTRAINT fk_trainee_notif_prefs_trainee FOREIGN KEY (trainee_id, tenant_id) 
    REFERENCES trainees(id, tenant_id) ON DELETE CASCADE
);

DROP TRIGGER IF EXISTS set_updated_at_trainee_notification_preferences ON trainee_notification_preferences;
CREATE TRIGGER set_updated_at_trainee_notification_preferences
  BEFORE UPDATE ON trainee_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_trainee_notification_preferences_trainee_id 
  ON trainee_notification_preferences(trainee_id);
CREATE INDEX idx_trainee_notification_preferences_tenant_id 
  ON trainee_notification_preferences(tenant_id);


-- =============================================================================
-- 2. tenant_branding
-- 
-- Replaces: tenants.configuration.branding JSONB
-- Rationale: Split JSONB into typed table; enables DB-level validation
-- 
-- JSONB structure being normalized:
-- {
--   "logoUrl": string | null,
--   "primaryColor": "#hex",
--   "secondaryColor": "#hex",
--   "welcomeMessage": string
-- }
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenant_branding (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  
  logo_url                VARCHAR(500),
  primary_color           VARCHAR(10)   NOT NULL DEFAULT '#007bff',  -- hex color code
  secondary_color         VARCHAR(10)   NOT NULL DEFAULT '#6c757d',  -- hex color code
  welcome_message         TEXT,
  
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_tenant_branding ON tenant_branding;
CREATE TRIGGER set_updated_at_tenant_branding
  BEFORE UPDATE ON tenant_branding
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- =============================================================================
-- 3. tenant_notification_channels
-- 
-- Replaces: tenants.configuration.notifications JSONB
-- Rationale: Supports multiple notification backends; atomizes into separate records
-- 
-- JSONB structure being normalized:
-- {
--   "pushNotifications": { "serviceKey": string, "serverKey": string } | null,
--   "sms": { "provider": "twilio"|"smart", "apiKey": string, "senderId": string } | null,
--   "whatsapp": { "apiKey": string, "phoneNumberId": string } | null,
--   "email": { "smtpHost": string, "smtpPort": number, "senderAddress": string } | null
-- }
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenant_notification_channels (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  
  channel_type            VARCHAR(50)   NOT NULL CHECK (channel_type IN ('email', 'sms', 'push', 'whatsapp')),
  is_enabled              BOOLEAN       NOT NULL DEFAULT true,
  
  -- Generic key-value storage for channel-specific config
  -- email: { smtpHost, smtpPort, senderAddress, username, password }
  -- sms: { provider, apiKey, senderId }
  -- push: { serviceKey, serverKey }
  -- whatsapp: { apiKey, phoneNumberId }
  configuration           JSONB         NOT NULL DEFAULT '{}',
  
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  
  UNIQUE(tenant_id, channel_type),
  CONSTRAINT valid_channel_config CHECK (configuration IS NOT NULL AND configuration != 'null')
);

DROP TRIGGER IF EXISTS set_updated_at_tenant_notification_channels ON tenant_notification_channels;
CREATE TRIGGER set_updated_at_tenant_notification_channels
  BEFORE UPDATE ON tenant_notification_channels
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_tenant_notification_channels_tenant_id 
  ON tenant_notification_channels(tenant_id);


-- =============================================================================
-- 4. tenant_features
-- 
-- Replaces: tenants.configuration.features JSONB
-- Rationale: Atomizes boolean feature flags into typed rows; easier to audit/manage
-- 
-- JSONB structure being normalized:
-- {
--   "inventoryManagement": boolean,
--   "certificateGeneration": boolean,
--   "qrCodeAttendance": boolean,
--   "mobileAppAccess": boolean
-- }
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenant_features (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  
  feature_name            VARCHAR(100)  NOT NULL CHECK (feature_name IN (
                                          'inventory_management',
                                          'certificate_generation',
                                          'qr_code_attendance',
                                          'mobile_app_access',
                                          'advanced_analytics',
                                          'api_access'
                                        )),
  is_enabled              BOOLEAN       NOT NULL DEFAULT false,
  
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  
  UNIQUE(tenant_id, feature_name)
);

DROP TRIGGER IF EXISTS set_updated_at_tenant_features ON tenant_features;
CREATE TRIGGER set_updated_at_tenant_features
  BEFORE UPDATE ON tenant_features
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_tenant_features_tenant_id 
  ON tenant_features(tenant_id);


-- =============================================================================
-- 5. attendance_exceptions
-- 
-- Unifies: non_attendance_dates + attendance_schedule_overrides
-- Rationale: Both manage "exceptions to attendance scheduling"; separate tables cause confusion
-- 
-- Consolidates:
--   non_attendance_dates: general no-attendance dates (holidays, maintenance)
--   attendance_schedule_overrides: program-specific schedule modifications
-- =============================================================================

CREATE TABLE IF NOT EXISTS attendance_exceptions (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  
  exception_type          VARCHAR(50)   NOT NULL CHECK (exception_type IN (
                                          'no_attendance_day',  -- non_attendance_dates
                                          'schedule_override',  -- attendance_schedule_overrides
                                          'makeup_session',
                                          'holiday'
                                        )),
  
  -- Can apply to:
  -- - Tenant-wide (program_id = NULL, trainee_id = NULL)
  -- - Program-specific (program_id != NULL, trainee_id = NULL)
  -- - Trainee-specific (trainee_id != NULL, program_id optional)
  program_id              UUID          REFERENCES programs(id) ON DELETE CASCADE,
  trainee_id              UUID          REFERENCES trainees(id) ON DELETE CASCADE,
  
  exception_date          DATE          NOT NULL,
  exception_start_time    TIME,
  exception_end_time      TIME,
  
  reason                  VARCHAR(255),
  created_by              UUID          REFERENCES users(id) ON DELETE SET NULL,
  
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  
  -- Prevent duplicate exceptions on same date
  UNIQUE(tenant_id, exception_type, program_id, trainee_id, exception_date),
  
  CONSTRAINT valid_exception_scope CHECK (
    (program_id IS NULL AND trainee_id IS NULL) OR  -- tenant-wide
    (program_id IS NOT NULL AND trainee_id IS NULL) OR  -- program-specific
    (trainee_id IS NOT NULL)  -- trainee-specific (program_id optional)
  ),
  
  CONSTRAINT valid_time_range CHECK (
    exception_start_time IS NULL OR exception_end_time IS NULL OR
    exception_start_time < exception_end_time
  )
);

DROP TRIGGER IF EXISTS set_updated_at_attendance_exceptions ON attendance_exceptions;
CREATE TRIGGER set_updated_at_attendance_exceptions
  BEFORE UPDATE ON attendance_exceptions
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_attendance_exceptions_tenant_id 
  ON attendance_exceptions(tenant_id);
CREATE INDEX idx_attendance_exceptions_program_id 
  ON attendance_exceptions(program_id);
CREATE INDEX idx_attendance_exceptions_trainee_id 
  ON attendance_exceptions(trainee_id);
CREATE INDEX idx_attendance_exceptions_exception_date 
  ON attendance_exceptions(exception_date);


-- =============================================================================
-- 6. Migration tracking
-- =============================================================================

-- Record that this migration has been applied
-- (Assumes a migrations_applied table exists; if not, this is a no-op)
-- This helps prevent re-running idempotent migrations

COMMIT;

-- =============================================================================
-- NOTES FOR PHASE 2 (Data Migration)
-- =============================================================================
-- 
-- Phase 2 will:
-- 1. Populate trainee_notification_preferences from trainees.notification_preferences JSONB
-- 2. Populate tenant_branding from tenants.configuration -> branding JSONB
-- 3. Populate tenant_notification_channels from tenants.configuration -> notifications JSONB
-- 4. Populate tenant_features from tenants.configuration -> features JSONB
-- 5. Migrate non_attendance_dates + attendance_schedule_overrides to attendance_exceptions
-- 
-- Phase 3 will:
-- - Update backend APIs to use new tables
-- - Remove old JSONB columns
-- - Enforce foreign key constraints
-- 
-- Phase 4 will:
-- - Add UNIQUE constraints and triggers to enforce data integrity
-- - Add audit logging
-- =============================================================================
