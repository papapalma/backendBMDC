/**
 * POST /api/admin/file-cleanup
 *
 * Trigger the orphaned file cleanup job.
 *
 * Implements Requirement 15.9:
 *   - Identify orphaned files not referenced in the database
 *   - Clean up orphaned files (or dry-run to preview)
 *   - All deletions are logged to audit_logs
 *
 * Access: Super Admin only
 *
 * Request body (all optional):
 * {
 *   "tenantId":  "uuid",   // restrict to a specific tenant
 *   "dryRun":  true,  // preview without deleting (default: false)
 *   "minAgeHours": 24  // minimum file age before deletion (default: 24)
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { findOrphanedFiles } from '@/lib/fileCleanup';
import { forbiddenResponse, successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { logger } from '@/utils/logger';

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  // ── 1. Auth ───────────────────────────────────────────────────────────────

const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { userId, isSuperAdmin } = ctxResult.context;

  // ── 2. Super Admin only ───────────────────────────────────────────────────

if (!isSuperAdmin) {
  return forbiddenResponse('Only Super Admins can trigger file cleanup');
}

  // ── 3. Parse options ──────────────────────────────────────────────────────

const body = await request.json().catch(() => ({}));
  const {
  tenantId,
  dryRun = false,
  minAgeHours = 24,
  } = body as { tenantId?: string; dryRun?: boolean; minAgeHours?: number };

  logger.info('[FILE_CLEANUP_API] Cleanup triggered', { userId, tenantId, dryRun, minAgeHours });

  // ── 4. Run cleanup ────────────────────────────────────────────────────────

const report = await findOrphanedFiles({ tenantId, dryRun, minAgeHours });

  return successResponse(report, dryRun ? 'Dry-run complete' : 'Cleanup complete');
});
