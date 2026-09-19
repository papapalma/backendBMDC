/**
 * Extension Requests API — Tenant-scoped
 *
 * Implements Requirements 27.1, 27.2:
 *   - 27.1  POST /api/extension-requests — LGU submits a feature request
 *   - 27.2  GET  /api/extension-requests — returns tenant-scoped requests
 *
 * Access: Local Admin and above (tenant-scoped)
 */

import { NextRequest } from 'next/server';
import { withTenantContext } from '@/middleware/withTenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  successResponse,
  createdResponse,
  errorResponse,
  forbiddenResponse,
} from '@/utils/responses';
import { writeAuditLog, AuditAction } from '@/lib/auditLog';

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// ---------------------------------------------------------------------------
// GET /api/extension-requests — list tenant-scoped requests
// ---------------------------------------------------------------------------
export const GET = withErrorHandler(
  withTenantContext(async (request, context) => {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get('status') || undefined;
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = Math.min(50, parseInt(searchParams.get('limit') ?? '20', 10));
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('extension_requests')
      .select('*', { count: 'exact' });

    // Super admins see all requests if they access this endpoint
    // (though they should use /api/admin/extension-requests instead)
    if (!context.isSuperAdmin) {
      query = query.eq('tenant_id', context.tenantId);
    }

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);

    const { data, error, count } = await query;
    if (error) return errorResponse(`Failed to fetch extension requests: ${error.message}`);

    return successResponse({ data, total: count ?? 0, page, limit });
  })
);

// ---------------------------------------------------------------------------
// POST /api/extension-requests — submit a new feature request
// ---------------------------------------------------------------------------
export const POST = withErrorHandler(
  withTenantContext(async (request, context) => {
    // Only local_admin can submit extension requests
    if (!['local_admin', 'super_admin'].includes(context.role)) {
      return forbiddenResponse('Only Local Admins can submit extension requests');
    }

    const body = await request.json();
    const { title, description, business_justification, priority, affected_users_count } = body;

    if (!title?.trim()) return errorResponse('title is required');
    if (!description?.trim()) return errorResponse('description is required');
    if (!priority) return errorResponse('priority is required');
    if (!['low', 'medium', 'high', 'critical'].includes(priority)) {
      return errorResponse('priority must be one of: low, medium, high, critical');
    }

    const { data, error } = await supabaseAdmin
      .from('extension_requests')
      .insert({
        tenant_id: context.tenantId,
        requested_by: context.userId,
        title: title.trim(),
        description: description.trim(),
        business_justification: business_justification?.trim() ?? null,
        priority,
        affected_users_count: affected_users_count ?? null,
        status: 'submitted',
      })
      .select()
      .single();

    if (error) return errorResponse(`Failed to create extension request: ${error.message}`);

    await writeAuditLog({
      tenantId: context.tenantId,
      userId: context.userId,
      action: AuditAction.DATA_CREATE,
      entityType: 'extension_request',
      entityId: data.id,
      details: { title, priority },
    });

    return createdResponse(data, 'Extension request submitted successfully');
  })
);
