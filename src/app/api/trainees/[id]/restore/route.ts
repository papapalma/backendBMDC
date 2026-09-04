/**
 * POST /api/trainees/:id/restore — restore a soft-deleted trainee
 *
 * Restores a trainee that was previously soft-deleted. Only admin users can restore trainees.
 * The trainee record is marked as active (deleted_at is set to null).
 *
 * Requirements: 9.10 (tenant-scoped access)
 */
import { NextRequest, NextResponse } from 'next/server';
import { traineeService } from '@/services/traineeService';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, notFoundResponse, forbiddenResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/trainees/:id/restore - Handle CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// POST /api/trainees/:id/restore - Restore a soft-deleted trainee

export const POST = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;

  const adminRoles = ['local_admin', 'super_admin'];
  if (!adminRoles.includes(context.role)) { return forbiddenResponse('Insufficient permissions to restore trainees'); }

const { id } = await params;

  // Check if trainee exists (including deleted ones)

const trainee = await traineeService.getTraineeById(context, id, true);
  if (!trainee) { return notFoundResponse('Trainee not found'); }

  // Check if trainee is actually deleted (deleted_at should not be null to restore)

if (trainee.deleted_at === null || trainee.deleted_at === undefined) { return successResponse(trainee, 'Trainee is not deleted'); }

const restoredTrainee = await traineeService.restoreTrainee(id);

  await activityLogService.logAction(
  context.userId,
  'restore',
  'trainee',
  id,
  { restored_at: new Date().toISOString() },
  undefined,
  context.tenantId
  );

  return successResponse(restoredTrainee, 'Trainee restored successfully'); }
);
