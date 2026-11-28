/**
 * POST /api/review-alerts/resolve
 *
 * Persists an authoritative staff review decision inside `cv_verification.staff_review`
 * or `ocr_analysis.staff_review`, clearing the alert across all connected admin clients.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenantContext } from '@/middleware/tenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { forbiddenResponse, notFoundResponse, successResponse } from '@/utils/responses';
import { activityLogService } from '@/services/activityLogService';
import {
  resolveCvReviewAlert,
  resolveOcrReviewAlert,
  REVIEW_ALERT_ALLOWED_ROLES,
} from '@/services/reviewAlertService';

const resolveSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('cv'),
    attendance_id: z.string().uuid('Invalid attendance_id'),
    action: z.enum(['override', 'confirmed']).default('confirmed'),
    notes: z.string().max(240).optional(),
  }),
  z.object({
    kind: z.literal('ocr'),
    file_id: z.string().uuid('Invalid file_id'),
    action: z.enum(['confirmed', 'verified', 'rejected', 'waived']).default('confirmed'),
    notes: z.string().max(240).optional(),
  }),
]);

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role, isSuperAdmin } = ctxResult.context;
  if (!(REVIEW_ALERT_ALLOWED_ROLES as readonly string[]).includes(role)) {
    return forbiddenResponse('Insufficient permissions to resolve review alerts');
  }

  const body = await request.json();
  const payload = resolveSchema.parse(body);

  if (payload.kind === 'cv') {
    const result = await resolveCvReviewAlert({
      tenantId,
      isSuperAdmin,
      attendanceId: payload.attendance_id,
      reviewerId: userId,
      action: payload.action,
      notes: payload.notes,
    });

    if (result.notFound) {
      return notFoundResponse('Attendance record not found');
    }

    await activityLogService.logAction(
      userId,
      'resolve_cv_review',
      'attendance',
      payload.attendance_id,
      { action: payload.action, tenantId }
    );

    return successResponse(
      { resolved: result.resolved, staff_review: result.staffReview },
      'CV review marked as resolved'
    );
  }

  const result = await resolveOcrReviewAlert({
    tenantId,
    isSuperAdmin,
    fileId: payload.file_id,
    reviewerId: userId,
    action: payload.action,
    notes: payload.notes,
  });

  if (result.notFound) {
    return notFoundResponse('Requirement file not found');
  }

  await activityLogService.logAction(
    userId,
    'resolve_ocr_review',
    'trainee',
    payload.file_id,
    { action: payload.action, tenantId }
  );

  return successResponse(
    { resolved: result.resolved, staff_review: result.staffReview },
    'OCR document review marked as resolved'
  );
});
