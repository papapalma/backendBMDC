/**
 * POST /api/admin/data-retention
 *
 * Trigger the data retention and cleanup policy execution.
 *
 * Implements Requirement 21 (Data Retention Policy):
 *   - Audit logs: 90 days
 *   - Temporary files (GPS/selfies): 30 days
 *   - Failed auth attempts: 30 days
 *   - Soft-deleted records: 90 days, then hard delete
 *
 * Access: Super Admin only (platform-level operation)
 *
 * Response:
 *   {
 *     success: true,
 *     data: {
 *       executedAt: "2024-10-05T14:30:00Z",
 *       policies: [
 *         { name: "audit_logs_retention", recordsDeleted: 150, ... },
 *         { name: "failed_auth_retention", recordsDeleted: 12, ... },
 *         { name: "soft_delete_purge", recordsDeleted: 5, ... },
 *         { name: "temporary_files_cleanup", recordsDeleted: 23, ... }
 *       ],
 *       totalRecordsDeleted: 190,
 *       success: true
 *     },
 *     message: "Data retention policy executed successfully"
 *   }
 *
 * Can be called by:
 *   - Manual admin trigger (Super Admin UI)
 *   - External scheduler (cron job, GitHub Actions, AWS Lambda, etc.)
 *   - CI/CD pipeline
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { executeRetentionPolicy, logRetentionExecution } from '@/lib/dataRetention';
import { forbiddenResponse, successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';

export const POST = withErrorHandler(async (request: NextRequest) => {
  // ── 1. Authenticate & check authorization ─────────────────────────────────

  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error;

  const { userId, isSuperAdmin } = ctxResult.context;

  // Data retention is a platform-level operation (Super Admin only)
  if (!isSuperAdmin) {
    return forbiddenResponse('Only Super Admins can execute data retention policy');
  }

  logger.info('[DATA_RETENTION_API] Retention policy triggered', { userId });

  // ── 2. Execute retention policy ────────────────────────────────────────────

  const report = await executeRetentionPolicy();

  // ── 3. Log execution to audit trail ────────────────────────────────────────

  await logRetentionExecution(report);

  // ── 4. Return results ─────────────────────────────────────────────────────

  return successResponse(
    report,
    report.success
      ? `Data retention policy executed successfully. ${report.totalRecordsDeleted} records processed.`
      : 'Data retention policy executed with errors. Check policies array for details.'
  );
});
