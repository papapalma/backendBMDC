import { NextRequest, NextResponse } from 'next/server';
import { anomalyService } from '@/services/anomalyService';
import { requireRoleAsync } from '@/middleware/auth';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { activityLogService } from '@/services/activityLogService';

// OPTIONS /api/anomalies/:id/reopen - Handle CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// POST /api/anomalies/:id/reopen - Reopen a resolved or dismissed anomaly

export const POST = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params;
    const authResult = await requireRoleAsync(request, ['local_admin', 'staff_inventory_manager', 'staff_training_coordinator']);
    if ('error' in authResult) return authResult.error as NextResponse;

    const anomaly = await anomalyService.reopenAnomaly(id, authResult.user.userId);

    await activityLogService.logAction(
      authResult.user.userId,
      'reopen',
      'anomaly',
      id,
      { email: authResult.user.email }
    );

    return successResponse(anomaly, 'Anomaly reopened successfully'); }
);
