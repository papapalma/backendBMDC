import { NextRequest, NextResponse } from 'next/server';
import { lendingService } from '@/services/lendingService';
import { requireRoleAsync } from '@/middleware/auth';
import { returnLendingSchema } from '@/utils/validators';
import { successResponse, notFoundResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';

// POST /api/lendings/:id/return - Return items from lending

export const POST = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params;
    const authResult = await requireRoleAsync(request, ['local_admin', 'staff_inventory_manager']);
    if ('error' in authResult) return authResult.error as NextResponse;

    
    const body = await request.json();
    const validatedData = returnLendingSchema.parse(body);
    
    const lending = await lendingService.returnLending(id, validatedData, authResult.user.userId);
    
    await activityLogService.logAction(
      authResult.user.userId,
      'return',
      'lending',
      id,
      validatedData
    );
    
    return successResponse(lending, 'Items returned successfully'); }
);
