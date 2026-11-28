-- =============================================================================
-- Migration: 016-user-language / 001_add_preferred_language_to_users.sql
-- Purpose: Add per-user preferred_language ('en' | 'fil') to users table
-- =============================================================================

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(5) NOT NULL DEFAULT 'en'
  CHECK (preferred_language IN ('en', 'fil'));

COMMIT;
