/**
 * PATCH /api/admin/tenants/:id/reactivate
 *
 * Reactivates a tenant instance — restores user access.
 *
 * Implements Requirement 1.8:
 *   - WHEN the Super_Admin reactivates a tenant, THE Platform SHALL restore
 *     user access to that Instance.
 *
 * Access: Super Admin only
 *
 * Response 200:
 * { *   "success": true,
 *   "data": { *     "id": "<uuid>",
 *     "name": "Bongabong LGU",
 *     "status": "active",
 *     ...
 * },
 *   "message": "Tenant reactivated successfully"
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { reactivateTenant } from '@/services/tenantProvisioningService';
import { forbiddenResponse, successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { logger } from '@/utils/logger';

// OPTIONS /api/admin/tenants/:id/reactivate — CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

/**
 * PATCH /api/admin/tenants/:id/reactivate
 *
 * Sets the tenant status back to 'active'. Restricted to Super Admin role only.
 */
export const PATCH = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => { // ── 1. Authenticate and extract tenant context ─────────────────────────

const contextResult = requireTenantContext(request);
    if (contextResult.error) return contextResult.error as NextResponse;

    const { userId, role, isSuperAdmin } = contextResult.context;

    // ── 2. Authorise: Super Admin only ─────────────────────────────────────

if (!isSuperAdmin) { logger.warn('[TENANT_MANAGEMENT] Non-super-admin attempted to reactivate tenant', { userId,
        role,
        url: request.url, });
      return forbiddenResponse('Only Super Admins can reactivate tenants'); }

    // ── 3. Resolve route param ─────────────────────────────────────────────

const { id } = await context.params;

    // ── 4. Reactivate tenant ───────────────────────────────────────────────
    logger.info('[TENANT_MANAGEMENT] Reactivating tenant', { tenantId: id,
      requestedBy: userId, });

    const updatedTenant = await reactivateTenant(id);

    logger.info('[TENANT_MANAGEMENT] Tenant reactivated successfully', { tenantId: id,
      requestedBy: userId, });

    return successResponse(updatedTenant, 'Tenant reactivated successfully'); }
);
