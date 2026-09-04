/**
 * GET  /api/trainees/:id  — get trainee by ID (tenant-scoped, Req 9.2, 9.10)
 * PUT  /api/trainees/:id  — update trainee (tenant-scoped, Req 9.3)
 * PATCH  /api/trainees/:id  — partial update / privacy consent (tenant-scoped, Req 22.1)
 * DELETE /api/trainees/:id  — delete trainee (tenant-scoped, Req 9.10)
 *
 * Requirements: 9.2, 9.3, 9.10, 22.1
 */
import { NextRequest, NextResponse } from 'next/server';
import { traineeService } from '@/services/traineeService';
import { requireTenantContext } from '@/middleware/tenantContext';
import { updateTraineeSchema } from '@/utils/validators';
import { successResponse, notFoundResponse, noContentResponse, errorResponse, forbiddenResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';
import { handleOptionsRequest } from '@/middleware/cors';
import { z } from 'zod';

// Privacy consent recording schema (Req 22.1)
const consentSchema = z.object({ consent_given: z.boolean(),
  consent_version: z.string().min(1, 'Consent version is required'), });

// OPTIONS /api/trainees/:id - Handle CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// GET /api/trainees/:id - Get trainee by ID (tenant-scoped, Req 9.2, 9.10)

export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;

  const allowedRoles = ['local_admin', 'staff_training_coordinator', 'staff_inventory_manager'];
  if (!allowedRoles.includes(context.role)) { return forbiddenResponse('Insufficient permissions'); }

const { id } = await params;
  const trainee = await traineeService.getTraineeById(context, id);

  if (!trainee) { return notFoundResponse('Trainee not found'); }

  return successResponse(trainee); }
);

// PUT /api/trainees/:id - Update trainee (tenant-scoped, Req 9.3)

export const PUT = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;

  const allowedRoles = ['local_admin', 'staff_training_coordinator', 'staff_inventory_manager'];
  if (!allowedRoles.includes(context.role)) { return forbiddenResponse('Insufficient permissions to update trainees'); }

const { id } = await params;

  // Verify trainee belongs to this tenant before updating (Req 9.10)

const existing = await traineeService.getTraineeById(context, id);
  if (!existing) { return notFoundResponse('Trainee not found'); }

const body = await request.json();

  try { const validatedData = updateTraineeSchema.parse(body) as Record<string, any>;

  if (Object.prototype.hasOwnProperty.call(validatedData, 'email') && typeof validatedData.email === 'string') { const incomingEmail = validatedData.email.trim().toLowerCase();
  const adminRoles = ['local_admin', 'super_admin'];
  if (!adminRoles.includes(context.role)) { const existingEmail = String(existing.email || '').trim().toLowerCase();
  if (incomingEmail !== existingEmail) { return errorResponse('Only admin can change trainee email', 403); }
  delete validatedData.email; } }

const trainee = await traineeService.updateTrainee(id, validatedData);

  // Strip PII before storing in activity log (SEC-18)
  try { const { email: _e, phone: _p, birth_date: _b, street: _s, province: _pr, municipality: _m, barangay: _ba, ...safeLog } = validatedData as any;
  await activityLogService.logAction(context.userId, 'update', 'trainee', id, safeLog, undefined, context.tenantId); } catch { /* non-critical */ }

  return successResponse(trainee, 'Trainee updated successfully'); } catch (error) { throw error; } }
);

// DELETE /api/trainees/:id - Delete trainee (tenant-scoped, Req 9.10)

export const DELETE = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;

  const adminRoles = ['local_admin', 'super_admin'];
  if (!adminRoles.includes(context.role)) { return forbiddenResponse('Insufficient permissions to delete trainees'); }

const { id } = await params;

  // Verify trainee belongs to this tenant before deleting (Req 9.10)

const existing = await traineeService.getTraineeById(context, id);
  if (!existing) { return notFoundResponse('Trainee not found'); }

  await traineeService.deleteTrainee(id);

  await activityLogService.logAction(context.userId, 'delete', 'trainee', id, undefined, undefined, context.tenantId);

  return noContentResponse(); }
);

// PATCH /api/trainees/:id - Record privacy consent (Req 22.1)
// Also supports partial updates for trainee profile fields

export const PATCH = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;

  const allowedRoles = ['local_admin', 'staff_training_coordinator', 'trainee'];
  if (!allowedRoles.includes(context.role)) { return forbiddenResponse('Insufficient permissions'); }

const { id } = await params;

  // Verify trainee belongs to this tenant (Req 9.10)

const existing = await traineeService.getTraineeById(context, id);
  if (!existing) { return notFoundResponse('Trainee not found'); }

const body = await request.json();

  // Check if this is a consent recording request (Req 22.1)

if ('consent_given' in body) { const consentData = consentSchema.parse(body);

  const trainee = await traineeService.updateTrainee(id, { consent_given: consentData.consent_given,
  consent_version: consentData.consent_version,
  consent_timestamp: new Date().toISOString(), } as any);

  await activityLogService.logAction(context.userId, 'record_consent', 'trainee', id, { consent_given: consentData.consent_given,
  consent_version: consentData.consent_version, }, undefined, context.tenantId);

  return successResponse(trainee, 'Privacy consent recorded successfully'); }

  // Otherwise treat as a partial profile update

const validatedData = updateTraineeSchema.parse(body) as Record<string, any>;

  // Non-admin roles cannot change email

if (Object.prototype.hasOwnProperty.call(validatedData, 'email') && typeof validatedData.email === 'string') { const incomingEmail = validatedData.email.trim().toLowerCase();
  const adminRoles = ['local_admin', 'super_admin'];
  if (!adminRoles.includes(context.role)) { const existingEmail = String(existing.email || '').trim().toLowerCase();
  if (incomingEmail !== existingEmail) { return errorResponse('Only admin can change trainee email', 403); }
  delete validatedData.email; } }

const trainee = await traineeService.updateTrainee(id, validatedData);

  try { const { email: _e, phone: _p, birth_date: _b, street: _s, province: _pr, municipality: _m, barangay: _ba, ...safeLog } = validatedData as any;
  await activityLogService.logAction(context.userId, 'update', 'trainee', id, safeLog, undefined, context.tenantId); } catch { /* non-critical */ }

  return successResponse(trainee, 'Trainee updated successfully'); }
);
