-- Migration 018: Additive Computer Vision & Document OCR Advisory Columns
-- Strictly additive, non-breaking, rollback-safe.
-- Supports RA 10173 data minimization: zero biometric templates/vectors stored.

-- 1. Attendance Computer Vision advisory metadata (Module A)
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS cv_verification JSONB DEFAULT NULL;

COMMENT ON COLUMN attendance.cv_verification IS
  'Advisory-only Computer Vision face verification & liveness summary (zero biometric vectors stored — RA 10173 compliant)';

-- 2. Requirement Document OCR & quality advisory metadata (Module B)
ALTER TABLE training_requirement_files
  ADD COLUMN IF NOT EXISTS ocr_analysis JSONB DEFAULT NULL;

COMMENT ON COLUMN training_requirement_files.ocr_analysis IS
  'Advisory-only offline OCR, blur quality, and keyword/name match summary';

-- 3. Partial indexes so Admin review queues can filter flagged records quickly
CREATE INDEX IF NOT EXISTS idx_attendance_cv_status
  ON attendance ((cv_verification->>'overall_status'))
  WHERE cv_verification IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_req_files_ocr_status
  ON training_requirement_files ((ocr_analysis->>'status'))
  WHERE ocr_analysis IS NOT NULL;
