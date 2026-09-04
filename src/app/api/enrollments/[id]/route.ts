/**
 * GET  /api/enrollments/:id  — get enrollment by ID (tenant-scoped, Req 7.4)
 * PATCH  /api/enrollments/:id  — update enrollment status (tenant-scoped, Req 7.4)
 * DELETE /api/enrollments/:id  — remove enrollment (tenant-scoped, Req 7.4)
 *
 * Requirements: 7.4, 3.1, 3.5, 3.6
 *
 * On successful enrollment update, an 'enrollment-updated' event is emitted
 * to the enrollment event bus for real-time synchronization.
 *
 * On successful enrollment deletion, an 'enrollment-removed' event is emitted
 * to the enrollment event bus for real-time synchronization.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, notFoundResponse, noContentResponse, forbiddenResponse, errorResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { enrollmentEventBus } from '@/lib/enrollment-event-bus';
import { z } from 'zod';

const updateEnrollmentStatusSchema = z.object({ status: z.enum(['enrolled', 'active', 'completed', 'dropped', 'failed']),
  completion_date: z.string().optional().nullable(),
  final_grade: z.number().min(0).max(100).optional().nullable(), });

// OPTIONS /api/enrollments/:id - Handle CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// GET /api/enrollments/:id - Get enrollment by ID (tenant-scoped, Req 7.4)

export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, isSuperAdmin } = ctxResult.context;

  const { id } = await params;

  let query = supabaseAdmin
  .from('enrollments')
  .select(`
  *,
  trainee:trainees(id, first_name, last_name, middle_name, email, qr_code, photo_path),
  program:programs(id, name, description, start_date, end_date, status)
  `)
  .eq('id', id);

  if (!isSuperAdmin) { query = query.eq('tenant_id', tenantId); }

const { data, error } = await query.maybeSingle();
  if (error) throw error;

  if (!data) { return notFoundResponse('Enrollment not found'); }

  return successResponse(data); }
);

// PATCH /api/enrollments/:id - Update enrollment status (tenant-scoped, Req 7.4)

export const PATCH = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role, isSuperAdmin } = ctxResult.context;

  const allowedRoles = ['local_admin', 'staff_training_coordinator'];
  if (!allowedRoles.includes(role)) { return forbiddenResponse('Insufficient permissions to update enrollments'); }

const { id } = await params;

  // Verify enrollment belongs to this tenant before updating

let checkQuery = supabaseAdmin
  .from('enrollments')
  .select('id, tenant_id, status, trainee_id')
  .eq('id', id);

  if (!isSuperAdmin) { checkQuery = checkQuery.eq('tenant_id', tenantId); }

const { data: existing, error: checkError } = await checkQuery.maybeSingle();
  if (checkError) throw checkError;
  if (!existing) { return notFoundResponse('Enrollment not found'); }

const body = await request.json();
  const validatedData = updateEnrollmentStatusSchema.parse(body);

  const updatePayload: Record<string, unknown> = { status: validatedData.status,
  updated_at: new Date().toISOString(), };

  if (validatedData.completion_date !== undefined) { updatePayload.completion_date = validatedData.completion_date; }

if (validatedData.final_grade !== undefined) { updatePayload.final_grade = validatedData.final_grade; }

const { data: enrollment, error: updateError } = await supabaseAdmin
  .from('enrollments')
  .update(updatePayload)
  .eq('id', id)
  .select(`
  *,
  trainee:trainees(id, first_name, last_name, middle_name, email),
  program:programs(id, name, start_date, end_date, status)
  `)
  .single();

  if (updateError) throw updateError;

  await activityLogService.logAction(userId, 'update', 'enrollment', id, { status: validatedData.status,
  tenantId, });

  // NEW: Sync trainee's program_id after enrollment status change
  if (existing.trainee_id && validatedData.status === 'completed') {
    try {
      const { dataSyncService } = await import('@/services/dataSync');
      const syncResult = await dataSyncService.syncTraineeProgramId(existing.trainee_id, tenantId);
      console.log('[Enrollments] Synced trainee program_id after completion', {
        enrollment_id: id,
        trainee_id: existing.trainee_id,
        sync_result: syncResult,
      });
    } catch (syncError) {
      console.error('[Enrollments] Failed to sync trainee program_id', {
        enrollment_id: id,
        trainee_id: existing.trainee_id,
        error: syncError,
      });
      // Don't fail the enrollment update if sync fails
    }
  }

  // Emit 'enrollment-updated' event to event bus for real-time synchronization (Req 3.1, 3.5, 3.6)
  enrollmentEventBus.emit({
    type: 'enrollment-updated',
    enrollment: {
      id: enrollment.id,
      trainee_id: enrollment.trainee_id,
      program_id: enrollment.program_id,
      status: enrollment.status,
      source: enrollment.source,
      enrollment_date: enrollment.enrollment_date,
      completion_date: enrollment.completion_date,
      created_at: enrollment.created_at,
      updated_at: enrollment.updated_at,
    },
    tenantId,
    timestamp: new Date().toISOString(),
    userId,
  });

  return successResponse(enrollment, 'Enrollment updated successfully'); }
);

// DELETE /api/enrollments/:id - Remove enrollment (tenant-scoped, Req 7.4)

export const DELETE = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role, isSuperAdmin } = ctxResult.context;

  const adminRoles = ['local_admin', 'super_admin'];
  if (!adminRoles.includes(role)) { return forbiddenResponse('Insufficient permissions to delete enrollments'); }

const { id } = await params;

  // Verify enrollment belongs to this tenant and fetch full data before deleting

let checkQuery = supabaseAdmin
  .from('enrollments')
  .select(`
    *,
    trainee:trainees(id, first_name, last_name, middle_name, email),
    program:programs(id, name, start_date, end_date)
  `)
  .eq('id', id);

  if (!isSuperAdmin) { checkQuery = checkQuery.eq('tenant_id', tenantId); }

const { data: existing, error: checkError } = await checkQuery.maybeSingle();
  if (checkError) throw checkError;
  if (!existing) { return notFoundResponse('Enrollment not found'); }

const { error: deleteError } = await supabaseAdmin
  .from('enrollments')
  .delete()
  .eq('id', id);

  if (deleteError) throw deleteError;

  await activityLogService.logAction(userId, 'delete', 'enrollment', id, undefined, undefined, tenantId);

  // Emit 'enrollment-removed' event to event bus for real-time synchronization (Req 3.5, 3.6)
  // Include the deleted enrollment data and enrollmentId for audit purposes
  enrollmentEventBus.emit({
    type: 'enrollment-removed',
    enrollmentId: id,
    enrollment: {
      id: existing.id,
      trainee_id: existing.trainee_id,
      program_id: existing.program_id,
      status: existing.status,
      source: existing.source,
      enrollment_date: existing.enrollment_date,
      completion_date: existing.completion_date,
      created_at: existing.created_at,
      updated_at: existing.updated_at,
    },
    tenantId,
    timestamp: new Date().toISOString(),
    userId,
  });

  return noContentResponse(); }
);
