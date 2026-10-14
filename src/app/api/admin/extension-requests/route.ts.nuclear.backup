/**
 * Extension Requests Admin API — Super Admin cross-tenant view
 *
 * Implements Requirement 27.3:
 *   - 27.3  GET /api/admin/extension-requests — Super Admin views all requests
 *
 * Access: Super Admin only
 */

import { NextRequest } from 'next/server';
import { withTenantContext } from '@/middleware/withTenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { successResponse, errorResponse, forbiddenResponse } from '@/utils/responses';

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const GET = withErrorHandler(
  withTenantContext(async (request, context) => {
    if (!context.isSuperAdmin) {
      return forbiddenResponse('Super Admin access required');
    }

    const { searchParams } = request.nextUrl;
    const status = searchParams.get('status') || undefined;
    const priority = searchParams.get('priority') || undefined;
    const tenantId = searchParams.get('tenant_id') || undefined;
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '20', 10));
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('extension_requests')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (tenantId) query = query.eq('tenant_id', tenantId);

    const { data, error, count } = await query;
    if (error) return errorResponse(`Failed to fetch extension requests: ${error.message}`);

    return successResponse({ data, total: count ?? 0, page, limit });
  })
);
