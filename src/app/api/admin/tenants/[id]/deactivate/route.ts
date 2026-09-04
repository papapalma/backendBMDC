/**
 * PATCH /api/admin/tenants/:id/deactivate
 *
 * Deactivates a tenant instance — prevents all user access while preserving data.
 *
 * Implements Requirement 1.7:
 *   - WHEN the Super_Admin deactivates a tenant, THE Platform SHALL prevent all
 *     user access to that Instance while preserving data.
 *
 * Access: Super Admin only
 *
 * Response 200:
 * { *   "success": true,
 *   "data": { *     "id": "<uuid>",
 *     "name": "Bongabong LGU",
 *     "status": "inactive",
 *     ...
 * },
 *   "message": "Tenant deactivated successfully"
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { deactivateTenant } from '@/services/tenantProvisioningService';
import { forbiddenResponse, successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { logger } from '@/utils/logger';

// OPTIONS /api/admin/tenants/:id/deactivate — CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

/**
 * PATCH /api/admin/tenants/:id/deactivate
 *
 * Sets the tenant status to 'inactive'. Restricted to Super Admin role only.
 */
export const PATCH = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => { // ── 1. Authenticate and extract tenant context ─────────────────────────

const contextResult = requireTenantContext(request);
    if (contextResult.error) return contextResult.error as NextResponse;

    const { userId, role, isSuperAdmin } = contextResult.context;

    // ── 2. Authorise: Super Admin only ─────────────────────────────────────

if (!isSuperAdmin) { logger.warn('[TENANT_MANAGEMENT] Non-super-admin attempted to deactivate tenant', { userId,
        role,
        url: request.url, });
      return forbiddenResponse('Only Super Admins can deactivate tenants'); }

    // ── 3. Resolve route param ─────────────────────────────────────────────

const { id } = await context.params;

    // ── 4. Deactivate tenant ───────────────────────────────────────────────
    logger.info('[TENANT_MANAGEMENT] Deactivating tenant', { tenantId: id,
      requestedBy: userId, });

    const updatedTenant = await deactivateTenant(id);

    logger.info('[TENANT_MANAGEMENT] Tenant deactivated successfully', { tenantId: id,
      requestedBy: userId, });

    return successResponse(updatedTenant, 'Tenant deactivated successfully'); }
);
