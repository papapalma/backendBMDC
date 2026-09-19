-- =============================================================================
-- 019_add_cms_settings_tables.sql (SIMPLIFIED)
-- Add CMS Settings tables for landing page customization system
-- Creates only the base table structures - no data population
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. CMS SETTINGS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS cms_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE,
  settings_data JSONB NOT NULL DEFAULT '{
    "colors": {"primary": "#3B82F6", "secondary": "#10B981", "accent": "#F59E0B", "background": "#FFFFFF", "text": "#1F2937", "borders": "#E5E7EB"},
    "typography": {"headings": {"fontFamily": "Poppins", "fontSize": {"h1": 48, "h2": 36, "h3": 28}, "fontWeight": 700, "lineHeight": 1.2}, "body": {"fontFamily": "Inter", "fontSize": 16, "fontWeight": 400, "lineHeight": 1.5}},
    "layout": {"containerWidth": "1200px", "containerLayout": "centered", "padding": {"heroSection": 40, "contentAreas": 32, "footer": 24}, "margins": {"sectionSpacing": 48, "elementSpacing": 16}, "gaps": {"grid": 24, "flex": 16}},
    "components": {"navigation": {"enabled": true, "style": "light"}, "hero": {"enabled": true, "backgroundImage": "url(...)", "overlayColor": "rgba(0,0,0,0.3)", "height": "500px"}, "features": {"enabled": true, "layout": "grid", "columns": 3}, "testimonials": {"enabled": true, "displayCount": 3}, "ctaSection": {"enabled": true, "style": "button"}, "contact": {"enabled": true, "formFields": ["email", "phone", "message"]}, "footer": {"enabled": true, "linkColumns": 4}},
    "content": {"hero": {"heading": "Welcome to Our Platform", "subheading": "Build amazing things", "ctaText": "Get Started"}, "missionVision": {"title": "Our Mission", "description": "To empower businesses...", "vision": "To be the leading..."}, "features": [{"title": "Feature 1", "description": "Description...", "icon": "icon-name"}], "testimonials": [{"text": "Great product!", "author": "John Doe", "image": "url(...)"}], "contact": {"email": "contact@example.com", "phone": "+1-555-000-0000", "address": "123 Main St", "socialLinks": {"twitter": "https://twitter.com/...", "linkedin": "https://linkedin.com/..."}}}
  }',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by_admin_id UUID,
  CONSTRAINT fk_cms_settings_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_cms_settings_admin FOREIGN KEY (updated_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cms_settings_tenant_id ON cms_settings(tenant_id);

DROP TRIGGER IF EXISTS trigger_cms_settings_updated_at ON cms_settings;
CREATE TRIGGER trigger_cms_settings_updated_at
  BEFORE UPDATE ON cms_settings FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- 2. CMS SETTINGS VERSIONS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS cms_settings_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cms_settings_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  settings_data JSONB NOT NULL,
  version_number INTEGER NOT NULL,
  change_summary VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by_admin_id UUID,
  CONSTRAINT fk_cms_versions_cms_settings FOREIGN KEY (cms_settings_id) REFERENCES cms_settings(id) ON DELETE CASCADE,
  CONSTRAINT fk_cms_versions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_cms_versions_admin FOREIGN KEY (created_by_admin_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT unique_cms_version UNIQUE(cms_settings_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_cms_versions_tenant_id ON cms_settings_versions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cms_versions_cms_settings_id ON cms_settings_versions(cms_settings_id);
CREATE INDEX IF NOT EXISTS idx_cms_versions_created_at ON cms_settings_versions(created_at DESC);

-- =============================================================================
-- 3. CMS AUDIT LOG TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS cms_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  admin_id UUID,
  action VARCHAR(50) NOT NULL CHECK (action IN ('create', 'update', 'delete', 'import', 'rollback', 'apply_preset', 'export')),
  resource_type VARCHAR(50),
  resource_id UUID,
  changes JSONB,
  error_message TEXT,
  ip_address VARCHAR(45),
  user_agent VARCHAR(255),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cms_audit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_cms_audit_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cms_audit_tenant_id ON cms_audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cms_audit_admin_id ON cms_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_cms_audit_timestamp ON cms_audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_cms_audit_action ON cms_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_cms_audit_tenant_timestamp ON cms_audit_log(tenant_id, timestamp DESC);

-- =============================================================================
-- 4. THEME PRESETS TABLE (structure only - data added in next migration)
-- =============================================================================

CREATE TABLE IF NOT EXISTS theme_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  category VARCHAR(100),
  preset_data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_preset_name UNIQUE(name)
);

DROP TRIGGER IF EXISTS trigger_theme_presets_updated_at ON theme_presets;
CREATE TRIGGER trigger_theme_presets_updated_at
  BEFORE UPDATE ON theme_presets FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- 5. POPULATE INITIAL CMS_SETTINGS FOR EXISTING TENANTS
-- =============================================================================

INSERT INTO cms_settings (tenant_id)
SELECT id FROM tenants
WHERE id NOT IN (SELECT tenant_id FROM cms_settings)
ON CONFLICT (tenant_id) DO NOTHING;

COMMIT;
