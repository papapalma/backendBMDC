/**
 * Unified CV & OCR Advisory Review Alert Service
 *
 * Powers:
 *  - Sidebar-to-item red NotificationBadge breadcrumb counts (Programs → Attendance & Settings → Requirements)
 *  - Header Notification Bell review items with direct deep-links
 *  - Live Server-Sent Events (SSE) push notifications to connected staff/admin tabs
 *  - Server-persisted resolution stored inside existing JSONB columns (`cv_verification.staff_review`
 *    and `ocr_analysis.staff_review`) with zero schema migrations required.
 */

import { EventEmitter } from 'events';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';
import type {
  AdvisoryStaffReview,
  AdvisoryStaffReviewAction,
  AttendanceCvVerification,
  RequirementOcrAnalysis,
  ReviewAlertItem,
  ReviewAlertSeverity,
  ReviewAlertsSummary,
} from '@/types/advisory';

export const REVIEW_ALERT_LOOKBACK_DAYS = 30;
export const REVIEW_ALERT_ALLOWED_ROLES = [
  'local_admin',
  'staff_training_coordinator',
  'super_admin',
] as const;

export interface ReviewAlertStreamEvent {
  tenantId: string;
  alert: ReviewAlertItem;
}

export interface ReviewResolvedStreamEvent {
  tenantId: string;
  kind: 'cv' | 'ocr';
  id: string;
  attendanceId?: string;
  programId?: string;
  date?: string;
  fileId?: string;
  requirementDefId?: string;
  requirementType?: string;
  resolvedBy: string;
}

// shortcut: in-process EventEmitter delivers instant SSE across single-instance deployments;
// multi-instance deployments rely on the 30s frontend polling fallback until upgraded to Redis pub/sub.
class ReviewAlertEventEmitter extends EventEmitter {}

const globalForReviewAlerts = globalThis as typeof globalThis & {
  __bmdcReviewAlertEvents?: ReviewAlertEventEmitter;
};

export const reviewAlertEvents =
  globalForReviewAlerts.__bmdcReviewAlertEvents ??
  (globalForReviewAlerts.__bmdcReviewAlertEvents = new ReviewAlertEventEmitter());
reviewAlertEvents.setMaxListeners(200);

export function emitReviewAlert(tenantId: string, alert: ReviewAlertItem): void {
  reviewAlertEvents.emit('review_alert', { tenantId, alert } satisfies ReviewAlertStreamEvent);
}

export function emitReviewResolved(event: ReviewResolvedStreamEvent): void {
  reviewAlertEvents.emit('review_resolved', event);
}

// ---------------------------------------------------------------------------
// Pure Helpers (unit-testable without DB)
// ---------------------------------------------------------------------------

export function extractCvFromAttendanceRow(row: {
  cv_verification?: AttendanceCvVerification | null;
  device_info?: Record<string, unknown> | null;
}): AttendanceCvVerification | null {
  if (row.cv_verification && typeof row.cv_verification === 'object' && 'overall_status' in row.cv_verification) {
    return row.cv_verification;
  }
  const fallback = (row.device_info as Record<string, unknown> | null | undefined)?._cv_advisory;
  if (fallback && typeof fallback === 'object' && 'overall_status' in fallback) {
    return fallback as AttendanceCvVerification;
  }
  return null;
}

export function isCvAlertUnreviewed(cv: AttendanceCvVerification | null | undefined): boolean {
  if (!cv || cv.staff_review) return false;
  return cv.overall_status === 'flagged' || cv.overall_status === 'needs_review';
}

export function isOcrAlertUnreviewed(ocr: RequirementOcrAnalysis | null | undefined): boolean {
  if (!ocr || ocr.staff_review) return false;
  return ocr.status === 'flagged' || ocr.status === 'needs_review';
}

export function getCutoffIso(lookbackDays = REVIEW_ALERT_LOOKBACK_DAYS, now = new Date()): string {
  const cutoff = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  return cutoff.toISOString();
}

export function buildCvAlertItem(params: {
  attendanceId: string;
  traineeId: string;
  traineeName: string;
  programId: string;
  programName: string;
  date: string;
  cv: AttendanceCvVerification;
  createdAt: string;
}): ReviewAlertItem {
  const severity: ReviewAlertSeverity =
    params.cv.overall_status === 'flagged' ? 'flagged' : 'needs_review';

  // Pick the most actionable session reason & score for the notification summary
  const sessions = [params.cv.afternoon, params.cv.morning].filter(Boolean);
  const prioritySession =
    sessions.find((s) => s?.status === 'flagged') ??
    sessions.find((s) => s?.status === 'needs_review') ??
    sessions[0];

  const primaryReason = prioritySession?.reasons?.[0];
  const similarity = prioritySession?.similarity_score ?? null;
  const pct = similarity !== null ? `${Math.round(similarity * 100)}% match` : null;

  const label = severity === 'flagged' ? 'CV Flagged' : 'CV Review Needed';
  const details = [params.programName, params.date, pct, primaryReason].filter(Boolean).join(' · ');

  const qs = new URLSearchParams({
    date: params.date,
    recordId: params.attendanceId,
    filter: 'review',
    tab: 'records',
  });

  return {
    id: `cv-${params.attendanceId}`,
    kind: 'cv',
    severity,
    trainee_id: params.traineeId,
    trainee_name: params.traineeName,
    attendance_id: params.attendanceId,
    program_id: params.programId,
    program_name: params.programName,
    date: params.date,
    similarity_score: similarity,
    title: `${label}: ${params.traineeName}`,
    description: details || `Selfie attendance requires manual verification on ${params.date}.`,
    href: `/programs/${params.programId}/attendance?${qs.toString()}`,
    created_at: params.cv.updated_at || params.createdAt,
  };
}

export function buildOcrAlertItem(params: {
  fileId: string;
  traineeId: string;
  traineeName: string;
  requirementDefId?: string;
  requirementType: string;
  requirementName: string;
  fileName: string;
  ocr: RequirementOcrAnalysis;
  uploadedAt: string;
}): ReviewAlertItem {
  const severity: ReviewAlertSeverity =
    params.ocr.status === 'flagged' ? 'flagged' : 'needs_review';
  const label = severity === 'flagged' ? 'OCR Flagged' : 'OCR Review Needed';
  const primaryWarning = params.ocr.warnings?.[0];
  const details = [params.requirementName, primaryWarning || params.fileName]
    .filter(Boolean)
    .join(' · ');

  const href = params.requirementDefId
    ? `/admin/requirements/${params.requirementDefId}?fileId=${encodeURIComponent(params.fileId)}&filter=ocr_review`
    : `/admin/requirements`;

  return {
    id: `ocr-${params.fileId}`,
    kind: 'ocr',
    severity,
    trainee_id: params.traineeId,
    trainee_name: params.traineeName,
    file_id: params.fileId,
    requirement_def_id: params.requirementDefId,
    requirement_type: params.requirementType,
    requirement_name: params.requirementName,
    file_name: params.fileName,
    title: `${label}: ${params.traineeName}`,
    description: details || `Uploaded document requires manual review.`,
    href,
    created_at: params.ocr.analyzed_at || params.uploadedAt,
  };
}

// ---------------------------------------------------------------------------
// Summary Aggregation (30-Day Lookback, Tenant-Scoped)
// ---------------------------------------------------------------------------

export async function getReviewAlertsSummary(
  context: { tenantId: string; isSuperAdmin?: boolean },
  options?: { lookbackDays?: number; maxItems?: number }
): Promise<ReviewAlertsSummary> {
  const lookbackDays = options?.lookbackDays ?? REVIEW_ALERT_LOOKBACK_DAYS;
  const maxItems = options?.maxItems ?? 50;
  const cutoffIso = getCutoffIso(lookbackDays);

  const cvByProgram: Record<string, number> = {};
  const cvByProgramDate: Record<string, Record<string, number>> = {};
  const ocrByRequirementDef: Record<string, number> = {};
  const ocrByRequirementType: Record<string, number> = {};
  const items: ReviewAlertItem[] = [];

  // 1. Query recent attendance rows with CV verification (graceful fallback if cv_verification column not yet migrated)
  let attendanceRows: any[] = [];
  try {
    let attQuery = supabaseAdmin
      .from('attendance')
      .select(`
        id,
        tenant_id,
        trainee_id,
        session_id,
        cv_verification,
        device_info,
        updated_at,
        created_at,
        trainee:trainees(id, first_name, last_name),
        session:program_sessions!inner(
          id,
          program_id,
          session_date,
          program:programs(id, name, deleted_at)
        )
      `)
      .gte('updated_at', cutoffIso)
      .order('updated_at', { ascending: false })
      .limit(500);

    if (!context.isSuperAdmin) {
      attQuery = attQuery.eq('tenant_id', context.tenantId);
    }

    const { data, error } = await attQuery;
    if (error && /cv_verification/i.test(error.message || '')) {
      let legacyQuery = supabaseAdmin
        .from('attendance')
        .select(`
          id,
          tenant_id,
          trainee_id,
          session_id,
          device_info,
          updated_at,
          created_at,
          trainee:trainees(id, first_name, last_name),
          session:program_sessions!inner(
            id,
            program_id,
            session_date,
            program:programs(id, name, deleted_at)
          )
        `)
        .gte('updated_at', cutoffIso)
        .order('updated_at', { ascending: false })
        .limit(500);
      if (!context.isSuperAdmin) {
        legacyQuery = legacyQuery.eq('tenant_id', context.tenantId);
      }
      const { data: legacyData } = await legacyQuery;
      attendanceRows = legacyData ?? [];
    } else if (!error) {
      attendanceRows = data ?? [];
    } else {
      logger.warn('[REVIEW_ALERTS] Failed to query attendance CV alerts', { error: error.message });
    }
  } catch (err: any) {
    logger.warn('[REVIEW_ALERTS] Attendance CV query exception', { error: err?.message });
  }

  let cvTotal = 0;
  for (const row of attendanceRows) {
    const cv = extractCvFromAttendanceRow(row);
    if (!isCvAlertUnreviewed(cv) || !cv) continue;

    const session = Array.isArray(row.session) ? row.session[0] : row.session;
    const program = Array.isArray(session?.program) ? session.program[0] : session?.program;
    if (!session?.program_id || program?.deleted_at) continue;

    const programId = String(session.program_id);
    const programName = String(program?.name || 'Training Program');
    const dateKey = String(session.session_date || '').slice(0, 10);
    const trainee = Array.isArray(row.trainee) ? row.trainee[0] : row.trainee;
    const traineeName = trainee
      ? `${trainee.first_name || ''} ${trainee.last_name || ''}`.trim() || 'Trainee'
      : 'Trainee';

    cvTotal += 1;
    cvByProgram[programId] = (cvByProgram[programId] || 0) + 1;
    if (dateKey) {
      if (!cvByProgramDate[programId]) cvByProgramDate[programId] = {};
      cvByProgramDate[programId][dateKey] = (cvByProgramDate[programId][dateKey] || 0) + 1;
    }

    items.push(
      buildCvAlertItem({
        attendanceId: row.id,
        traineeId: row.trainee_id,
        traineeName,
        programId,
        programName,
        date: dateKey,
        cv,
        createdAt: row.updated_at || row.created_at,
      })
    );
  }

  // 2. Query recent training_requirement_files with OCR analysis (graceful fallback if ocr_analysis column absent)
  let fileRows: any[] = [];
  let reqDefs: any[] = [];
  try {
    let fileQuery = supabaseAdmin
      .from('training_requirement_files')
      .select(`
        id,
        tenant_id,
        trainee_id,
        requirement_type,
        file_name,
        ocr_analysis,
        uploaded_at,
        trainee:trainees(id, first_name, last_name)
      `)
      .is('deleted_at', null)
      .not('ocr_analysis', 'is', null)
      .gte('uploaded_at', cutoffIso)
      .order('uploaded_at', { ascending: false })
      .limit(500);

    if (!context.isSuperAdmin) {
      fileQuery = fileQuery.eq('tenant_id', context.tenantId);
    }

    const { data, error } = await fileQuery;
    if (error && /ocr_analysis/i.test(error.message || '')) {
      fileRows = [];
    } else if (!error) {
      fileRows = data ?? [];
    } else {
      logger.warn('[REVIEW_ALERTS] Failed to query OCR alerts', { error: error.message });
    }

    if (fileRows.length > 0) {
      let defQuery = supabaseAdmin
        .from('requirement_definitions')
        .select('id, tenant_id, requirement_type, display_name')
        .is('deleted_at', null);
      if (!context.isSuperAdmin) {
        defQuery = defQuery.eq('tenant_id', context.tenantId);
      }
      const { data: defs } = await defQuery;
      reqDefs = defs ?? [];
    }
  } catch (err: any) {
    logger.warn('[REVIEW_ALERTS] OCR alerts query exception', { error: err?.message });
  }

  const defByTenantType = new Map<string, { id: string; display_name: string }>();
  const defByType = new Map<string, { id: string; display_name: string }>();
  for (const def of reqDefs) {
    defByTenantType.set(`${def.tenant_id}::${def.requirement_type}`, {
      id: def.id,
      display_name: def.display_name || def.requirement_type,
    });
    if (!defByType.has(def.requirement_type)) {
      defByType.set(def.requirement_type, {
        id: def.id,
        display_name: def.display_name || def.requirement_type,
      });
    }
  }

  let ocrTotal = 0;
  for (const file of fileRows) {
    const ocr = file.ocr_analysis as RequirementOcrAnalysis | null | undefined;
    if (!isOcrAlertUnreviewed(ocr) || !ocr) continue;

    const def =
      defByTenantType.get(`${file.tenant_id}::${file.requirement_type}`) ??
      defByType.get(file.requirement_type);

    const trainee = Array.isArray(file.trainee) ? file.trainee[0] : file.trainee;
    const traineeName = trainee
      ? `${trainee.first_name || ''} ${trainee.last_name || ''}`.trim() || 'Trainee'
      : 'Trainee';

    const requirementName =
      def?.display_name || String(file.requirement_type || 'Requirement').replace(/_/g, ' ');

    ocrTotal += 1;
    ocrByRequirementType[file.requirement_type] =
      (ocrByRequirementType[file.requirement_type] || 0) + 1;
    if (def?.id) {
      ocrByRequirementDef[def.id] = (ocrByRequirementDef[def.id] || 0) + 1;
    }

    items.push(
      buildOcrAlertItem({
        fileId: file.id,
        traineeId: file.trainee_id,
        traineeName,
        requirementDefId: def?.id,
        requirementType: file.requirement_type,
        requirementName,
        fileName: file.file_name || file.requirement_type,
        ocr,
        uploadedAt: file.uploaded_at,
      })
    );
  }

  // Sort newest first; flag severity breaks ties cleanly
  items.sort((a, b) => {
    const timeDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (timeDiff !== 0) return timeDiff;
    return (b.severity === 'flagged' ? 1 : 0) - (a.severity === 'flagged' ? 1 : 0);
  });

  return {
    total_count: cvTotal + ocrTotal,
    cv_total: cvTotal,
    ocr_total: ocrTotal,
    cv_by_program: cvByProgram,
    cv_by_program_date: cvByProgramDate,
    ocr_by_requirement_def: ocrByRequirementDef,
    ocr_by_requirement_type: ocrByRequirementType,
    items: items.slice(0, maxItems),
    generated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Server-Persisted Resolution Helpers
// ---------------------------------------------------------------------------

export async function resolveCvReviewAlert(params: {
  tenantId: string;
  isSuperAdmin?: boolean;
  attendanceId: string;
  reviewerId: string;
  reviewerName?: string;
  action: AdvisoryStaffReviewAction;
  notes?: string;
}): Promise<{ resolved: boolean; staffReview: AdvisoryStaffReview | null; notFound?: boolean }> {
  let useLegacyColumn = false;
  let query = supabaseAdmin
    .from('attendance')
    .select('id, tenant_id, cv_verification, device_info, session:program_sessions(program_id, session_date)')
    .eq('id', params.attendanceId);
  if (!params.isSuperAdmin) {
    query = query.eq('tenant_id', params.tenantId);
  }

  let { data: row, error } = await query.maybeSingle();
  if (error && /cv_verification/i.test(error.message || '')) {
    useLegacyColumn = true;
    let legacyQuery = supabaseAdmin
      .from('attendance')
      .select('id, tenant_id, device_info, session:program_sessions(program_id, session_date)')
      .eq('id', params.attendanceId);
    if (!params.isSuperAdmin) {
      legacyQuery = legacyQuery.eq('tenant_id', params.tenantId);
    }
    const legacyRes = await legacyQuery.maybeSingle();
    row = legacyRes.data as any;
    error = legacyRes.error;
  }

  if (error) throw error;
  if (!row) return { resolved: false, staffReview: null, notFound: true };

  const existingCv = extractCvFromAttendanceRow(row as any);
  if (!existingCv) {
    return { resolved: false, staffReview: null };
  }

  const staffReview: AdvisoryStaffReview = {
    reviewed_by: params.reviewerId,
    ...(params.reviewerName ? { reviewed_by_name: params.reviewerName } : {}),
    reviewed_at: new Date().toISOString(),
    action: params.action,
    ...(params.notes ? { notes: params.notes.slice(0, 240) } : {}),
  };

  const updatedCv: AttendanceCvVerification = {
    ...existingCv,
    staff_review: staffReview,
  };

  if (useLegacyColumn || !(row as any).cv_verification) {
    const nextDeviceInfo = {
      ...(((row as any).device_info as Record<string, unknown>) || {}),
      _cv_advisory: updatedCv,
    };
    const updatePayload = useLegacyColumn
      ? { device_info: nextDeviceInfo }
      : { cv_verification: updatedCv, device_info: nextDeviceInfo };
    const { error: updateErr } = await supabaseAdmin
      .from('attendance')
      .update(updatePayload)
      .eq('id', row.id);
    if (updateErr) throw updateErr;
  } else {
    const { error: updateErr } = await supabaseAdmin
      .from('attendance')
      .update({ cv_verification: updatedCv })
      .eq('id', row.id);
    if (updateErr) throw updateErr;
  }

  const session = Array.isArray((row as any).session) ? (row as any).session[0] : (row as any).session;
  emitReviewResolved({
    tenantId: (row as any).tenant_id || params.tenantId,
    kind: 'cv',
    id: `cv-${row.id}`,
    attendanceId: row.id,
    programId: session?.program_id,
    date: session?.session_date ? String(session.session_date).slice(0, 10) : undefined,
    resolvedBy: params.reviewerId,
  });

  return { resolved: true, staffReview };
}

export async function resolveOcrReviewAlert(params: {
  tenantId: string;
  isSuperAdmin?: boolean;
  fileId: string;
  reviewerId: string;
  reviewerName?: string;
  action: AdvisoryStaffReviewAction;
  notes?: string;
}): Promise<{ resolved: boolean; staffReview: AdvisoryStaffReview | null; notFound?: boolean }> {
  let query = supabaseAdmin
    .from('training_requirement_files')
    .select('id, tenant_id, requirement_type, ocr_analysis')
    .eq('id', params.fileId)
    .is('deleted_at', null);
  if (!params.isSuperAdmin) {
    query = query.eq('tenant_id', params.tenantId);
  }

  const { data: file, error } = await query.maybeSingle();
  if (error) {
    if (/ocr_analysis/i.test(error.message || '')) {
      return { resolved: false, staffReview: null };
    }
    throw error;
  }
  if (!file) return { resolved: false, staffReview: null, notFound: true };

  const existingOcr = file.ocr_analysis as RequirementOcrAnalysis | null | undefined;
  if (!existingOcr) {
    return { resolved: false, staffReview: null };
  }

  const staffReview: AdvisoryStaffReview = {
    reviewed_by: params.reviewerId,
    ...(params.reviewerName ? { reviewed_by_name: params.reviewerName } : {}),
    reviewed_at: new Date().toISOString(),
    action: params.action,
    ...(params.notes ? { notes: params.notes.slice(0, 240) } : {}),
  };

  const updatedOcr: RequirementOcrAnalysis = {
    ...existingOcr,
    staff_review: staffReview,
  };

  const { error: updateErr } = await supabaseAdmin
    .from('training_requirement_files')
    .update({ ocr_analysis: updatedOcr })
    .eq('id', file.id);
  if (updateErr) throw updateErr;

  const { data: def } = await supabaseAdmin
    .from('requirement_definitions')
    .select('id')
    .eq('tenant_id', file.tenant_id)
    .eq('requirement_type', file.requirement_type)
    .is('deleted_at', null)
    .maybeSingle();

  emitReviewResolved({
    tenantId: file.tenant_id,
    kind: 'ocr',
    id: `ocr-${file.id}`,
    fileId: file.id,
    requirementDefId: def?.id,
    requirementType: file.requirement_type,
    resolvedBy: params.reviewerId,
  });

  return { resolved: true, staffReview };
}

export async function resolveTraineeOcrAlerts(params: {
  tenantId: string;
  traineeId: string;
  reviewerId: string;
  reviewerName?: string;
  action: AdvisoryStaffReviewAction;
}): Promise<number> {
  try {
    const { data: files, error } = await supabaseAdmin
      .from('training_requirement_files')
      .select('id, tenant_id, requirement_type, ocr_analysis')
      .eq('tenant_id', params.tenantId)
      .eq('trainee_id', params.traineeId)
      .is('deleted_at', null)
      .not('ocr_analysis', 'is', null);

    if (error || !files || files.length === 0) return 0;

    let resolvedCount = 0;
    for (const file of files) {
      const ocr = file.ocr_analysis as RequirementOcrAnalysis | null;
      if (!isOcrAlertUnreviewed(ocr)) continue;
      const res = await resolveOcrReviewAlert({
        tenantId: params.tenantId,
        fileId: file.id,
        reviewerId: params.reviewerId,
        reviewerName: params.reviewerName,
        action: params.action,
      });
      if (res.resolved) resolvedCount += 1;
    }
    return resolvedCount;
  } catch (err: any) {
    logger.warn('[REVIEW_ALERTS] Failed to auto-resolve trainee OCR alerts', {
      traineeId: params.traineeId,
      error: err?.message,
    });
    return 0;
  }
}
