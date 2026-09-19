-- =============================================================================
-- FIX: Anomalies Table - Add Missing 16 Columns
-- =============================================================================
--
-- ISSUE: Anomaly detection tracking incomplete
--   Missing 16 critical columns for tracking anomaly lifecycle
--   Severity enum values incompatible with full_schema.sql
--
-- ROOT CAUSE: anomalies table in Normalize_full_schema.sql was oversimplified
--   Removed too many tracking columns needed for production anomaly detection
--   Changed severity values from ('critical', 'warning', 'info') to ('low', 'medium', 'high', 'critical')
--
-- SOLUTION: Recreate the table with all required columns from full_schema.sql
--
-- =============================================================================

-- Step 1: Drop the old incomplete table
DROP TABLE IF EXISTS anomalies CASCADE;

-- Step 2: Create the corrected anomalies table
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

-- Step 3: Create trigger for updated_at
DROP TRIGGER IF EXISTS set_updated_at_anomalies ON anomalies;
CREATE TRIGGER set_updated_at_anomalies
  BEFORE UPDATE ON anomalies
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Step 4: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_anomalies_tenant ON anomalies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_type ON anomalies(anomaly_type);
CREATE INDEX IF NOT EXISTS idx_anomalies_severity ON anomalies(severity);
CREATE INDEX IF NOT EXISTS idx_anomalies_status ON anomalies(status);
CREATE INDEX IF NOT EXISTS idx_anomalies_entity ON anomalies(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_detected_at ON anomalies(detected_at);
CREATE INDEX IF NOT EXISTS idx_anomalies_detection_run ON anomalies(detection_run_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_resolved_at ON anomalies(resolved_at);

-- Step 5: Create the anomaly_detection_runs table (if it doesn't exist)
-- This table tracks anomaly detection execution history
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

-- Step 6: Create trigger for anomaly_detection_runs updated_at
DROP TRIGGER IF EXISTS set_updated_at_anomaly_detection_runs ON anomaly_detection_runs;
CREATE TRIGGER set_updated_at_anomaly_detection_runs
  BEFORE UPDATE ON anomaly_detection_runs
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Step 7: Create indexes for anomaly_detection_runs
CREATE INDEX IF NOT EXISTS idx_anomaly_detection_runs_tenant ON anomaly_detection_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_detection_runs_status ON anomaly_detection_runs(status);
CREATE INDEX IF NOT EXISTS idx_anomaly_detection_runs_started_at ON anomaly_detection_runs(started_at);

-- Step 8: Verify the fix
-- Run this to confirm all columns exist:
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name = 'anomalies' ORDER BY ordinal_position;

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================

-- Check if the anomalies fix was successful:
SELECT 
  COUNT(*) as column_count,
  STRING_AGG(column_name, ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns 
WHERE table_name = 'anomalies';

-- List all anomalies columns with their types:
SELECT 
  ordinal_position,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'anomalies'
ORDER BY ordinal_position;

-- Check anomaly_detection_runs table:
SELECT COUNT(*) as column_count FROM information_schema.columns WHERE table_name = 'anomaly_detection_runs';

-- =============================================================================
-- SUCCESS INDICATORS
-- =============================================================================
-- ✅ Anomalies Columns should be (25 total):
--   1. id (uuid)
--   2. tenant_id (uuid)
--   3. category (character varying) ← ADDED
--   4. anomaly_type (character varying)
--   5. severity (character varying) ← FIXED values
--   6. status (character varying) ← ADDED
--   7. description (text)
--   8. recommendation (text) ← FIXED singular
--   9. detection_logic (text) ← ADDED
--   10. entity_type (character varying) ← ADDED
--   11. entity_id (uuid) ← ADDED
--   12. entity_identifier (character varying) ← ADDED
--   13. metadata (jsonb) ← ADDED
--   14. auto_resolved (boolean) ← ADDED
--   15. occurrence_count (integer) ← ADDED
--   16. first_occurrence_at (timestamp with time zone) ← ADDED
--   17. last_occurrence_at (timestamp with time zone) ← ADDED
--   18. detection_run_id (uuid) ← ADDED (critical!)
--   19. detected_at (timestamp with time zone) ← ADDED
--   20. resolved_at (timestamp with time zone) ← ADDED
--   21. resolved_by (uuid) ← ADDED
--   22. resolution_notes (text) ← ADDED
--   23. created_at (timestamp with time zone)
--   24. updated_at (timestamp with time zone)
--
-- ✅ Constraints should exist:
--   - severity CHECK: ('critical', 'warning', 'info')
--   - status CHECK: ('open', 'investigating', 'resolved', 'dismissed')
--
-- ✅ Indexes should exist (8):
--   - idx_anomalies_tenant
--   - idx_anomalies_type
--   - idx_anomalies_severity
--   - idx_anomalies_status
--   - idx_anomalies_entity
--   - idx_anomalies_detected_at
--   - idx_anomalies_detection_run (critical for tracking)
--   - idx_anomalies_resolved_at
--
-- ✅ Trigger should exist:
--   - set_updated_at_anomalies
--
-- ✅ anomaly_detection_runs table should be created (10 columns):
--   - For tracking anomaly detection execution history
--
-- =============================================================================
