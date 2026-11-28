/**
 * DELETE /api/archive/:id — hard-delete (purge) archived item (admin-only)
 *
 * Requirements: Archive page soft delete feature (Phase 2)
 *
 * Hard-deletes an archived item from the database after retention period passes.
 * Items must be soft-deleted (deleted_at IS NOT NULL) before they can be purged.
 * Respects ARCHIVE_RETENTION_DAYS before allowing purge.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { successResponse, forbiddenResponse, errorResponse, notFoundResponse } from '@/utils/responses';
import { ARCHIVE_TABLES, type ArchivedEntityType } from '@/utils/archiveQuery';
import { clearUserSoftDeleted } from '@/lib/userSoftDelete';
import { activityLogService } from '@/services/activityLogService';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { handleOptionsRequest } from '@/middleware/cors';

// Constants
const ARCHIVE_RETENTION_DAYS = parseInt(process.env.ARCHIVE_RETENTION_DAYS || '30', 10);

// Admin-only access check
function isAdmin(role: string | undefined): boolean {
  return role === 'local_admin' || role === 'super_admin';
}

// OPTIONS /api/archive/:id - Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// DELETE /api/archive/:id - Hard-delete (purge) archived item
export const DELETE = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error;

  const { tenantId, userId, role } = ctxResult.context;
  const { id } = await params;

  // Admin-only access
  if (!isAdmin(role)) {
    return forbiddenResponse('Only administrators can purge archived items');
  }

  const { searchParams } = new URL(request.url);
  const entityType = (searchParams.get('entityType') || '') as ArchivedEntityType;

  // Validate entity type
  if (!entityType || !ARCHIVE_TABLES[entityType]) {
    return errorResponse('Invalid or missing entityType parameter', 400);
  }

  const tableName = ARCHIVE_TABLES[entityType];

  // Fetch the item to check if it exists and is soft-deleted
  let item: { id: string; deleted_at: string | null; email?: string; role?: string } | null = null;
  if (entityType === 'user') {
    const { data: userTenant, error: tenantCheckError } = await supabaseAdmin
      .from('users_tenants')
      .select('user_id')
      .eq('tenant_id', tenantId)
      .eq('user_id', id)
      .maybeSingle();

    if (tenantCheckError) {
      return errorResponse(`Failed to fetch item: ${tenantCheckError.message}`, 500);
    }

    if (!userTenant) {
      return notFoundResponse('Item not found or already purged');
    }

    const { data: userRow, error: userFetchError } = await supabaseAdmin
      .from('users')
      .select('id, email, role, deleted_at')
      .eq('id', id)
      .maybeSingle();

    if (userFetchError) {
      return errorResponse(`Failed to fetch item: ${userFetchError.message}`, 500);
    }

    if (!userRow) {
      return notFoundResponse('Item not found or already purged');
    }

    if (userRow.email === 'admin@bmdc.edu.ph' || userRow.role === 'super_admin') {
      return forbiddenResponse('Cannot purge a protected admin account');
    }

    item = userRow;
  } else {
    const { data: items, error: fetchError } = await supabaseAdmin
      .from(tableName)
      .select('id, deleted_at')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .limit(1);

    if (fetchError) {
      return errorResponse(`Failed to fetch item: ${fetchError.message}`, 500);
    }

    if (!items || items.length === 0) {
      return notFoundResponse('Item not found or already purged');
    }

    item = items[0];
  }

  // Verify item is soft-deleted
  if (!item || !item.deleted_at) {
    return errorResponse('Item is not archived (not soft-deleted)', 400);
  }

  // Check retention period
  const deletedAt = new Date(item.deleted_at);
  const now = new Date();
  const daysSinceDeleted = Math.floor((now.getTime() - deletedAt.getTime()) / (1000 * 60 * 60 * 24));
  const daysRemaining = Math.max(0, ARCHIVE_RETENTION_DAYS - daysSinceDeleted);
  const eligibleForPurge = daysRemaining === 0;

  if (!eligibleForPurge) {
    return errorResponse(
      `Item is not eligible for purge yet. Days remaining: ${daysRemaining}`,
      400
    );
  }

  // Hard-delete the item
  try {
    if (entityType === 'user') {
      const { data: tenantLinks, error: linksError } = await supabaseAdmin
        .from('users_tenants')
        .select('tenant_id')
        .eq('user_id', id);

      if (linksError) {
        return errorResponse(`Failed to purge item: ${linksError.message}`, 500);
      }

      if ((tenantLinks?.length ?? 0) > 1) {
        // Multi-tenant safety: unlink only from this tenant rather than deleting another tenant's account
        const { error: unlinkError } = await supabaseAdmin
          .from('users_tenants')
          .delete()
          .eq('user_id', id)
          .eq('tenant_id', tenantId);

        if (unlinkError) {
          return errorResponse(`Failed to purge item: ${unlinkError.message}`, 500);
        }
      } else {
        const { error: deleteError } = await supabaseAdmin
          .from('users')
          .delete()
          .eq('id', id);

        if (deleteError) {
          return errorResponse(`Failed to purge item: ${deleteError.message}`, 500);
        }
      }

      clearUserSoftDeleted(id);
    } else {
      const { error: deleteError } = await supabaseAdmin
        .from(tableName)
        .delete()
        .eq('id', id)
        .eq('tenant_id', tenantId);

      if (deleteError) {
        return errorResponse(`Failed to purge item: ${deleteError.message}`, 500);
      }
    }

    // Log the purge action
    await activityLogService.logAction(
      userId,
      'purge',
      entityType,
      id,
      { daysRetained: daysSinceDeleted },
      request,
      tenantId
    );

    return successResponse(
      {
        success: true,
        purged: true,
        id,
        entityType,
      },
      'Item purged successfully'
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error during purge';
    return errorResponse(`Purge failed: ${errorMsg}`, 500);
  }
});
