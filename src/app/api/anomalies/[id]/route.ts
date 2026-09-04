import { NextRequest, NextResponse } from 'next/server';
import { anomalyService } from '@/services/anomalyService';
import { requireAuthAsync } from '@/middleware/auth';
import { successResponse, notFoundResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/anomalies/:id - Handle CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// GET /api/anomalies/:id - Get anomaly by ID

export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params;
    const authResult = await requireAuthAsync(request);
    if ('error' in authResult) return authResult.error as NextResponse;

    
    const anomaly = await anomalyService.getAnomalyById(id);
    
    if (!anomaly) { return notFoundResponse('Anomaly not found'); }
    
    return successResponse(anomaly); }
);
