import { jest } from '@jest/globals';

const mockFrom = jest.fn();

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import {
  buildCvAlertItem,
  buildOcrAlertItem,
  extractCvFromAttendanceRow,
  getCutoffIso,
  getReviewAlertsSummary,
  isCvAlertUnreviewed,
  isOcrAlertUnreviewed,
  resolveCvReviewAlert,
  resolveOcrReviewAlert,
  reviewAlertEvents,
} from './reviewAlertService';
import type { AttendanceCvVerification, RequirementOcrAnalysis } from '@/types/advisory';

function makeCv(overrides: Partial<AttendanceCvVerification> = {}): AttendanceCvVerification {
  return {
    morning: null,
    afternoon: {
      status: 'needs_review',
      face_detected: true,
      face_count: 1,
      similarity_score: 0.44,
      liveness_status: 'unverified',
      liveness_cue: 'none',
      reference_photo_available: true,
      reasons: ['Borderline face similarity (44% — verify visually)'],
      model_version: 'face-api-tiny-resnet-v1',
      inference_ms: 112,
      evaluated_at: '2026-11-28T05:00:00.000Z',
    },
    overall_status: 'needs_review',
    updated_at: '2026-11-28T05:00:00.000Z',
    ...overrides,
  };
}

function makeOcr(overrides: Partial<RequirementOcrAnalysis> = {}): RequirementOcrAnalysis {
  return {
    status: 'flagged',
    blur_score: 18,
    is_blurry: true,
    is_blank: false,
    ocr_confidence: 32,
    doc_type_match_score: 0.1,
    matched_keywords: [],
    trainee_name_match_score: 0.2,
    detected_name_tokens: [],
    warnings: ['Image appears blurry — ask trainee to re-upload a sharper photo'],
    engine_version: 'tesseract-eng-v1',
    processing_ms: 820,
    analyzed_at: '2026-11-28T04:00:00.000Z',
    ...overrides,
  };
}

function makeChain(result: { data?: any; error?: any }) {
  const chain: any = {
    select: jest.fn(() => chain),
    update: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    is: jest.fn(() => chain),
    not: jest.fn(() => chain),
    gte: jest.fn(() => chain),
    order: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    maybeSingle: jest.fn(() => Promise.resolve(result)),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

describe('reviewAlertService pure rules', () => {
  test('isCvAlertUnreviewed gates strictly to unreviewed flagged and needs_review', () => {
    expect(isCvAlertUnreviewed(makeCv({ overall_status: 'flagged' }))).toBe(true);
    expect(isCvAlertUnreviewed(makeCv({ overall_status: 'needs_review' }))).toBe(true);
    expect(isCvAlertUnreviewed(makeCv({ overall_status: 'verified' }))).toBe(false);
    expect(isCvAlertUnreviewed(makeCv({ overall_status: 'unavailable' }))).toBe(false);
    expect(
      isCvAlertUnreviewed(
        makeCv({
          overall_status: 'flagged',
          staff_review: {
            reviewed_by: 'admin-1',
            reviewed_at: '2026-11-28T06:00:00.000Z',
            action: 'confirmed',
          },
        })
      )
    ).toBe(false);
  });

  test('isOcrAlertUnreviewed gates strictly to unreviewed flagged and needs_review (excludes skipped_pdf/likely_valid/error)', () => {
    expect(isOcrAlertUnreviewed(makeOcr({ status: 'flagged' }))).toBe(true);
    expect(isOcrAlertUnreviewed(makeOcr({ status: 'needs_review' }))).toBe(true);
    expect(isOcrAlertUnreviewed(makeOcr({ status: 'likely_valid' }))).toBe(false);
    expect(isOcrAlertUnreviewed(makeOcr({ status: 'skipped_pdf' }))).toBe(false);
    expect(isOcrAlertUnreviewed(makeOcr({ status: 'error' }))).toBe(false);
    expect(
      isOcrAlertUnreviewed(
        makeOcr({
          status: 'flagged',
          staff_review: {
            reviewed_by: 'admin-1',
            reviewed_at: '2026-11-28T06:00:00.000Z',
            action: 'confirmed',
          },
        })
      )
    ).toBe(false);
  });

  test('extractCvFromAttendanceRow supports both cv_verification column and legacy device_info._cv_advisory fallback', () => {
    const cv = makeCv();
    expect(extractCvFromAttendanceRow({ cv_verification: cv })).toEqual(cv);
    expect(
      extractCvFromAttendanceRow({ cv_verification: null, device_info: { _cv_advisory: cv } })
    ).toEqual(cv);
    expect(extractCvFromAttendanceRow({ cv_verification: null, device_info: {} })).toBeNull();
  });

  test('getCutoffIso computes exact 30-day lookback window', () => {
    const now = new Date('2026-11-28T12:00:00.000Z');
    expect(getCutoffIso(30, now)).toBe('2026-10-29T12:00:00.000Z');
  });

  test('buildCvAlertItem and buildOcrAlertItem produce exact deep-link URLs', () => {
    const cvItem = buildCvAlertItem({
      attendanceId: 'att-1',
      traineeId: 'tr-1',
      traineeName: 'Julianne Magcuha',
      programId: 'prog-1',
      programName: 'Welding NC II',
      date: '2026-11-28',
      cv: makeCv({ overall_status: 'flagged' }),
      createdAt: '2026-11-28T05:00:00.000Z',
    });
    expect(cvItem.href).toBe(
      '/programs/prog-1/attendance?date=2026-11-28&recordId=att-1&filter=review&tab=records'
    );
    expect(cvItem.title).toBe('CV Flagged: Julianne Magcuha');

    const ocrItem = buildOcrAlertItem({
      fileId: 'file-1',
      traineeId: 'tr-1',
      traineeName: 'Julianne Magcuha',
      requirementDefId: 'def-1',
      requirementType: 'birth_certificate_copy',
      requirementName: 'Birth Certificate',
      fileName: 'psa.jpg',
      ocr: makeOcr(),
      uploadedAt: '2026-11-28T04:00:00.000Z',
    });
    expect(ocrItem.href).toBe('/admin/requirements/def-1?fileId=file-1&filter=ocr_review');
    expect(ocrItem.title).toBe('OCR Flagged: Julianne Magcuha');
  });
});

describe('reviewAlertService aggregation & resolution', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  test('getReviewAlertsSummary aggregates CV by program/date and OCR by requirement definition', async () => {
    const attChain = makeChain({
      data: [
        {
          id: 'att-flagged',
          tenant_id: 't-1',
          trainee_id: 'tr-1',
          session_id: 'sess-1',
          cv_verification: makeCv({ overall_status: 'flagged' }),
          device_info: null,
          updated_at: '2026-11-28T05:00:00.000Z',
          created_at: '2026-11-28T05:00:00.000Z',
          trainee: { id: 'tr-1', first_name: 'Julianne', last_name: 'Magcuha' },
          session: {
            id: 'sess-1',
            program_id: 'prog-1',
            session_date: '2026-11-28',
            program: { id: 'prog-1', name: 'Shielded Metal Arc Welding', deleted_at: null },
          },
        },
        {
          id: 'att-verified',
          tenant_id: 't-1',
          trainee_id: 'tr-2',
          session_id: 'sess-1',
          cv_verification: makeCv({ overall_status: 'verified' }),
          device_info: null,
          updated_at: '2026-11-28T05:05:00.000Z',
          created_at: '2026-11-28T05:05:00.000Z',
          trainee: { id: 'tr-2', first_name: 'Ana', last_name: 'Cruz' },
          session: {
            id: 'sess-1',
            program_id: 'prog-1',
            session_date: '2026-11-28',
            program: { id: 'prog-1', name: 'Shielded Metal Arc Welding', deleted_at: null },
          },
        },
      ],
      error: null,
    });

    const filesChain = makeChain({
      data: [
        {
          id: 'file-flagged',
          tenant_id: 't-1',
          trainee_id: 'tr-1',
          requirement_type: 'birth_certificate_copy',
          file_name: 'blurry.jpg',
          ocr_analysis: makeOcr({ status: 'flagged' }),
          uploaded_at: '2026-11-28T04:00:00.000Z',
          trainee: { id: 'tr-1', first_name: 'Julianne', last_name: 'Magcuha' },
        },
        {
          id: 'file-pdf',
          tenant_id: 't-1',
          trainee_id: 'tr-2',
          requirement_type: 'birth_certificate_copy',
          file_name: 'doc.pdf',
          ocr_analysis: makeOcr({ status: 'skipped_pdf' }),
          uploaded_at: '2026-11-28T04:10:00.000Z',
          trainee: { id: 'tr-2', first_name: 'Ana', last_name: 'Cruz' },
        },
      ],
      error: null,
    });

    const defsChain = makeChain({
      data: [
        {
          id: 'def-birth',
          tenant_id: 't-1',
          requirement_type: 'birth_certificate_copy',
          display_name: 'Birth Certificate',
        },
      ],
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'attendance') return attChain;
      if (table === 'training_requirement_files') return filesChain;
      if (table === 'requirement_definitions') return defsChain;
      return makeChain({ data: [], error: null });
    });

    const summary = await getReviewAlertsSummary({ tenantId: 't-1' });
    expect(summary.cv_total).toBe(1);
    expect(summary.ocr_total).toBe(1);
    expect(summary.total_count).toBe(2);
    expect(summary.cv_by_program).toEqual({ 'prog-1': 1 });
    expect(summary.cv_by_program_date).toEqual({ 'prog-1': { '2026-11-28': 1 } });
    expect(summary.ocr_by_requirement_def).toEqual({ 'def-birth': 1 });
    expect(summary.items).toHaveLength(2);
    expect(attChain.eq).toHaveBeenCalledWith('tenant_id', 't-1');
  });

  test('resolveCvReviewAlert persists staff_review and emits review_resolved', async () => {
    const selectChain = makeChain({
      data: {
        id: 'att-1',
        tenant_id: 't-1',
        cv_verification: makeCv(),
        device_info: {},
        session: { program_id: 'prog-1', session_date: '2026-11-28' },
      },
      error: null,
    });
    const updateChain = makeChain({ data: null, error: null });

    let attCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'attendance') {
        attCallCount += 1;
        return attCallCount === 1 ? selectChain : updateChain;
      }
      return makeChain({ data: null, error: null });
    });

    const emitted: any[] = [];
    const listener = (evt: any) => emitted.push(evt);
    reviewAlertEvents.on('review_resolved', listener);

    try {
      const res = await resolveCvReviewAlert({
        tenantId: 't-1',
        attendanceId: 'att-1',
        reviewerId: 'admin-1',
        action: 'confirmed',
      });
      expect(res.resolved).toBe(true);
      expect(res.staffReview?.reviewed_by).toBe('admin-1');
      expect(res.staffReview?.action).toBe('confirmed');
      expect(updateChain.update).toHaveBeenCalledTimes(1);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        tenantId: 't-1',
        kind: 'cv',
        attendanceId: 'att-1',
        programId: 'prog-1',
        date: '2026-11-28',
      });
    } finally {
      reviewAlertEvents.off('review_resolved', listener);
    }
  });

  test('resolveOcrReviewAlert persists staff_review and emits review_resolved', async () => {
    const selectFileChain = makeChain({
      data: {
        id: 'file-1',
        tenant_id: 't-1',
        requirement_type: 'birth_certificate_copy',
        ocr_analysis: makeOcr(),
      },
      error: null,
    });
    const updateFileChain = makeChain({ data: null, error: null });
    const defChain = makeChain({ data: { id: 'def-birth' }, error: null });

    let fileCalls = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'training_requirement_files') {
        fileCalls += 1;
        return fileCalls === 1 ? selectFileChain : updateFileChain;
      }
      if (table === 'requirement_definitions') return defChain;
      return makeChain({ data: null, error: null });
    });

    const emitted: any[] = [];
    const listener = (evt: any) => emitted.push(evt);
    reviewAlertEvents.on('review_resolved', listener);

    try {
      const res = await resolveOcrReviewAlert({
        tenantId: 't-1',
        fileId: 'file-1',
        reviewerId: 'admin-1',
        action: 'confirmed',
      });
      expect(res.resolved).toBe(true);
      expect(res.staffReview?.action).toBe('confirmed');
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        tenantId: 't-1',
        kind: 'ocr',
        fileId: 'file-1',
        requirementDefId: 'def-birth',
      });
    } finally {
      reviewAlertEvents.off('review_resolved', listener);
    }
  });
});
