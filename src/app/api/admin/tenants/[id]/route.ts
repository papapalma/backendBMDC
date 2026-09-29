/**
 * GET /api/admin/tenants/:id
 *
 * Returns a specific tenant instance by its UUID.
 *
 * Implements Requirement 1.6:
 *   - Super_Admin requests tenant list → Platform returns all tenant instances
 *     with their current status and configuration summary (single-tenant variant)
 *
 * Access: Super Admin only
 *
 * Response 200:
 * { *   "success": true,
 *   "data": { *     "id": "<uuid>",
 *     "name": "Bongabong LGU",
 *     "status": "active",
 *     "contactEmail": "admin@bongabong.gov.ph",
 *     "contactPhone": "+63-912-345-6789",
 *     "address": "Bongabong, Oriental Mindoro",
 *     "configuration": { ... },
 *     "createdAt": "...",
 *     "updatedAt": "..."
 * }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { getTenantById } from '@/services/tenantProvisioningService';
import { forbiddenResponse, notFoundResponse, successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { logger } from '@/utils/logger';

// OPTIONS /api/admin/tenants/:id — CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

/**
 * GET /api/admin/tenants/:id
 *
 * Returns a specific tenant by UUID. Restricted to Super Admin role only.
 */
export const GET = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => { // ── 1. Authenticate and extract tenant context ─────────────────────────

const contextResult = requireTenantContext(request);
    if (contextResult.error) return contextResult.error as NextResponse;

    const { userId, role, isSuperAdmin } = contextResult.context;

    // ── 2. Authorise: Super Admin only ─────────────────────────────────────

if (!isSuperAdmin) { logger.warn('[TENANT_MANAGEMENT] Non-super-admin attempted to fetch tenant by id', { userId,
        role,
        url: request.url, });
      return forbiddenResponse('Only Super Admins can view tenant details'); }

    // ── 3. Resolve route param ─────────────────────────────────────────────

const { id } = await context.params;

    // ── 4. Fetch tenant ────────────────────────────────────────────────────

const tenant = await getTenantById(id);

    if (!tenant) { return notFoundResponse(`Tenant with id "${id}" not found`); }

    logger.info('[TENANT_MANAGEMENT] Tenant details retrieved', { tenantId: id,
      requestedBy: userId, });

    return successResponse(tenant); }
);
