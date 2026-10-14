-- Task 22: Geofence Validation
-- Add table to store geofence boundaries for training programs
-- Allows enforcement of attendance submissions from authorized locations

CREATE TABLE IF NOT EXISTS program_geofences (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  program_id      UUID          NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  name            VARCHAR(255)  NOT NULL DEFAULT 'Training Center',
  latitude        DECIMAL(10,8) NOT NULL,  -- GPS latitude (-90 to +90)
  longitude       DECIMAL(11,8) NOT NULL, -- GPS longitude (-180 to +180)
  radius_meters   INTEGER       NOT NULL DEFAULT 100,  -- Geofence radius in meters
  is_active       BOOLEAN       NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, program_id)  -- One active geofence per program (for now)
);

-- Index for fast lookup by program_id
CREATE INDEX IF NOT EXISTS idx_geofences_program_id ON program_geofences(program_id);
CREATE INDEX IF NOT EXISTS idx_geofences_tenant_id ON program_geofences(tenant_id);

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS set_updated_at_program_geofences ON program_geofences;
CREATE TRIGGER set_updated_at_program_geofences
  BEFORE UPDATE ON program_geofences
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Add geofence_id reference to attendance table (optional, for audit trail)
ALTER TABLE attendance
ADD COLUMN geofence_id UUID REFERENCES program_geofences(id) ON DELETE SET NULL;

-- Index for audit queries
CREATE INDEX IF NOT EXISTS idx_attendance_geofence_id ON attendance(geofence_id);
