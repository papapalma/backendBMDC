import { describe, it, expect } from '@jest/globals';
import {
  parseCvVerificationPayload,
  resolveCvConfig,
  computeOverallCvStatus,
  mergeAttendanceCvVerification,
} from './cvVerification';
import type { SessionCvVerification } from '@/types/advisory';

const VALID_SAMPLE: SessionCvVerification = {
  status: 'verified',
  face_detected: true,
  face_count: 1,
  similarity_score: 0.842312,
  liveness_status: 'passed',
  liveness_cue: 'blink',
  reference_photo_available: true,
  reasons: [],
  model_version: 'face-api-tiny-resnet-v1',
  inference_ms: 287.4,
  evaluated_at: '2026-11-28T09:00:00.000Z',
};

describe('cvVerification trust-boundary & merging helpers', () => {
  it('accepts a valid scalar CV payload and normalizes score & latency', () => {
    const parsed = parseCvVerificationPayload(JSON.stringify(VALID_SAMPLE));
    expect(parsed).not.toBeNull();
    expect(parsed!.status).toBe('verified');
    expect(parsed!.similarity_score).toBe(0.8423);
    expect(parsed!.inference_ms).toBe(287);
  });

  it('rejects biometric descriptor vectors injected into payload (RA 10173 zero-template enforcement)', () => {
    const tampered = {
      ...VALID_SAMPLE,
      descriptor: new Array(128).fill(0.123),
    };
    expect(parseCvVerificationPayload(JSON.stringify(tampered))).toBeNull();
  });

  it('rejects oversized payloads (> 2KB) passively without throwing', () => {
    const huge = JSON.stringify({ ...VALID_SAMPLE, reasons: ['x'.repeat(2500)] });
    expect(parseCvVerificationPayload(huge)).toBeNull();
  });

  it('returns null passively on malformed JSON or empty input', () => {
    expect(parseCvVerificationPayload('{bad json')).toBeNull();
    expect(parseCvVerificationPayload('')).toBeNull();
    expect(parseCvVerificationPayload(null)).toBeNull();
  });

  it('merges morning and afternoon sessions without overwriting the opposite half-day', () => {
    const morningOnly = mergeAttendanceCvVerification(null, 'morning', VALID_SAMPLE);
    expect(morningOnly.overall_status).toBe('verified');
    expect(morningOnly.morning?.status).toBe('verified');
    expect(morningOnly.afternoon).toBeNull();

    const flaggedPm: SessionCvVerification = {
      ...VALID_SAMPLE,
      status: 'flagged',
      face_detected: false,
      face_count: 0,
      similarity_score: null,
      liveness_status: 'failed',
      liveness_cue: 'none',
      reasons: ['No human face detected in captured selfie'],
    };

    const merged = mergeAttendanceCvVerification(morningOnly, 'afternoon', flaggedPm);
    expect(merged.morning?.status).toBe('verified');
    expect(merged.afternoon?.status).toBe('flagged');
    expect(merged.overall_status).toBe('flagged');
  });

  it('prioritizes worst severity in computeOverallCvStatus', () => {
    const review = { ...VALID_SAMPLE, status: 'needs_review' as const };
    const unavail = { ...VALID_SAMPLE, status: 'unavailable' as const };
    expect(computeOverallCvStatus(VALID_SAMPLE, review)).toBe('needs_review');
    expect(computeOverallCvStatus(VALID_SAMPLE, unavail)).toBe('unavailable');
    expect(computeOverallCvStatus(null, null)).toBe('unavailable');
  });

  it('resolves safe CV config defaults and respects valid tenant overrides', () => {
    expect(resolveCvConfig(null)).toEqual({
      match_threshold: 0.5,
      review_threshold: 0.4,
      liveness_timeout_ms: 4000,
    });
    expect(
      resolveCvConfig({
        match_threshold: 0.7,
        review_threshold: 0.5,
        liveness_timeout_ms: 5000,
      })
    ).toEqual({
      match_threshold: 0.7,
      review_threshold: 0.5,
      liveness_timeout_ms: 5000,
    });
  });
});
