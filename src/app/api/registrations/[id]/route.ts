import { NextRequest, NextResponse } from 'next/server';
import { registrationService } from '@/services/registrationService';
import { requireRoleAsync } from '@/middleware/auth';
import { requireTenantContext } from '@/middleware/tenantContext';
import { reviewRegistrationSchema } from '@/utils/validators';
import { successResponse, errorResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/registrations/[id]

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// GET /api/registrations/[id] - Get a single registration

export const GET = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const authResult = await requireRoleAsync(request, ['local_admin', 'staff_training_coordinator', 'staff_inventory_manager']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;

  const resolvedParams = await params;
  const registration = await registrationService.getRegistrationById(context, resolvedParams.id);
  if (!registration) return errorResponse('Registration not found', 404);

  return successResponse(registration); });

// PATCH /api/registrations/[id] - Approve or reject a registration

export const PATCH = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const authResult = await requireRoleAsync(request, ['local_admin', 'staff_training_coordinator']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;

  const body = await request.json();
  const { action, rejection_reason } = reviewRegistrationSchema.parse(body);
  // Ensure registration exists and belongs to the tenant (or super admin)

const resolvedParams = await params;
  const existing = await registrationService.getRegistrationById(context, resolvedParams.id);
  if (!existing) return errorResponse('Registration not found', 404);

  if (action === 'approve') { const result = await registrationService.approveRegistration(resolvedParams.id, authResult.user.userId);

    await activityLogService.logAction(
      authResult.user.userId,
      'approve_registration',
      'trainee',
      result.trainee.id,
      { registration_id: resolvedParams.id }
    );

    const message = 'Registration approved. Trainee account processed successfully.';

    return successResponse(result, message); } else { await registrationService.rejectRegistration(resolvedParams.id, authResult.user.userId, rejection_reason);

    await activityLogService.logAction(
      authResult.user.userId,
      'reject_registration',
      'trainee',
      resolvedParams.id,
      { rejection_reason }
    );

    return successResponse(null, 'Registration rejected.'); } });
