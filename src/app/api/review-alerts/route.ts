/**
 * GET /api/review-alerts
 *
 * Returns tenant-scoped unreviewed Face CV & Document OCR advisory alert counts
 * (grouped by program, calendar date, and requirement definition) plus deep-link items
 * for the last 30 days.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { forbiddenResponse, successResponse } from '@/utils/responses';
import {
  getReviewAlertsSummary,
  REVIEW_ALERT_ALLOWED_ROLES,
} from '@/services/reviewAlertService';

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;
  if (!(REVIEW_ALERT_ALLOWED_ROLES as readonly string[]).includes(context.role)) {
    return forbiddenResponse('Insufficient permissions to view review alerts');
  }

  const summary = await getReviewAlertsSummary({
    tenantId: context.tenantId,
    isSuperAdmin: context.isSuperAdmin,
  });

  return successResponse(summary);
});
