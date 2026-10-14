-- =============================================================================
-- 020_add_theme_presets_is_active_column.sql
-- Add is_active column and populate default theme presets
-- =============================================================================

BEGIN;

-- Add is_active column to theme_presets table
ALTER TABLE IF EXISTS theme_presets
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_theme_presets_is_active ON theme_presets(is_active);
CREATE INDEX IF NOT EXISTS idx_theme_presets_category ON theme_presets(category);
CREATE INDEX IF NOT EXISTS idx_theme_presets_created_at ON theme_presets(created_at DESC);

-- Insert default theme presets
INSERT INTO theme_presets (name, description, category, preset_data, is_active)
VALUES ('Modern Minimal', 'Clean and contemporary design', 'modern', '{"colors":{"primary":"#1F2937"}}', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO theme_presets (name, description, category, preset_data, is_active)
VALUES ('Corporate', 'Professional corporate design', 'corporate', '{"colors":{"primary":"#003A70"}}', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO theme_presets (name, description, category, preset_data, is_active)
VALUES ('Creative', 'Vibrant and artistic design', 'creative', '{"colors":{"primary":"#FF006E"}}', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO theme_presets (name, description, category, preset_data, is_active)
VALUES ('Bold Tech', 'Modern tech-focused design', 'bold', '{"colors":{"primary":"#6366F1"}}', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO theme_presets (name, description, category, preset_data, is_active)
VALUES ('Startup', 'Fresh and energetic design', 'startup', '{"colors":{"primary":"#FF5733"}}', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO theme_presets (name, description, category, preset_data, is_active)
VALUES ('Luxury', 'Sophisticated premium design', 'luxury', '{"colors":{"primary":"#2D1810"}}', true)
ON CONFLICT (name) DO NOTHING;

COMMIT;
