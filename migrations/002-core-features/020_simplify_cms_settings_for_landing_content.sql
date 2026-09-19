-- =============================================================================
-- 020_simplify_cms_settings_for_landing_content.sql
-- Simplifies cms_settings table to focus on landing page content
-- Drops and recreates with simplified structure
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. DROP EXISTING TABLE AND RECREATE WITH SIMPLIFIED STRUCTURE
-- =============================================================================

-- Drop the old table (and dependent views/triggers)
DROP TABLE IF EXISTS cms_audit_log CASCADE;
DROP TABLE IF EXISTS cms_settings_versions CASCADE;
DROP TABLE IF EXISTS theme_presets CASCADE;
DROP TABLE IF EXISTS cms_settings CASCADE;

-- Recreate cms_settings with simplified landing page content structure
CREATE TABLE cms_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE,
  
  -- JSONB structure containing landing page content only
  settings_data JSONB NOT NULL DEFAULT '{
    "content": {
      "appearance": {
        "logo": "",
        "heroBackground": ""
      },
      "hero": {
        "badge": "Official Training",
        "heading": "Shape Your Future",
        "subheading": "Training",
        "ctaText": "Enroll Now",
        "trustIndicators": []
      },
      "mission": "To provide accessible training",
      "vision": "A community empowered through education",
      "features": [
        {"icon": "Wrench", "title": "Practical", "description": "Hands-on"},
        {"icon": "Award", "title": "Certified", "description": "Credentials"},
        {"icon": "Users2", "title": "Expert", "description": "Professional"},
        {"icon": "Compass", "title": "Guidance", "description": "Support"}
      ],
      "ctaBanner": {
        "badge": "Start",
        "heading": "Ready?",
        "description": "Join now",
        "ctaPrimaryText": "Enroll",
        "ctaSecondaryText": "View"
      },
      "contact": {
        "address": "Bongabong",
        "addressLine2": "Philippines",
        "phone": "+63",
        "email": "info@bmdc.edu.ph",
        "facebook": ""
      },
      "footer": {
        "companyName": "BMDC",
        "tagline": "Empowering"
      }
    }
  }',
  
  -- Metadata columns
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by_admin_id UUID,
  
  -- Foreign key constraints
  CONSTRAINT fk_cms_settings_tenant FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_cms_settings_admin FOREIGN KEY (updated_by_admin_id) 
    REFERENCES users(id) ON DELETE SET NULL
);

-- Create index for fast tenant lookups
CREATE INDEX idx_cms_settings_tenant_id ON cms_settings(tenant_id);

-- Create trigger for updated_at timestamp
CREATE TRIGGER trigger_cms_settings_updated_at
  BEFORE UPDATE ON cms_settings
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- 2. DOCUMENTATION
-- =============================================================================

COMMENT ON TABLE cms_settings IS 'Landing page content customization per tenant. Stores hero section, mission/vision, features, CTA, contact info, footer, and appearance assets (logo, hero background).';

COMMENT ON COLUMN cms_settings.settings_data IS 'JSONB containing landing page content: appearance (logo, heroBackground), hero section, mission, vision, features array, CTA banner, contact info, and footer.';

-- =============================================================================
-- 3. POPULATE INITIAL RECORDS FOR EXISTING TENANTS
-- =============================================================================

INSERT INTO cms_settings (tenant_id)
SELECT id FROM tenants
WHERE id NOT IN (SELECT tenant_id FROM cms_settings)
ON CONFLICT (tenant_id) DO NOTHING;

COMMIT;