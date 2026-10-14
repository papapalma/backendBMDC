/**
 * GET /api/certificates/:id  — get certificate by ID (tenant-scoped, Req 16.9)
 *
 * Requirements: 16.9
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, notFoundResponse, forbiddenResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { getCertificateById } from '@/services/certificateService';

// OPTIONS /api/certificates/:id

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// GET /api/certificates/:id — get certificate by ID (Req 16.9)

export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const { tenantId, role } = ctxResult.context;

    const allowedRoles = [
      'local_admin',
      'staff_training_coordinator',
      'staff_inventory_manager',
      'trainee',
    ];
    if (!allowedRoles.includes(role)) { return forbiddenResponse('Insufficient permissions'); }

const { id } = await params;
    const certificate = await getCertificateById(id, tenantId);

    if (!certificate) { return notFoundResponse('Certificate not found'); }

    return successResponse(certificate); }
);
