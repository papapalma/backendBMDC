/**
 * Extension Request Review API — Super Admin
 *
 * Implements Requirement 27.3:
 *   - PATCH /api/admin/extension-requests/:id — status update and review
 *
 * Access: Super Admin only
 */

import { NextRequest } from 'next/server';
import { withTenantContext } from '@/middleware/withTenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { successResponse,
  errorResponse,
  forbiddenResponse,
  notFoundResponse, } from '@/utils/responses';
import { logConfigChange, AuditAction } from '@/lib/auditLog';

const VALID_STATUSES = [
  'submitted',
  'under_review',
  'approved',
  'in_development',
  'deployed',
  'rejected',
] as const;

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

export const PATCH = withErrorHandler(
  withTenantContext(async (request, context, params) => { if (!context.isSuperAdmin) { return forbiddenResponse('Super Admin access required'); }

const id = params?.id;
  if (!id) return errorResponse('Request ID is required');

  const body = await request.json();
  const { status, review_notes } = body;

  if (!status) return errorResponse('status is required');

  if (!VALID_STATUSES.includes(status)) { return errorResponse(
  `status must be one of: ${VALID_STATUSES.join(', ')}`
  ); }

  // Verify the request exists

const { data: existing, error: fetchError } = await supabaseAdmin
  .from('extension_requests')
  .select('id, title, tenant_id, status')
  .eq('id', id)
  .maybeSingle();

  if (fetchError) return errorResponse(`Failed to fetch request: ${fetchError.message}`);

  if (!existing) return notFoundResponse('Extension request not found');

  const { data, error } = await supabaseAdmin
  .from('extension_requests')
  .update({ status,
  review_notes: review_notes?.trim() ?? null,
  reviewed_by: context.userId,
  reviewed_at: new Date().toISOString(),
  updated_at: new Date().toISOString(), })
  .eq('id', id)
  .select()
  .single();

  if (error) return errorResponse(`Failed to update request: ${error.message}`);

  await logConfigChange({ userId: context.userId,
  tenantId: existing.tenant_id,
  action: AuditAction.CONFIG_TENANT_UPDATED,
  entityType: 'extension_request',
  entityId: id,
  details: { previousStatus: existing.status, newStatus: status },
  request, });

  return successResponse(data, `Extension request ${status}`); })
);
