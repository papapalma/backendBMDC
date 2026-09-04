import { NextRequest, NextResponse } from 'next/server';
import { anomalyService } from '@/services/anomalyService';
import { requireAuthAsync } from '@/middleware/auth';
import { successResponse, notFoundResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/anomalies/runs/:id - Handle CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// GET /api/anomalies/runs/:id - Get anomaly detection run details

export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params;
    const authResult = await requireAuthAsync(request);
    if ('error' in authResult) return authResult.error as NextResponse;

    const run = await anomalyService.getDetectionRunById(id);
    if (!run) { return notFoundResponse('Detection run not found'); }

    return successResponse(run); }
);
