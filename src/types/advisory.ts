/**
 * Shared Advisory Types for Emerging Tech Modules (Backend)
 *
 * Module A: On-Device Computer Vision Face Verification + Liveness (Attendance)
 * Module B: Offline Document OCR & Quality Pre-Screening (Trainee Requirements)
 *
 * RA 10173 Compliance:
 * - Zero biometric templates or 128-D face vectors are ever accepted or stored.
 * - All verdicts are strictly passive/advisory; human BMDC staff make final decisions.
 */

export type CvVerificationStatus = 'verified' | 'needs_review' | 'flagged' | 'unavailable';
export type CvLivenessStatus = 'passed' | 'failed' | 'unverified';
export type CvLivenessCue = 'blink' | 'head_turn' | 'none';

export interface SessionCvVerification {
  status: CvVerificationStatus;
  face_detected: boolean;
  face_count: number;
  similarity_score: number | null;
  liveness_status: CvLivenessStatus;
  liveness_cue: CvLivenessCue;
  reference_photo_available: boolean;
  reasons: string[];
  model_version: string;
  inference_ms: number;
  evaluated_at: string;
}

export type AdvisoryStaffReviewAction =
  | 'override'
  | 'confirmed'
  | 'verified'
  | 'rejected'
  | 'waived'
  | 'registration_reviewed';

export interface AdvisoryStaffReview {
  reviewed_by: string;
  reviewed_by_name?: string;
  reviewed_at: string;
  action: AdvisoryStaffReviewAction;
  notes?: string;
}

export interface AttendanceCvVerification {
  morning?: SessionCvVerification | null;
  afternoon?: SessionCvVerification | null;
  overall_status: CvVerificationStatus;
  updated_at: string;
  staff_review?: AdvisoryStaffReview | null;
}

export interface CvFaceVerificationConfig {
  enabled: boolean;
  reference_photo_path: string | null;
  config: {
    match_threshold: number;
    review_threshold: number;
    liveness_timeout_ms: number;
  };
}

export type RequirementOcrStatus =
  | 'likely_valid'
  | 'needs_review'
  | 'flagged'
  | 'skipped_pdf'
  | 'error';

export interface IdPhotoAdvisoryChecks {
  white_bg_ratio: number;
  aspect_ratio: number;
  min_resolution_ok: boolean;
  portrait_center_contrast_ok: boolean;
}

export interface RequirementOcrAnalysis {
  status: RequirementOcrStatus;
  blur_score: number | null;
  is_blurry: boolean;
  is_blank: boolean;
  ocr_confidence: number | null;
  doc_type_match_score: number;
  matched_keywords: string[];
  trainee_name_match_score: number | null;
  detected_name_tokens: string[];
  id_photo_checks?: IdPhotoAdvisoryChecks;
  warnings: string[];
  engine_version: string;
  processing_ms: number;
  analyzed_at: string;
  staff_review?: AdvisoryStaffReview | null;
}

export type ReviewAlertKind = 'cv' | 'ocr';
export type ReviewAlertSeverity = 'flagged' | 'needs_review';

export interface ReviewAlertItem {
  id: string;
  kind: ReviewAlertKind;
  severity: ReviewAlertSeverity;
  trainee_id: string;
  trainee_name: string;
  title: string;
  description: string;
  href: string;
  created_at: string;
  // CV-specific fields
  attendance_id?: string;
  program_id?: string;
  program_name?: string;
  date?: string;
  similarity_score?: number | null;
  // OCR-specific fields
  file_id?: string;
  requirement_def_id?: string;
  requirement_type?: string;
  requirement_name?: string;
  file_name?: string;
}

export interface ReviewAlertsSummary {
  total_count: number;
  cv_total: number;
  ocr_total: number;
  cv_by_program: Record<string, number>;
  cv_by_program_date: Record<string, Record<string, number>>;
  ocr_by_requirement_def: Record<string, number>;
  ocr_by_requirement_type: Record<string, number>;
  items: ReviewAlertItem[];
  generated_at: string;
}
