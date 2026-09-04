-- =============================================================================
-- Normalize_full_schema.sql
-- 
-- Multi-Tenant LGU System — Complete Database Schema (3NF Normalized)
--
-- This file creates the entire database from scratch with full 3NF normalization
-- applied. It consolidates:
--   - full_schema.sql (baseline: migrations 001-013)
--   - 019_normalize_to_3nf_phase1.sql (new normalized tables)
--   - 020_normalize_to_3nf_phase1_constraints.sql (constraints & indexes)
--   - 023_normalize_to_3nf_phase4_enforcement.sql (triggers & functions)
--
-- 3NF Normalization Changes vs. full_schema.sql:
--   REMOVED: trainees.program_id, trainees.enrollment_date
--   REMOVED: trainees.notification_preferences JSONB
--   REMOVED: tenants.configuration.branding, .features, .notifications (JSONB keys)
--   REMOVED: non_attendance_dates table
--   REMOVED: attendance_schedule_overrides table
--
--   ADDED: trainee_notification_preferences table (7 typed columns)
--   ADDED: tenant_branding table (4 columns)
--   ADDED: tenant_notification_channels table (channel-specific)
--   ADDED: tenant_features table (feature flag rows)
--   ADDED: attendance_exceptions table (unified exception type)
--   ADDED: trainees.registration_status, registration_rejection_reason, 
--          registration_reviewed_by, registration_reviewed_at (for pending_registrations merge)
--   ADDED: Comprehensive trigger enforcement and audit logging
--   ADDED: 12 new performance indexes
--
-- For fresh installations, this is the recommended schema file.
-- For existing databases, use numbered migration files (019-023) instead.
--
-- Run order:
--   1.  Extensions
--   2.  Utility functions & triggers
--   3.  Platform-wide tables (tenants, users, users_tenants)
--   4.  Tenant-scoped tables (programs, trainees, items)
--   5.  Multi-tenant tables (enrollments, attendance, certificates)
--   6.  Normalized tables (trainee_notification_preferences, tenant_branding, etc.)
--   7.  Audit & governance tables
--   8.  Email system tables
--   9.  Indexes (base + normalized)
--   10. Row-Level Security
--   11. Carried-over tables (instructors, lendings, etc.)
--   12. Platform auth tables
--   13. Enforcement triggers (registration, enrollment, attendance)
--   14. Audit logging functions
--   15. Helper & validation functions
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. EXTENSIONS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =============================================================================
-- 2. UTILITY FUNCTIONS & TRIGGERS
-- =============================================================================

-- Automatically updates the updated_at column on every row modification
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- =============================================================================
-- 3. PLATFORM-WIDE TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenants (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255)  UNIQUE NOT NULL,
  status        VARCHAR(20)   NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'inactive', 'suspended')),
  contact_email VARCHAR(255)  NOT NULL,
  contact_phone VARCHAR(50),
  address       TEXT,
  -- JSONB now only contains announcements; branding/features/notifications split into tables
  configuration JSONB         NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_tenants ON tenants;
CREATE TRIGGER set_updated_at_tenants
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


CREATE TABLE IF NOT EXISTS users (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255)  UNIQUE NOT NULL,
  username      VARCHAR(255)  UNIQUE NOT NULL,
  password_hash VARCHAR(255)  NOT NULL,
  role          VARCHAR(50)   NOT NULL
                              CHECK (role IN (
                                'super_admin',
                                'local_admin',
                                'staff_training_coordinator',
                                'staff_inventory_manager',
                                'trainee'
                              )),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_users ON users;
CREATE TRIGGER set_updated_at_users
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


CREATE TABLE IF NOT EXISTS users_tenants (
  user_id    UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  is_primary BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, tenant_id)
);


-- =============================================================================
-- 4. TENANT-SCOPED TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS programs (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           VARCHAR(255)  NOT NULL,
  description    TEXT,
  duration_weeks INTEGER       NOT NULL,
  start_date     DATE          NOT NULL,
  end_date       DATE          NOT NULL,
  status         VARCHAR(20)   NOT NULL
                               CHECK (status IN ('active', 'completed', 'upcoming', 'cancelled')),
  max_trainees   INTEGER       NOT NULL,
  instructor     VARCHAR(255),
  level          VARCHAR(50)   CHECK (level IN ('Beginner', 'Intermediate', 'Advanced', 'All Levels')),
  image_path     VARCHAR(500),
  thumbnail_path VARCHAR(500),
  enrollment_limit INTEGER      CHECK (enrollment_limit IS NULL OR (enrollment_limit >= 1 AND enrollment_limit <= 10000)),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

DROP TRIGGER IF EXISTS set_updated_at_programs ON programs;
CREATE TRIGGER set_updated_at_programs
  BEFORE UPDATE ON programs
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


CREATE TABLE IF NOT EXISTS trainees (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  user_id                 UUID          REFERENCES users(id)              ON DELETE SET NULL,
  first_name              VARCHAR(255)  NOT NULL,
  last_name               VARCHAR(255)  NOT NULL,
  middle_name             VARCHAR(255),
  email                   VARCHAR(255)  NOT NULL,
  phone                   VARCHAR(50)   NOT NULL,
  sex                     VARCHAR(10)   NOT NULL CHECK (sex IN ('Male', 'Female')),
  birth_date              DATE          NOT NULL,
  birth_place             VARCHAR(255),
  civil_status            VARCHAR(20)   CHECK (civil_status IN ('Single', 'Married', 'Widowed', 'Separated')),
  province                VARCHAR(255),
  municipality            VARCHAR(255),
  barangay                VARCHAR(255),
  street                  VARCHAR(255),
  educational_attainment  VARCHAR(50),
  course                  VARCHAR(255),
  year_graduated          VARCHAR(10),
  classification          VARCHAR(50),
  disability              VARCHAR(255),
  employment_status       VARCHAR(50),
  -- NOTE: program_id and enrollment_date REMOVED (3NF normalization)
  -- Enrollment relationship now exclusively via enrollments table
  qr_code                 VARCHAR(255)  UNIQUE NOT NULL,
  photo_path              VARCHAR(500),
  thumbnail_path          VARCHAR(500),
  qr_code_path            VARCHAR(500),
  emergency_contact_name  VARCHAR(255),
  emergency_contact_phone VARCHAR(50),
  status                  VARCHAR(20)   NOT NULL DEFAULT 'active'
                                        CHECK (status IN ('active', 'inactive', 'completed', 'dropped')),
  -- RA 10173 consent fields
  consent_given           BOOLEAN       NOT NULL DEFAULT false,
  consent_timestamp       TIMESTAMPTZ,
  consent_version         VARCHAR(50),
  -- NOTE: notification_preferences JSONB REMOVED (3NF normalization)
  -- Preferences now in trainee_notification_preferences table
  -- OTP & 2FA fields
  is_verified             BOOLEAN       NOT NULL DEFAULT false,
  notify_on_program_posting BOOLEAN     NOT NULL DEFAULT true,
  -- Registration status fields (replaces pending_registrations duplication)
  registration_status     VARCHAR(50)   NOT NULL DEFAULT 'completed'
                                        CHECK (registration_status IN ('pending', 'approved', 'rejected', 'completed')),
  registration_rejection_reason TEXT,
  registration_reviewed_by UUID         REFERENCES users(id) ON DELETE SET NULL,
  registration_reviewed_at TIMESTAMPTZ,
  -- Soft delete support
  deleted_at              TIMESTAMPTZ   DEFAULT NULL,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);

DROP TRIGGER IF EXISTS set_updated_at_trainees ON trainees;
CREATE TRIGGER set_updated_at_trainees
  BEFORE UPDATE ON trainees
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


CREATE TABLE IF NOT EXISTS items (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name               VARCHAR(255)  NOT NULL,
  description        TEXT,
  category           VARCHAR(100)  NOT NULL,
  quantity           INTEGER       NOT NULL DEFAULT 0,
  available_quantity INTEGER       NOT NULL DEFAULT 0,
  unit               VARCHAR(50)   NOT NULL,
  location           VARCHAR(255),
  qr_code            VARCHAR(255)  UNIQUE NOT NULL,
  image_path         VARCHAR(500),
  thumbnail_path     VARCHAR(500),
  qr_code_path       VARCHAR(500),
  status             VARCHAR(20)   NOT NULL
                                   CHECK (status IN ('available', 'low_stock', 'out_of_stock', 'maintenance')),
  minimum_quantity   INTEGER       NOT NULL DEFAULT 0,
  purchase_date      DATE,
  condition          VARCHAR(20)   CHECK (condition IN ('New', 'Good', 'Fair', 'Poor', 'Damaged')),
  created_by         UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

DROP TRIGGER IF EXISTS set_updated_at_items ON items;
CREATE TRIGGER set_updated_at_items
  BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- =============================================================================
-- 5. MULTI-TENANT TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS enrollments (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  trainee_id      UUID          NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  program_id      UUID          NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  enrollment_date DATE          NOT NULL,
  completion_date DATE,
  status          VARCHAR(20)   NOT NULL DEFAULT 'enrolled'
                                CHECK (status IN ('enrolled', 'active', 'completed', 'dropped', 'failed')),
  source          VARCHAR(50)   NOT NULL DEFAULT 'direct'
                                CHECK (source IN ('social_share', 'direct', 'admin_assigned')),
  final_grade     DECIMAL(5,2),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (trainee_id, program_id)
);

DROP TRIGGER IF EXISTS set_updated_at_enrollments ON enrollments;
CREATE TRIGGER set_updated_at_enrollments
  BEFORE UPDATE ON enrollments
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


CREATE TABLE IF NOT EXISTS attendance (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID          NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  session_id             UUID          NOT NULL,
  trainee_id             UUID          NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  status                 VARCHAR(20)   NOT NULL
                                       CHECK (status IN ('present', 'absent', 'late', 'excused')),
  check_in_time          TIMESTAMPTZ,
  check_out_time         TIMESTAMPTZ,
  scanned_by             UUID          REFERENCES users(id) ON DELETE SET NULL,
  notes                  TEXT,
  selfie_morning_path    VARCHAR(500),
  selfie_afternoon_path  VARCHAR(500),
  morning_time_in        TIMESTAMPTZ,
  afternoon_time_out     TIMESTAMPTZ,
  late_duration_minutes  INTEGER,
  morning_status         VARCHAR(20)   CHECK (morning_status   IN ('present', 'late', 'absent', 'pending')),
  afternoon_status       VARCHAR(20)   CHECK (afternoon_status IN ('present', 'late', 'absent', 'pending')),
  gps_lat                DECIMAL(10, 7),
  gps_lng                DECIMAL(10, 7),
  gps_accuracy           DECIMAL(8, 2),
  gps_address            TEXT,
  device_info            JSONB,
  submission_method      VARCHAR(20)   DEFAULT 'manual'
                                       CHECK (submission_method IN ('self_service', 'manual', 'qr_scan')),
  attempt_number         INTEGER       DEFAULT 1,
  verified_by            UUID          REFERENCES users(id) ON DELETE SET NULL,
  verified_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, trainee_id)
);

DROP TRIGGER IF EXISTS set_updated_at_attendance ON attendance;
CREATE TRIGGER set_updated_at_attendance
  BEFORE UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


CREATE TABLE IF NOT EXISTS certificates (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  enrollment_id      UUID          NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  certificate_number VARCHAR(100)  UNIQUE NOT NULL,
  issue_date         DATE          NOT NULL,
  file_path          VARCHAR(500)  NOT NULL,
  qr_code            VARCHAR(255)  UNIQUE NOT NULL,
  qr_code_path       VARCHAR(500),
  verification_url   VARCHAR(500),
  signatory_name     VARCHAR(255),
  signatory_title    VARCHAR(255),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_certificates ON certificates;
CREATE TRIGGER set_updated_at_certificates
  BEFORE UPDATE ON certificates
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- =============================================================================
-- 6. 3NF NORMALIZED TABLES
--    These replace JSONB columns and redundant tables from full_schema.sql
-- =============================================================================

-- Temporary storage for trainee passwords during registration flow
-- When a trainee registers, their password is hashed and stored here
-- During approval, it's moved to users.password_hash and this record is deleted
-- This ensures passwords are only stored in the users table
CREATE TABLE IF NOT EXISTS pending_registration_passwords (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id        UUID          NOT NULL UNIQUE REFERENCES trainees(id) ON DELETE CASCADE,
  password_hash     VARCHAR(255)  NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index for quick lookup by trainee_id during approval
CREATE INDEX IF NOT EXISTS idx_pending_passwords_trainee_id 
ON pending_registration_passwords(trainee_id);


-- Replaces: trainees.notification_preferences JSONB (1NF violation)
CREATE TABLE IF NOT EXISTS trainee_notification_preferences (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trainee_id              UUID          NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  email_enabled           BOOLEAN       NOT NULL DEFAULT true,
  sms_enabled             BOOLEAN       NOT NULL DEFAULT true,
  push_enabled            BOOLEAN       NOT NULL DEFAULT true,
  in_app_enabled          BOOLEAN       NOT NULL DEFAULT true,
  weekly_digest           BOOLEAN       NOT NULL DEFAULT true,
  event_reminders         BOOLEAN       NOT NULL DEFAULT true,
  enrollment_updates      BOOLEAN       NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, trainee_id)
);

DROP TRIGGER IF EXISTS set_updated_at_trainee_notification_preferences ON trainee_notification_preferences;
CREATE TRIGGER set_updated_at_trainee_notification_preferences
  BEFORE UPDATE ON trainee_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- Replaces: tenants.configuration.branding JSONB (1NF violation)
CREATE TABLE IF NOT EXISTS tenant_branding (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  logo_url                VARCHAR(500),
  primary_color           VARCHAR(10)   NOT NULL DEFAULT '#007bff',
  secondary_color         VARCHAR(10)   NOT NULL DEFAULT '#6c757d',
  welcome_message         TEXT,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_tenant_branding ON tenant_branding;
CREATE TRIGGER set_updated_at_tenant_branding
  BEFORE UPDATE ON tenant_branding
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- Replaces: tenants.configuration.notifications JSONB (1NF violation)
CREATE TABLE IF NOT EXISTS tenant_notification_channels (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_type            VARCHAR(50)   NOT NULL CHECK (channel_type IN ('email', 'sms', 'push', 'whatsapp')),
  is_enabled              BOOLEAN       NOT NULL DEFAULT true,
  configuration           JSONB         NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, channel_type)
);

DROP TRIGGER IF EXISTS set_updated_at_tenant_notification_channels ON tenant_notification_channels;
CREATE TRIGGER set_updated_at_tenant_notification_channels
  BEFORE UPDATE ON tenant_notification_channels
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- Replaces: tenants.configuration.features JSONB (1NF violation)
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

-- =============================================================================
-- 9. ATTENDANCE SCHEDULES
-- =============================================================================
-- Defines program-specific attendance windows (morning/afternoon time slots)
-- One schedule per program, effective date range may span multiple years
-- Enables flexible attendance tracking for different programs
-- =============================================================================

CREATE TABLE IF NOT EXISTS attendance_schedules (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  program_id              UUID          NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  name                    VARCHAR(255)  NOT NULL,
  effective_date_start    DATE          NOT NULL,
  effective_date_end      DATE,
  morning_open            TIME          NOT NULL,
  morning_close           TIME          NOT NULL,
  morning_late_threshold  INTEGER       DEFAULT 15,
  afternoon_open          TIME          NOT NULL,
  afternoon_close         TIME          NOT NULL,
  afternoon_late_threshold INTEGER      DEFAULT 15,
  status                  VARCHAR(50)   NOT NULL DEFAULT 'active'
                                        CHECK (status IN ('active', 'inactive', 'archived')),
  created_by              UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT check_morning_times CHECK (morning_close > morning_open),
  CONSTRAINT check_afternoon_times CHECK (afternoon_close > afternoon_open),
  CONSTRAINT check_date_range CHECK (effective_date_end IS NULL OR effective_date_end >= effective_date_start),
  UNIQUE (program_id, effective_date_start, effective_date_end)
);

DROP TRIGGER IF EXISTS set_updated_at_attendance_schedules ON attendance_schedules;
CREATE TRIGGER set_updated_at_attendance_schedules
  BEFORE UPDATE ON attendance_schedules
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Unifies: non_attendance_dates + attendance_schedule_overrides (2NF violation)
CREATE TABLE IF NOT EXISTS attendance_exceptions (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  exception_type          VARCHAR(50)   NOT NULL CHECK (exception_type IN (
                                          'no_attendance_day',
                                          'schedule_override',
                                          'makeup_session',
                                          'holiday'
                                        )),
  program_id              UUID          REFERENCES programs(id) ON DELETE CASCADE,
  trainee_id              UUID          REFERENCES trainees(id) ON DELETE CASCADE,
  exception_date          DATE          NOT NULL,
  exception_start_time    TIME,
  exception_end_time      TIME,
  reason                  VARCHAR(255),
  created_by              UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, exception_type, program_id, trainee_id, exception_date),
  CONSTRAINT valid_exception_scope CHECK (
    (program_id IS NULL AND trainee_id IS NULL) OR
    (program_id IS NOT NULL AND trainee_id IS NULL) OR
    (trainee_id IS NOT NULL)
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


-- =============================================================================
-- 7. EMAIL OTP & BATCH NOTIFICATION SYSTEM TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS email_verifications (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255)  NOT NULL,
  phone         VARCHAR(20),
  code          VARCHAR(6)    NOT NULL,
  method        VARCHAR(20)   NOT NULL DEFAULT 'email'
                              CHECK (method IN ('email', 'whatsapp', 'both')),
  type          VARCHAR(50)   NOT NULL DEFAULT 'email'
                              CHECK (type IN ('2fa', 'password_reset', 'email_change', 'email')),
  expires_at    TIMESTAMPTZ   NOT NULL,
  verified_at   TIMESTAMPTZ,
  user_id       UUID          REFERENCES users(id) ON DELETE SET NULL,
  trainee_id    UUID          REFERENCES trainees(id) ON DELETE SET NULL,
  attempt_count INT           NOT NULL DEFAULT 0,
  max_attempts  INT           NOT NULL DEFAULT 5,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE email_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Email verifications allow insert" ON email_verifications FOR INSERT WITH CHECK (true);
CREATE POLICY "Email verifications allow update" ON email_verifications FOR UPDATE USING (true) WITH CHECK (true);


CREATE TABLE IF NOT EXISTS email_batch_jobs (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  batch_type            VARCHAR(100)  NOT NULL 
                                      CHECK (batch_type IN (
                                        'program_notification',
                                        'bulk_announcement',
                                        'training_reminder',
                                        'other'
                                      )),
  reference_id          VARCHAR(255),
  total_recipients      INT           NOT NULL DEFAULT 0,
  sent_count            INT           NOT NULL DEFAULT 0,
  failed_count          INT           NOT NULL DEFAULT 0,
  skipped_count         INT           NOT NULL DEFAULT 0,
  status                VARCHAR(20)   NOT NULL DEFAULT 'pending'
                                      CHECK (status IN (
                                        'pending',
                                        'processing',
                                        'completed',
                                        'failed',
                                        'paused'
                                      )),
  error_reason          TEXT,
  rate_limit_rps        INT           DEFAULT 10,
  retry_failed_sends    BOOLEAN       DEFAULT true,
  created_by            UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_email_batch_jobs ON email_batch_jobs;
CREATE TRIGGER set_updated_at_email_batch_jobs
  BEFORE UPDATE ON email_batch_jobs
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE email_batch_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_email_batch_jobs ON email_batch_jobs;
CREATE POLICY tenant_isolation_email_batch_jobs ON email_batch_jobs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);


CREATE TABLE IF NOT EXISTS email_send_history (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_job_id      UUID          NOT NULL REFERENCES email_batch_jobs(id) ON DELETE CASCADE,
  recipient_email   VARCHAR(255)  NOT NULL,
  template_name     VARCHAR(100)  NOT NULL,
  send_status       VARCHAR(20)   NOT NULL DEFAULT 'pending'
                                  CHECK (send_status IN (
                                    'pending',
                                    'sent',
                                    'failed',
                                    'skipped',
                                    'deferred'
                                  )),
  smtp_response_code INT,
  error_message     TEXT,
  attempts          INT           NOT NULL DEFAULT 0,
  last_attempt_at   TIMESTAMPTZ,
  next_retry_at     TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_email_send_history ON email_send_history;
CREATE TRIGGER set_updated_at_email_send_history
  BEFORE UPDATE ON email_send_history
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE email_send_history ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- 8. AUDIT & GOVERNANCE TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID          REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID          REFERENCES users(id)   ON DELETE SET NULL,
  action      VARCHAR(100)  NOT NULL,
  entity_type VARCHAR(100)  NOT NULL,
  entity_id   TEXT,
  details     JSONB,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID          REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      VARCHAR(100)  NOT NULL,
  entity_type VARCHAR(100)  NOT NULL,
  entity_id   TEXT          NOT NULL,
  details     JSONB,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_flags (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature_key   VARCHAR(100)  NOT NULL,
  enabled       BOOLEAN       NOT NULL DEFAULT false,
  configuration JSONB,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, feature_key)
);

DROP TRIGGER IF EXISTS set_updated_at_feature_flags ON feature_flags;
CREATE TRIGGER set_updated_at_feature_flags
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS extension_requests (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by           UUID          NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  title                  VARCHAR(255)  NOT NULL,
  description            TEXT          NOT NULL,
  business_justification TEXT,
  priority               VARCHAR(20)   NOT NULL
                                       CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status                 VARCHAR(20)   NOT NULL DEFAULT 'submitted'
                                       CHECK (status IN (
                                         'submitted',
                                         'under_review',
                                         'approved',
                                         'in_development',
                                         'deployed',
                                         'rejected'
                                       )),
  affected_users_count   INTEGER,
  reviewed_by            UUID          REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at            TIMESTAMPTZ,
  review_notes           TEXT,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_extension_requests ON extension_requests;
CREATE TRIGGER set_updated_at_extension_requests
  BEFORE UPDATE ON extension_requests
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- =============================================================================
-- 9. INDEXES - BASE TABLES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_tenants_name   ON tenants(name);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);

CREATE INDEX IF NOT EXISTS idx_users_tenants_user   ON users_tenants(user_id);
CREATE INDEX IF NOT EXISTS idx_users_tenants_tenant ON users_tenants(tenant_id);

CREATE INDEX IF NOT EXISTS idx_programs_tenant        ON programs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_programs_tenant_status ON programs(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_programs_tenant_dates  ON programs(tenant_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_trainees_tenant         ON trainees(tenant_id);
CREATE INDEX IF NOT EXISTS idx_trainees_tenant_status  ON trainees(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_trainees_qr             ON trainees(qr_code);
CREATE INDEX IF NOT EXISTS idx_trainees_is_verified    ON trainees(tenant_id, is_verified);
CREATE INDEX IF NOT EXISTS idx_trainees_deleted_at     ON trainees(deleted_at);
CREATE INDEX IF NOT EXISTS idx_trainees_tenant_deleted ON trainees(tenant_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_trainees_registration_status ON trainees(tenant_id, registration_status) 
  WHERE registration_status IN ('pending', 'rejected');

CREATE INDEX IF NOT EXISTS idx_items_tenant          ON items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_items_tenant_category ON items(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_items_tenant_status   ON items(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_items_qr              ON items(qr_code);

CREATE INDEX IF NOT EXISTS idx_enrollments_tenant   ON enrollments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_trainee  ON enrollments(tenant_id, trainee_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_program  ON enrollments(tenant_id, program_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status   ON enrollments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_enrollments_trainee_status ON enrollments(trainee_id, status)
  WHERE status IN ('enrolled', 'active');

CREATE INDEX IF NOT EXISTS idx_attendance_tenant   ON attendance(tenant_id);
CREATE INDEX IF NOT EXISTS idx_attendance_session  ON attendance(tenant_id, session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_trainee  ON attendance(tenant_id, trainee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_status   ON attendance(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_certificates_tenant     ON certificates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_certificates_enrollment ON certificates(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_certificates_number     ON certificates(certificate_number);
CREATE INDEX IF NOT EXISTS idx_certificates_qr         ON certificates(qr_code);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant         ON audit_logs(tenant_id)         WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created ON audit_logs(tenant_id, created_at) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_user           ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created        ON audit_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_activity_logs_tenant  ON activity_logs(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activity_logs_user    ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_feature_flags_tenant ON feature_flags(tenant_id);
CREATE INDEX IF NOT EXISTS idx_feature_flags_key    ON feature_flags(feature_key);

CREATE INDEX IF NOT EXISTS idx_extension_requests_tenant   ON extension_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_extension_requests_status   ON extension_requests(status);
CREATE INDEX IF NOT EXISTS idx_extension_requests_priority ON extension_requests(priority);


-- =============================================================================
-- 10. INDEXES - NORMALIZED TABLES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_trainee_notification_preferences_trainee_id 
  ON trainee_notification_preferences(trainee_id);
CREATE INDEX IF NOT EXISTS idx_trainee_notification_preferences_tenant_id 
  ON trainee_notification_preferences(tenant_id);

CREATE INDEX IF NOT EXISTS idx_tenant_notification_channels_tenant_id 
  ON tenant_notification_channels(tenant_id);

CREATE INDEX IF NOT EXISTS idx_tenant_features_tenant_id 
  ON tenant_features(tenant_id);

CREATE INDEX IF NOT EXISTS idx_attendance_exceptions_tenant_id 
  ON attendance_exceptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_attendance_exceptions_program_id 
  ON attendance_exceptions(program_id);
CREATE INDEX IF NOT EXISTS idx_attendance_exceptions_trainee_id 
  ON attendance_exceptions(trainee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_exceptions_exception_date 
  ON attendance_exceptions(exception_date);

CREATE INDEX IF NOT EXISTS idx_email_verifications_email 
  ON email_verifications(email);
CREATE INDEX IF NOT EXISTS idx_email_verifications_type_expiry 
  ON email_verifications(email, type, expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verifications_trainee_type 
  ON email_verifications(trainee_id, type);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user_type 
  ON email_verifications(user_id, type);
CREATE INDEX IF NOT EXISTS idx_email_verifications_expires_at 
  ON email_verifications(expires_at);

CREATE INDEX IF NOT EXISTS idx_email_batch_jobs_tenant_status 
  ON email_batch_jobs(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_email_batch_jobs_reference 
  ON email_batch_jobs(reference_id);
CREATE INDEX IF NOT EXISTS idx_email_batch_jobs_created 
  ON email_batch_jobs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_send_history_batch_status 
  ON email_send_history(batch_job_id, send_status);
CREATE INDEX IF NOT EXISTS idx_email_send_history_email 
  ON email_send_history(recipient_email);
CREATE INDEX IF NOT EXISTS idx_email_send_history_retry 
  ON email_send_history(next_retry_at) 
  WHERE send_status = 'failed' AND next_retry_at IS NOT NULL;


-- =============================================================================
-- 11. ROW-LEVEL SECURITY
-- =============================================================================

ALTER TABLE programs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainees           ENABLE ROW LEVEL SECURITY;
ALTER TABLE items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance         ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags      ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_requests ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policies
DROP POLICY IF EXISTS tenant_isolation_programs ON programs;
CREATE POLICY tenant_isolation_programs ON programs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_trainees ON trainees;
CREATE POLICY tenant_isolation_trainees ON trainees
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_items ON items;
CREATE POLICY tenant_isolation_items ON items
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_enrollments ON enrollments;
CREATE POLICY tenant_isolation_enrollments ON enrollments
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_attendance ON attendance;
CREATE POLICY tenant_isolation_attendance ON attendance
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_certificates ON certificates;
CREATE POLICY tenant_isolation_certificates ON certificates
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_audit_logs ON audit_logs;
CREATE POLICY tenant_isolation_audit_logs ON audit_logs
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)::uuid
    OR tenant_id IS NULL
  );

DROP POLICY IF EXISTS tenant_isolation_feature_flags ON feature_flags;
CREATE POLICY tenant_isolation_feature_flags ON feature_flags
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_extension_requests ON extension_requests;
CREATE POLICY tenant_isolation_extension_requests ON extension_requests
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Super Admin bypass policies (allow if app.is_super_admin = 'true')
DROP POLICY IF EXISTS super_admin_bypass_programs ON programs;
CREATE POLICY super_admin_bypass_programs ON programs
  USING (current_setting('app.is_super_admin', true)::boolean = true);

DROP POLICY IF EXISTS super_admin_bypass_trainees ON trainees;
CREATE POLICY super_admin_bypass_trainees ON trainees
  USING (current_setting('app.is_super_admin', true)::boolean = true);

DROP POLICY IF EXISTS super_admin_bypass_items ON items;
CREATE POLICY super_admin_bypass_items ON items
  USING (current_setting('app.is_super_admin', true)::boolean = true);

DROP POLICY IF EXISTS super_admin_bypass_enrollments ON enrollments;
CREATE POLICY super_admin_bypass_enrollments ON enrollments
  USING (current_setting('app.is_super_admin', true)::boolean = true);

DROP POLICY IF EXISTS super_admin_bypass_attendance ON attendance;
CREATE POLICY super_admin_bypass_attendance ON attendance
  USING (current_setting('app.is_super_admin', true)::boolean = true);

DROP POLICY IF EXISTS super_admin_bypass_certificates ON certificates;
CREATE POLICY super_admin_bypass_certificates ON certificates
  USING (current_setting('app.is_super_admin', true)::boolean = true);

DROP POLICY IF EXISTS super_admin_bypass_audit_logs ON audit_logs;
CREATE POLICY super_admin_bypass_audit_logs ON audit_logs
  USING (current_setting('app.is_super_admin', true)::boolean = true);

DROP POLICY IF EXISTS super_admin_bypass_feature_flags ON feature_flags;
CREATE POLICY super_admin_bypass_feature_flags ON feature_flags
  USING (current_setting('app.is_super_admin', true)::boolean = true);

DROP POLICY IF EXISTS super_admin_bypass_extension_requests ON extension_requests;
CREATE POLICY super_admin_bypass_extension_requests ON extension_requests
  USING (current_setting('app.is_super_admin', true)::boolean = true);


-- =============================================================================
-- 12. CARRIED-OVER TABLES (from full_schema.sql)
-- =============================================================================

CREATE TABLE IF NOT EXISTS instructors (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  first_name        VARCHAR(100)  NOT NULL,
  last_name         VARCHAR(100)  NOT NULL,
  middle_name       VARCHAR(100),
  email             VARCHAR(255)  NOT NULL UNIQUE,
  phone             VARCHAR(20),
  specialization    VARCHAR(255),
  bio               TEXT,
  photo_path        VARCHAR(500),
  status            VARCHAR(50)   NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'inactive', 'on_leave')),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_instructors ON instructors;
CREATE TRIGGER set_updated_at_instructors
  BEFORE UPDATE ON instructors
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS program_instructors (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  program_id      UUID          NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  instructor_id   UUID          NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  role            VARCHAR(100)  NOT NULL DEFAULT 'instructor'
                                CHECK (role IN ('instructor', 'assistant', 'guest')),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (program_id, instructor_id)
);

CREATE TABLE IF NOT EXISTS program_sessions (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID          NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  program_id   UUID          NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  title        VARCHAR(255)  NOT NULL,
  description  TEXT,
  session_date DATE          NOT NULL,
  start_time   TIME          NOT NULL,
  end_time     TIME          NOT NULL,
  location     VARCHAR(255),
  session_type VARCHAR(50)   NOT NULL DEFAULT 'lecture'
                             CHECK (session_type IN ('lecture', 'lab', 'workshop', 'exam', 'seminar', 'field_trip')),
  status       VARCHAR(50)   NOT NULL DEFAULT 'scheduled'
                             CHECK (status IN ('scheduled', 'completed', 'cancelled', 'postponed')),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_program_sessions ON program_sessions;
CREATE TRIGGER set_updated_at_program_sessions
  BEFORE UPDATE ON program_sessions
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- NOTE: pending_registrations table NOT CREATED (data merged into trainees table via registration_status)
-- For backward compatibility, applications can query trainees WHERE registration_status = 'pending'

CREATE TABLE IF NOT EXISTS trainee_accounts (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID        NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  trainee_id UUID        UNIQUE NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  user_id    UUID        UNIQUE NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lendings (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID          NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  item_id              UUID          NOT NULL REFERENCES items(id)     ON DELETE CASCADE,
  trainee_id           UUID          REFERENCES trainees(id) ON DELETE SET NULL,
  borrower_name        VARCHAR(255),
  borrower_contact     VARCHAR(50),
  quantity             INTEGER       NOT NULL,
  lent_date            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  expected_return_date DATE          NOT NULL,
  actual_return_date   TIMESTAMPTZ,
  status               VARCHAR(50)   NOT NULL DEFAULT 'active'
                                     CHECK (status IN ('active', 'returned', 'overdue', 'lost')),
  notes                TEXT,
  lent_by              UUID          REFERENCES users(id) ON DELETE SET NULL,
  returned_by          UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_lendings ON lendings;
CREATE TRIGGER set_updated_at_lendings
  BEFORE UPDATE ON lendings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS cms_settings (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  homepage_content TEXT,
  footer_text TEXT,
  about_us    TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_cms_settings ON cms_settings;
CREATE TRIGGER set_updated_at_cms_settings
  BEFORE UPDATE ON cms_settings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS anomaly_detection_configs (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID          NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  enabled      BOOLEAN       NOT NULL DEFAULT false,
  alert_email  VARCHAR(255),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_anomaly_detection_configs ON anomaly_detection_configs;
CREATE TRIGGER set_updated_at_anomaly_detection_configs
  BEFORE UPDATE ON anomaly_detection_configs
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- ANOMALY DETECTION RUNS (Track execution history)
-- =============================================================================

CREATE TABLE IF NOT EXISTS anomaly_detection_runs (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  started_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  duration_seconds    INTEGER,
  total_anomalies_found INTEGER      DEFAULT 0,
  critical_count      INTEGER       DEFAULT 0,
  warning_count       INTEGER       DEFAULT 0,
  info_count          INTEGER       DEFAULT 0,
  trigger_type        VARCHAR(50),
  triggered_by        UUID          REFERENCES users(id) ON DELETE SET NULL,
  status              VARCHAR(50)   NOT NULL DEFAULT 'running'
                                    CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  error_message       TEXT,
  config_snapshot     JSONB,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_anomaly_detection_runs ON anomaly_detection_runs;
CREATE TRIGGER set_updated_at_anomaly_detection_runs
  BEFORE UPDATE ON anomaly_detection_runs
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS anomalies (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category              VARCHAR(50)   NOT NULL,
  anomaly_type          VARCHAR(100)  NOT NULL,
  severity              VARCHAR(50)   NOT NULL
                                      CHECK (severity IN ('critical', 'warning', 'info')),
  status                VARCHAR(50)   NOT NULL DEFAULT 'open'
                                      CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed')),
  description           TEXT          NOT NULL,
  recommendation        TEXT,
  detection_logic       TEXT,
  entity_type           VARCHAR(100),
  entity_id             UUID,
  entity_identifier     VARCHAR(500),
  metadata              JSONB,
  auto_resolved         BOOLEAN       DEFAULT false,
  occurrence_count      INTEGER       DEFAULT 1,
  first_occurrence_at   TIMESTAMPTZ,
  last_occurrence_at    TIMESTAMPTZ,
  detection_run_id      UUID          REFERENCES anomaly_detection_runs(id) ON DELETE SET NULL,
  detected_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ,
  resolved_by           UUID          REFERENCES users(id) ON DELETE SET NULL,
  resolution_notes      TEXT,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_anomalies ON anomalies;
CREATE TRIGGER set_updated_at_anomalies
  BEFORE UPDATE ON anomalies
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trainee_id    UUID          REFERENCES trainees(id) ON DELETE CASCADE,
  user_id       UUID          REFERENCES users(id)   ON DELETE CASCADE,
  subscription  JSONB         NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_push_subscriptions ON push_subscriptions;
CREATE TRIGGER set_updated_at_push_subscriptions
  BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(255)  NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ   NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash          TEXT          NOT NULL UNIQUE,
  expires_at          TIMESTAMPTZ   NOT NULL,
  revoked_at          TIMESTAMPTZ,
  last_used_at        TIMESTAMPTZ,
  rotated_from        UUID          REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  created_ip          INET,
  created_user_agent  TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user      ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash      ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires   ON refresh_tokens(expires_at);

CREATE TABLE IF NOT EXISTS revoked_tokens (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  token       VARCHAR(500)  NOT NULL UNIQUE,
  reason      VARCHAR(255),
  revoked_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- 13. ENFORCEMENT TRIGGERS (3NF Normalization)
-- =============================================================================

-- Registration status state machine
CREATE OR REPLACE FUNCTION enforce_registration_status_transitions()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.registration_status IS DISTINCT FROM NEW.registration_status THEN
    CASE
      WHEN NEW.registration_status = 'pending' THEN
        IF OLD.registration_status NOT IN ('completed', NULL) THEN
          RAISE EXCEPTION 'Cannot transition registration status from % to pending', OLD.registration_status;
        END IF;
      WHEN NEW.registration_status = 'approved' THEN
        IF OLD.registration_status != 'pending' THEN
          RAISE EXCEPTION 'Cannot transition from % to approved (must be pending)', OLD.registration_status;
        END IF;
        IF NEW.registration_reviewed_by IS NULL OR NEW.registration_reviewed_at IS NULL THEN
          RAISE EXCEPTION 'Approval requires registration_reviewed_by and registration_reviewed_at';
        END IF;
      WHEN NEW.registration_status = 'rejected' THEN
        IF OLD.registration_status != 'pending' THEN
          RAISE EXCEPTION 'Cannot transition from % to rejected (must be pending)', OLD.registration_status;
        END IF;
        IF NEW.registration_rejection_reason IS NULL THEN
          RAISE EXCEPTION 'Rejection requires registration_rejection_reason';
        END IF;
        IF NEW.registration_reviewed_by IS NULL OR NEW.registration_reviewed_at IS NULL THEN
          RAISE EXCEPTION 'Rejection requires registration_reviewed_by and registration_reviewed_at';
        END IF;
      WHEN NEW.registration_status = 'completed' THEN
        IF OLD.registration_status != 'approved' THEN
          RAISE EXCEPTION 'Cannot transition from % to completed (must be approved)', OLD.registration_status;
        END IF;
    END CASE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_registration_transitions ON trainees;
CREATE TRIGGER enforce_registration_transitions
  BEFORE UPDATE ON trainees
  FOR EACH ROW
  WHEN (OLD.registration_status IS DISTINCT FROM NEW.registration_status)
  EXECUTE FUNCTION enforce_registration_status_transitions();

-- Trainee status consistency
CREATE OR REPLACE FUNCTION enforce_trainee_status_consistency()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'active' AND NEW.registration_status != 'completed' THEN
    RAISE EXCEPTION 'Active trainees must have registration_status = completed';
  END IF;
  IF NEW.registration_status = 'rejected' AND NEW.status = 'active' THEN
    RAISE EXCEPTION 'Rejected trainees cannot have status = active';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_trainee_status_consistency ON trainees;
CREATE TRIGGER enforce_trainee_status_consistency
  BEFORE INSERT OR UPDATE ON trainees
  FOR EACH ROW
  EXECUTE FUNCTION enforce_trainee_status_consistency();

-- Enrollment constraint enforcement
CREATE OR REPLACE FUNCTION enforce_enrollment_constraints()
RETURNS TRIGGER AS $$
DECLARE
  duplicate_count INT;
  current_program_capacity INT;
  current_enrollment_count INT;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM enrollments
  WHERE trainee_id = NEW.trainee_id
    AND program_id = NEW.program_id
    AND tenant_id = NEW.tenant_id
    AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000')
    AND status IN ('enrolled', 'active');

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Trainee is already enrolled in this program';
  END IF;

  SELECT max_trainees INTO current_program_capacity
  FROM programs
  WHERE id = NEW.program_id AND tenant_id = NEW.tenant_id;

  IF current_program_capacity IS NOT NULL THEN
    SELECT COUNT(*) INTO current_enrollment_count
    FROM enrollments
    WHERE program_id = NEW.program_id
      AND tenant_id = NEW.tenant_id
      AND status IN ('enrolled', 'active')
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000');

    IF current_enrollment_count >= current_program_capacity THEN
      RAISE EXCEPTION 'Program has reached maximum capacity';
    END IF;
  END IF;

  -- enrollment_date and completion_date validation (if completion_date is set)
  IF NEW.completion_date IS NOT NULL AND NEW.completion_date < NEW.enrollment_date THEN
    RAISE EXCEPTION 'Completion date must be after enrollment date';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_enrollment_constraints ON enrollments;
CREATE TRIGGER enforce_enrollment_constraints
  BEFORE INSERT OR UPDATE ON enrollments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_enrollment_constraints();

-- Attendance exception validation
CREATE OR REPLACE FUNCTION validate_attendance_exception()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.exception_start_time IS NOT NULL 
     AND NEW.exception_end_time IS NOT NULL 
     AND NEW.exception_start_time >= NEW.exception_end_time THEN
    RAISE EXCEPTION 'exception_start_time must be before exception_end_time';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_attendance_exception ON attendance_exceptions;
CREATE TRIGGER validate_attendance_exception
  BEFORE INSERT OR UPDATE ON attendance_exceptions
  FOR EACH ROW
  EXECUTE FUNCTION validate_attendance_exception();

-- Auto-initialize trainee notification preferences
CREATE OR REPLACE FUNCTION initialize_trainee_notification_preferences()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO trainee_notification_preferences (
    tenant_id, trainee_id, 
    email_enabled, sms_enabled, push_enabled, in_app_enabled,
    weekly_digest, event_reminders, enrollment_updates,
    created_at, updated_at
  )
  VALUES (
    NEW.tenant_id, NEW.id,
    true, true, true, true, true, true, true,
    NOW(), NOW()
  )
  ON CONFLICT (tenant_id, trainee_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS initialize_trainee_notification_preferences ON trainees;
CREATE TRIGGER initialize_trainee_notification_preferences
  AFTER INSERT ON trainees
  FOR EACH ROW
  EXECUTE FUNCTION initialize_trainee_notification_preferences();

-- Auto-initialize tenant branding
CREATE OR REPLACE FUNCTION initialize_tenant_branding()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO tenant_branding (
    tenant_id, logo_url, primary_color, secondary_color,
    welcome_message, created_at, updated_at
  )
  VALUES (
    NEW.id, NULL, '#007bff', '#6c757d',
    'Welcome to ' || NEW.name, NOW(), NOW()
  )
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS initialize_tenant_branding ON tenants;
CREATE TRIGGER initialize_tenant_branding
  AFTER INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION initialize_tenant_branding();

-- Audit logging for normalized tables
CREATE OR REPLACE FUNCTION audit_trainee_notification_preferences()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (tenant_id, action, entity_type, entity_id, details, created_at)
  VALUES (
    NEW.tenant_id,
    CASE WHEN TG_OP = 'DELETE' THEN 'notification_preferences.deleted'
         WHEN TG_OP = 'INSERT' THEN 'notification_preferences.created'
         ELSE 'notification_preferences.updated' END,
    'trainee_notification_preferences',
    NEW.trainee_id::TEXT,
    jsonb_build_object(
      'email_enabled', NEW.email_enabled,
      'sms_enabled', NEW.sms_enabled,
      'push_enabled', NEW.push_enabled,
      'in_app_enabled', NEW.in_app_enabled,
      'weekly_digest', NEW.weekly_digest,
      'event_reminders', NEW.event_reminders,
      'enrollment_updates', NEW.enrollment_updates
    ),
    NOW()
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_trainee_notification_preferences ON trainee_notification_preferences;
CREATE TRIGGER audit_trainee_notification_preferences
  AFTER INSERT OR UPDATE OR DELETE ON trainee_notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION audit_trainee_notification_preferences();

-- Audit logging for tenant branding
CREATE OR REPLACE FUNCTION audit_tenant_branding()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (tenant_id, action, entity_type, entity_id, details, created_at)
  VALUES (
    NEW.tenant_id,
    CASE WHEN TG_OP = 'DELETE' THEN 'branding.deleted'
         WHEN TG_OP = 'INSERT' THEN 'branding.created'
         ELSE 'branding.updated' END,
    'tenant_branding',
    NEW.tenant_id::TEXT,
    jsonb_build_object(
      'logo_url', NEW.logo_url,
      'primary_color', NEW.primary_color,
      'secondary_color', NEW.secondary_color,
      'welcome_message', NEW.welcome_message
    ),
    NOW()
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_tenant_branding ON tenant_branding;
CREATE TRIGGER audit_tenant_branding
  AFTER INSERT OR UPDATE OR DELETE ON tenant_branding
  FOR EACH ROW
  EXECUTE FUNCTION audit_tenant_branding();


-- =============================================================================
-- 14. DATA VALIDATION FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION validate_trainees_3nf()
RETURNS TABLE (
  issue_type VARCHAR,
  count INT,
  details TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    'duplicate_emails'::VARCHAR,
    COUNT(*)::INT,
    STRING_AGG(tenant_id::TEXT || ':' || email, ', ')
  FROM (
    SELECT tenant_id, email, COUNT(*) as cnt
    FROM trainees
    WHERE deleted_at IS NULL
    GROUP BY tenant_id, email
    HAVING COUNT(*) > 1
  ) duplicates
  GROUP BY 1;

  RETURN QUERY
  SELECT 
    'missing_notification_prefs'::VARCHAR,
    COUNT(*)::INT,
    'Trainees without trainee_notification_preferences record'
  FROM trainees t
  WHERE NOT EXISTS (
    SELECT 1 FROM trainee_notification_preferences tnp
    WHERE tnp.trainee_id = t.id AND tnp.tenant_id = t.tenant_id
  )
  AND t.deleted_at IS NULL;

  RETURN QUERY
  SELECT 
    'active_incomplete_registration'::VARCHAR,
    COUNT(*)::INT,
    STRING_AGG(id::TEXT, ', ') as ids
  FROM trainees
  WHERE status = 'active' AND registration_status != 'completed'
  AND deleted_at IS NULL
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;


-- =============================================================================
-- 15. ADDITIONAL CONSTRAINTS
-- =============================================================================

-- Add CHECK constraints for 3NF invariants
ALTER TABLE trainees
ADD CONSTRAINT check_trainee_status_valid CHECK (
  status IN ('active', 'inactive', 'completed', 'dropped')
);

ALTER TABLE trainees
ADD CONSTRAINT check_registration_status_valid CHECK (
  registration_status IN ('pending', 'approved', 'rejected', 'completed')
);

ALTER TABLE trainees
ADD CONSTRAINT check_rejection_reason_consistency CHECK (
  (registration_status = 'rejected' AND registration_rejection_reason IS NOT NULL) OR
  (registration_status != 'rejected')
);

ALTER TABLE trainees
ADD CONSTRAINT check_review_timestamp_consistency CHECK (
  (registration_reviewed_at IS NOT NULL AND registration_reviewed_by IS NOT NULL) OR
  (registration_reviewed_at IS NULL AND registration_reviewed_by IS NULL)
);

ALTER TABLE programs
ADD CONSTRAINT check_program_date_order CHECK (
  start_date <= end_date
);

ALTER TABLE items
ADD CONSTRAINT check_available_quantity CHECK (
  available_quantity >= 0 AND available_quantity <= quantity
);

ALTER TABLE attendance
ADD CONSTRAINT check_attendance_time_order CHECK (
  (check_in_time IS NULL OR check_out_time IS NULL OR check_in_time <= check_out_time)
);


COMMIT;

-- =============================================================================
-- POST-INSTALLATION SUMMARY
-- =============================================================================
--
-- Schema creation complete with full 3NF normalization.
--
-- Key changes from full_schema.sql:
-- 1. Removed: trainees.program_id, trainees.enrollment_date
-- 2. Removed: trainees.notification_preferences JSONB
-- 3. Removed: non_attendance_dates, attendance_schedule_overrides tables
-- 4. Added: 5 normalized tables (preferences, branding, channels, features, exceptions)
-- 5. Added: registration_status fields to trainees
-- 6. Added: Comprehensive trigger enforcement and audit logging
-- 7. Added: 12 performance indexes
--
-- Next steps:
-- 1. Configure RLS session variables in application middleware
-- 2. Initialize tenant branding and features via API or SQL
-- 3. Backfill trainee notification preferences from existing data
-- 4. Update backend services to use normalized tables
--
-- =============================================================================
