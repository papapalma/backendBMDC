import { NextRequest, NextResponse } from 'next/server';
import { lendingService } from '@/services/lendingService';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, notFoundResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/lendings/:id - Handle CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }
// GET /api/lendings/:id - Get lending by ID (tenant-scoped)

export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params;
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const lending = await lendingService.getLendingById(ctxResult.context, id);

    if (!lending) { return notFoundResponse('Lending not found'); }

    return successResponse(lending); }
);
