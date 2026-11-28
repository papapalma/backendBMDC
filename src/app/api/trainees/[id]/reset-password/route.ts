/**
 * POST /api/trainees/:id/reset-password — Reset trainee password to default Admin123
 *
 * Requirements: Admin role (local_admin, super_admin) with tenant-scoped access
 */
import { NextRequest, NextResponse } from 'next/server';
import { traineeService } from '@/services/traineeService';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, notFoundResponse, forbiddenResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';
import { handleOptionsRequest } from '@/middleware/cors';

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const POST = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const context = ctxResult.context;
    const adminRoles = ['local_admin', 'super_admin'];
    if (!adminRoles.includes(context.role)) {
      return forbiddenResponse('Insufficient permissions to reset trainee passwords');
    }

    const { id } = await params;
    const trainee = await traineeService.getTraineeById(context, id);
    if (!trainee) {
      return notFoundResponse('Trainee not found');
    }

    const result = await traineeService.resetTraineePassword(context, id);

    await activityLogService.logAction(
      context.userId,
      'reset_password',
      'trainee',
      id,
      { email: result.email, default_password: result.default_password },
      undefined,
      context.tenantId
    );

    return successResponse(result, 'Trainee password reset to default successfully');
  }
);
