/**
 * GET  /api/archive  — list archived items (admin-only)
 * PATCH /api/archive — restore archived items (admin-only)
 *
 * Requirements: Archive page soft delete feature (Phase 2)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { successResponse, forbiddenResponse, errorResponse, paginatedResponse } from '@/utils/responses';
import { queryArchivedItems, ARCHIVE_TABLES, type ArchivedEntityType } from '@/utils/archiveQuery';
import { traineeService } from '@/services/traineeService';
import { traineeStatusService } from '@/services/traineeStatusService';
import { activityLogService } from '@/services/activityLogService';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { handleOptionsRequest } from '@/middleware/cors';

// Constants
const ARCHIVE_RETENTION_DAYS = parseInt(process.env.ARCHIVE_RETENTION_DAYS || '30', 10);

// Admin-only access check
function isAdmin(role: string | undefined): boolean {
  return role === 'local_admin' || role === 'super_admin';
}

// OPTIONS /api/archive - Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/archive - List archived items with pagination and filtering
export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error;

  const { tenantId, userId, role } = ctxResult.context;

  // Admin-only access
  if (!isAdmin(role)) {
    return forbiddenResponse('Only administrators can access archived items');
  }

  const { searchParams } = new URL(request.url);
  const entityType = (searchParams.get('entityType') || '') as ArchivedEntityType;
  const search = searchParams.get('search') || undefined;
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const sortBy = searchParams.get('sortBy') || 'deleted_at';
  const sortOrder = (searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc';

  // Validate entity type
  if (!entityType || !ARCHIVE_TABLES[entityType]) {
    return errorResponse('Invalid or missing entityType parameter', 400);
  }

  const tableName = ARCHIVE_TABLES[entityType];

  // Query archived items
  const result = await queryArchivedItems(supabaseAdmin, tableName, tenantId, {
    page,
    limit,
    sortBy,
    sortOrder,
    search,
  }).catch((err) => {
    console.error(`[ARCHIVE] Error querying ${tableName}:`, err);
    throw err;
  });

  // Calculate daysRemaining for each item
  const itemsWithDaysRemaining = result.data.map((item: any) => {
    const deletedAt = new Date(item.deleted_at);
    const now = new Date();
    const daysSinceDeleted = Math.floor((now.getTime() - deletedAt.getTime()) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.max(0, ARCHIVE_RETENTION_DAYS - daysSinceDeleted);
    const eligibleForPurge = daysRemaining === 0;

    return {
      ...item,
      daysSinceDeleted,
      daysRemaining,
      eligibleForPurge,
    };
  });

  return paginatedResponse(
    itemsWithDaysRemaining,
    result.page,
    result.limit,
    result.count
  );
});

// PATCH /api/archive - Restore archived items
export const PATCH = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error;

  const { tenantId, userId, role } = ctxResult.context;

  // Admin-only access
  if (!isAdmin(role)) {
    return forbiddenResponse('Only administrators can restore archived items');
  }

  const body = await request.json();
  const { entityType, ids } = body;

  // Validate input
  if (!entityType || !ARCHIVE_TABLES[entityType as ArchivedEntityType]) {
    return errorResponse('Invalid or missing entityType', 400);
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return errorResponse('ids must be a non-empty array', 400);
  }

  const restored: string[] = [];
  const failed: { id: string; error: string }[] = [];

  // Restore each item based on entity type
  for (const id of ids) {
    try {
      switch (entityType as ArchivedEntityType) {
        case 'trainee':
          await traineeService.restoreTrainee(id);
          await activityLogService.logAction(
            userId,
            'restore',
            'trainee',
            id,
            { entityType },
            request,
            tenantId
          );
          restored.push(id);
          break;

        case 'program':
          // Restore program: update deleted_at to null
          await supabaseAdmin
            .from('programs')
            .update({ deleted_at: null })
            .eq('id', id)
            .eq('tenant_id', tenantId);
          await activityLogService.logAction(
            userId,
            'restore',
            'program',
            id,
            { entityType },
            request,
            tenantId
          );
          restored.push(id);
          break;

        case 'trainee_status':
          await traineeStatusService.restoreTraineeStatus(id, tenantId);
          await activityLogService.logAction(
            userId,
            'restore',
            'trainee_status_record',
            id,
            { entityType },
            request,
            tenantId
          );
          restored.push(id);
          break;

        case 'training_requirement_file':
          // Restore training requirement file: update deleted_at to null
          await supabaseAdmin
            .from('training_requirement_files')
            .update({ deleted_at: null })
            .eq('id', id)
            .eq('tenant_id', tenantId);
          await activityLogService.logAction(
            userId,
            'restore',
            'training_requirement_file',
            id,
            { entityType },
            request,
            tenantId
          );
          restored.push(id);
          break;

        default:
          failed.push({
            id,
            error: `Unknown entity type: ${entityType}`,
          });
      }
    } catch (error) {
      failed.push({
        id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return successResponse({
    success: restored.length > 0 && failed.length === 0,
    restored,
    failed,
    restoredCount: restored.length,
    failedCount: failed.length,
  });
});
