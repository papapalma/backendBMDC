-- ============================================================================
-- MIGRATION: Make qr_code column nullable
-- ============================================================================
-- Purpose: Allow null values in qr_code column to support trainees without QR codes
-- This is a prerequisite before removing the QR code feature entirely

-- ============================================================================
-- Make qr_code nullable
-- ============================================================================
ALTER TABLE trainees
ALTER COLUMN qr_code DROP NOT NULL;

-- ============================================================================
-- Success Indicator
-- ============================================================================
-- ✅ qr_code column in trainees is now nullable
