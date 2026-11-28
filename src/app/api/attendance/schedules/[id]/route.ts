/**
 * GET  /api/attendance/schedules/[id]  — get single schedule
 * PUT  /api/attendance/schedules/[id]  — update schedule
 * DELETE /api/attendance/schedules/[id]  — archive schedule
 * PATCH  /api/attendance/schedules/[id]  — activate | deactivate
 *
 * Roles:
 *   GET  — local_admin, staff_training_coordinator
 *   PUT  — local_admin only
 *   DELETE — local_admin only
 *   PATCH  — local_admin only
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireTenantContext } from '@/middleware/tenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { activityLogService } from '@/services/activityLogService';
import { successResponse,
  errorResponse,
  forbiddenResponse,
  notFoundResponse, } from '@/utils/responses';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const updateScheduleSchema = z.object({ name:  z.string().min(1).max(255).optional(),
  effective_date_start:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  effective_date_end:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  morning_open:  z.string().regex(/^\d{2}:\d{2}$/).optional(),
  morning_close:  z.string().regex(/^\d{2}:\d{2}$/).optional(),
  morning_late_threshold:   z.number().int().min(1).optional(),
  afternoon_open:  z.string().regex(/^\d{2}:\d{2}$/).optional(),
  afternoon_close:  z.string().regex(/^\d{2}:\d{2}$/).optional(),
  afternoon_late_threshold: z.number().int().min(1).optional(), }).strip();  // silently drop any unknown/extra keys

const patchActionSchema = z.object({ action: z.enum(['activate', 'deactivate']), });

// ---------------------------------------------------------------------------
// Helper — fetch and validate schedule ownership
// ---------------------------------------------------------------------------

async function getSchedule(id: string, tenantId: string, isSuperAdmin: boolean) { let query = supabaseAdmin
  .from('attendance_schedules')
  .select('*')
  .eq('id', id);

  if (!isSuperAdmin) query = query.eq('tenant_id', tenantId);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data; }

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

export const GET = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => { const { id } = await context.params;
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, role, isSuperAdmin } = ctxResult.context;

  const allowedRoles = ['local_admin', 'staff_training_coordinator'];
  if (!allowedRoles.includes(role)) { return forbiddenResponse('Insufficient permissions'); }

const schedule = await getSchedule(id, tenantId, isSuperAdmin);
  if (!schedule) return notFoundResponse('Attendance schedule not found');

  return successResponse(schedule); });

export const PUT = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => { const { id } = await context.params;
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role, isSuperAdmin } = ctxResult.context;

  if (role !== 'local_admin') { return forbiddenResponse('Only local_admin can update attendance schedules'); }

const schedule = await getSchedule(id, tenantId, isSuperAdmin);
  if (!schedule) return notFoundResponse('Attendance schedule not found');

  const body = await request.json();
  const validated = updateScheduleSchema.parse(body);

  if (Object.keys(validated).length === 0) { return errorResponse('No valid fields to update'); }

const { data, error } = await supabaseAdmin
  .from('attendance_schedules')
  .update(validated)
  .eq('id', id)
  .select()
  .single();

  if (error) throw error;

  await activityLogService.logAction(
  userId, 'update', 'attendance_schedule', id, validated
  );

  return successResponse(data, 'Attendance schedule updated'); });

export const DELETE = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => { const { id } = await context.params;
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role, isSuperAdmin } = ctxResult.context;

  if (role !== 'local_admin') { return forbiddenResponse('Only local_admin can archive attendance schedules'); }

const schedule = await getSchedule(id, tenantId, isSuperAdmin);
  if (!schedule) return notFoundResponse('Attendance schedule not found');

  const { error } = await supabaseAdmin
  .from('attendance_schedules')
  .update({ status: 'archived' })
  .eq('id', id);

  if (error) throw error;

  await activityLogService.logAction(
  userId, 'archive', 'attendance_schedule', id, {}
  );

  return successResponse({ id }, 'Attendance schedule archived'); });

export const PATCH = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => { const { id } = await context.params;
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role, isSuperAdmin } = ctxResult.context;

  if (role !== 'local_admin') { return forbiddenResponse('Only local_admin can activate/deactivate schedules'); }

const schedule = await getSchedule(id, tenantId, isSuperAdmin);
  if (!schedule) return notFoundResponse('Attendance schedule not found');

  const body = await request.json();
  const { action } = patchActionSchema.parse(body);

  if (action === 'deactivate') { const { data, error } = await supabaseAdmin
  .from('attendance_schedules')
  .update({ status: 'inactive' })
  .eq('id', id)
  .select()
  .single();

  if (error) throw error;

  await activityLogService.logAction(
  userId, 'deactivate', 'attendance_schedule', id, {}
  );

  return successResponse(data, 'Schedule deactivated'); }

  // action === 'activate'
  // Deactivate all other active schedules for the same program atomically

const { error: deactivateError } = await supabaseAdmin
  .from('attendance_schedules')
  .update({ status: 'inactive' })
  .eq('program_id', schedule.program_id)
  .eq('status', 'active')
  .neq('id', id);

  if (deactivateError) throw deactivateError;

  const { data, error } = await supabaseAdmin
  .from('attendance_schedules')
  .update({ status: 'active' })
  .eq('id', id)
  .select()
  .single();

  if (error) throw error;

  await activityLogService.logAction(
  userId, 'activate', 'attendance_schedule', id,
  { program_id: schedule.program_id }
  );

  return successResponse(data, 'Schedule activated'); });
