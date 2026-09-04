import { NextRequest, NextResponse } from 'next/server';
import { anomalyService } from '@/services/anomalyService';
import { requireRoleAsync } from '@/middleware/auth';
import { resolveAnomalySchema } from '@/utils/validators';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';

// POST /api/anomalies/:id/resolve - Resolve anomaly

export const POST = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params;
    const authResult = await requireRoleAsync(request, ['local_admin', 'staff_inventory_manager', 'staff_training_coordinator']);
    if ('error' in authResult) return authResult.error as NextResponse;

    
    const body = await request.json();
    const validatedData = resolveAnomalySchema.parse(body);
    
    const anomaly = await anomalyService.resolveAnomaly(
      id,
      validatedData,
      authResult.user.userId
    );
    
    await activityLogService.logAction(
      authResult.user.userId,
      'resolve',
      'anomaly',
      id,
      validatedData
    );
    
    return successResponse(anomaly, 'Anomaly resolved successfully'); }
);
