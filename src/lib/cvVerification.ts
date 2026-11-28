/**
 * Advisory Computer Vision Validation & Merging Helpers (Backend)
 *
 * Enforces trust-boundary validation via Zod v4:
 * - Strictly rejects any unexpected keys/biometric vectors (.strict()) for RA 10173 compliance
 * - Never blocks attendance submission on malformed optional CV payload (returns null + logs)
 * - Computes merged morning/afternoon advisory status cleanly
 */

import { z } from 'zod';
import { logger } from '@/utils/logger';
import type {
  AttendanceCvVerification,
  CvVerificationStatus,
  SessionCvVerification,
} from '@/types/advisory';

// Empirically calibrated via benchmark:face-cv (d <= 0.60 => similarity >= 0.50 achieves 93.5% TAR / 0.0% FAR)
export const DEFAULT_CV_CONFIG = {
  match_threshold: 0.5,
  review_threshold: 0.4,
  liveness_timeout_ms: 4000,
};

export const sessionCvVerificationSchema = z
  .object({
    status: z.enum(['verified', 'needs_review', 'flagged', 'unavailable']),
    face_detected: z.boolean(),
    face_count: z.number().int().min(0).max(20),
    similarity_score: z.number().min(0).max(1).nullable(),
    liveness_status: z.enum(['passed', 'failed', 'unverified']),
    liveness_cue: z.enum(['blink', 'head_turn', 'none']),
    reference_photo_available: z.boolean(),
    reasons: z.array(z.string().max(160)).max(8),
    model_version: z.string().min(1).max(64),
    inference_ms: z.number().min(0).max(60000),
    evaluated_at: z.string().min(10).max(40),
  })
  .strict();

const STATUS_SEVERITY: Record<CvVerificationStatus, number> = {
  flagged: 4,
  needs_review: 3,
  unavailable: 2,
  verified: 1,
};

/**
 * Safely parse optional FormData `cv_verification` JSON string.
 * Returns null (never throws) so advisory CV never breaks attendance submission.
 */
export function parseCvVerificationPayload(
  raw: string | null | undefined
): SessionCvVerification | null {
  if (!raw || typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }

  // Hard cap payload size (2 KB) to prevent bloated or biometric-vector injection
  if (raw.length > 2048) {
    logger.warn('[CV_ADVISORY] Rejected oversized cv_verification payload', {
      length: raw.length,
    });
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const result = sessionCvVerificationSchema.safeParse(parsed);
    if (!result.success) {
      logger.warn('[CV_ADVISORY] Invalid cv_verification payload ignored (passive mode)', {
        issues: result.error.issues.slice(0, 3).map((i) => i.message),
      });
      return null;
    }

    // Re-normalize scalar score to 4 decimal places
    const data = result.data;
    return {
      ...data,
      similarity_score:
        data.similarity_score === null
          ? null
          : Math.round(data.similarity_score * 10000) / 10000,
      inference_ms: Math.round(data.inference_ms),
    };
  } catch {
    logger.warn('[CV_ADVISORY] Unparseable cv_verification JSON ignored (passive mode)');
    return null;
  }
}

/**
 * Resolve tenant CV thresholds from feature_flags.configuration with safe defaults.
 */
export function resolveCvConfig(rawConfig: Record<string, unknown> | null) {
  const matchThreshold =
    typeof rawConfig?.match_threshold === 'number' &&
    rawConfig.match_threshold > 0.2 &&
    rawConfig.match_threshold <= 0.95
      ? rawConfig.match_threshold
      : DEFAULT_CV_CONFIG.match_threshold;

  const reviewThreshold =
    typeof rawConfig?.review_threshold === 'number' &&
    rawConfig.review_threshold >= 0.1 &&
    rawConfig.review_threshold < matchThreshold
      ? rawConfig.review_threshold
      : Math.min(DEFAULT_CV_CONFIG.review_threshold, matchThreshold - 0.1);

  const livenessTimeoutMs =
    typeof rawConfig?.liveness_timeout_ms === 'number' &&
    rawConfig.liveness_timeout_ms >= 1500 &&
    rawConfig.liveness_timeout_ms <= 10000
      ? rawConfig.liveness_timeout_ms
      : DEFAULT_CV_CONFIG.liveness_timeout_ms;

  return {
    match_threshold: matchThreshold,
    review_threshold: reviewThreshold,
    liveness_timeout_ms: livenessTimeoutMs,
  };
}

/**
 * Compute worst-case overall status across morning and afternoon sessions.
 */
export function computeOverallCvStatus(
  morning?: SessionCvVerification | null,
  afternoon?: SessionCvVerification | null
): CvVerificationStatus {
  const statuses = [morning?.status, afternoon?.status].filter(
    (s): s is CvVerificationStatus => Boolean(s)
  );
  if (statuses.length === 0) return 'unavailable';
  return statuses.reduce((worst, curr) =>
    STATUS_SEVERITY[curr] > STATUS_SEVERITY[worst] ? curr : worst
  );
}

/**
 * Merge a single session's CV advisory result into an existing attendance cv_verification object
 * without clobbering the opposite half-day session.
 */
export function mergeAttendanceCvVerification(
  existing: AttendanceCvVerification | null | undefined,
  sessionLabel: 'morning' | 'afternoon',
  incoming: SessionCvVerification
): AttendanceCvVerification {
  const morning = sessionLabel === 'morning' ? incoming : (existing?.morning ?? null);
  const afternoon = sessionLabel === 'afternoon' ? incoming : (existing?.afternoon ?? null);

  return {
    morning,
    afternoon,
    overall_status: computeOverallCvStatus(morning, afternoon),
    updated_at: new Date().toISOString(),
  };
}
