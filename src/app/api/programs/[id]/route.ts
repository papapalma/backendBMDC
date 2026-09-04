/**
 * GET  /api/programs/:id  — get program by ID (tenant-scoped)
 * PUT  /api/programs/:id  — update program (tenant-scoped)
 * DELETE /api/programs/:id  — delete program (tenant-scoped)
 *
 * Requirements: 7.3, 7.8, 7.9
 */
import { NextRequest, NextResponse } from 'next/server';
import { programService } from '@/services/programService';
import { requireTenantContext } from '@/middleware/tenantContext';
import { updateProgramSchema } from '@/utils/validators';
import { successResponse, notFoundResponse, noContentResponse, forbiddenResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/programs/:id - Handle CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// GET /api/programs/:id - Get program by ID (tenant-scoped, Req 7.3, 7.8)

export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, isSuperAdmin } = ctxResult.context;

  const { id } = await params;
  const program = await programService.getProgramById(id, isSuperAdmin ? undefined : tenantId);

  if (!program) { return notFoundResponse('Program not found'); }

  // Enrich program with current enrollment count
  const enrichedProgram = await programService.enrichProgramWithEnrollment(program);

  return successResponse(enrichedProgram); }
);

// PUT /api/programs/:id - Update program (tenant-scoped, Req 7.3)

export const PUT = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role, isSuperAdmin } = ctxResult.context;

  const allowedRoles = ['local_admin', 'staff_training_coordinator'];
  if (!allowedRoles.includes(role)) { return forbiddenResponse('Insufficient permissions to update programs'); }

const { id } = await params;

  // Verify the program belongs to this tenant before updating (Req 7.8)

const existing = await programService.getProgramById(id, isSuperAdmin ? undefined : tenantId);
  if (!existing) { return notFoundResponse('Program not found'); }

const body = await request.json();
  const validatedData = updateProgramSchema.parse(body);

  // If enrollment_limit is being updated, validate it doesn't drop below current enrollment
  if (validatedData.enrollment_limit !== undefined) {
    const validation = await programService.validateEnrollmentLimitUpdate(
      id,
      validatedData.enrollment_limit,
      isSuperAdmin ? existing.tenant_id || tenantId : tenantId
    );

    if (!validation.valid) {
      return NextResponse.json({
        success: false,
        errors: [{
          field: 'enrollment_limit',
          message: validation.error || 'Enrollment limit validation failed'
        }]
      }, { status: 400 });
    }
  }

  const program = await programService.updateProgram(id, validatedData);

  // Enrich program with current enrollment count
  const enrichedProgram = await programService.enrichProgramWithEnrollment(program);

  await activityLogService.logAction(userId, 'update', 'program', id, { name: validatedData.name }, undefined, tenantId);

  return successResponse(enrichedProgram, 'Program updated successfully'); }
);

// DELETE /api/programs/:id - Delete program (tenant-scoped, Req 7.8)

export const DELETE = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role, isSuperAdmin } = ctxResult.context;

  const adminRoles = ['local_admin', 'super_admin'];
  if (!adminRoles.includes(role)) { return forbiddenResponse('Insufficient permissions to delete programs'); }

const { id } = await params;

  // Verify the program belongs to this tenant before deleting (Req 7.8)

const existing = await programService.getProgramById(id, isSuperAdmin ? undefined : tenantId);
  if (!existing) { return notFoundResponse('Program not found'); }

  await programService.deleteProgram(id);

  await activityLogService.logAction(userId, 'delete', 'program', id, undefined, undefined, tenantId);

  return noContentResponse(); }
);
