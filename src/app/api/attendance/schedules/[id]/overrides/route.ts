/**
 * GET  /api/attendance/schedules/[id]/overrides  — list overrides for a schedule
 * POST /api/attendance/schedules/[id]/overrides  — create a date override
 *
 * A full-day-off override (is_full_day_off = true) also creates a matching
 * attendance_exceptions entry with exception_type = 'no_attendance_day'
 *
 * Roles: local_admin, staff_training_coordinator (read); local_admin (write)
 *
 * FIX: Using attendance_exceptions table instead of attendance_schedule_overrides (removed in schema normalization)
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
  notFoundResponse,
  createdResponse, } from '@/utils/responses';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const overrideSchema = z.object({ date:                   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)'),
  reason:                 z.string().min(1, 'Reason is required').max(255),
  is_full_day_off:        z.boolean().default(false),
  custom_morning_open:    z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  custom_morning_close:   z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  custom_afternoon_open:  z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  custom_afternoon_close: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(), }).refine(d => { if (!d.is_full_day_off && d.custom_morning_open && d.custom_morning_close) { return d.custom_morning_close > d.custom_morning_open; }
  return true; }, { message: 'custom_morning_close must be after custom_morning_open', path: ['custom_morning_close'] })
.refine(d => { if (!d.is_full_day_off && d.custom_afternoon_open && d.custom_afternoon_close) { return d.custom_afternoon_close > d.custom_afternoon_open; }
  return true; }, { message: 'custom_afternoon_close must be after custom_afternoon_open', path: ['custom_afternoon_close'] });

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

  // Verify schedule belongs to this tenant and get program_id
  let schedQuery = supabaseAdmin
    .from('attendance_schedules')
    .select('id, program_id, tenant_id')
    .eq('id', id);
  if (!isSuperAdmin) schedQuery = schedQuery.eq('tenant_id', tenantId);
  const { data: sched } = await schedQuery.maybeSingle();
  if (!sched) return notFoundResponse('Attendance schedule not found');

  // FIX: Query attendance_exceptions instead of attendance_schedule_overrides
  const { data, error } = await supabaseAdmin
    .from('attendance_exceptions')
    .select('id, exception_date as date, reason, exception_start_time, exception_end_time')
    .eq('program_id', sched.program_id)
    .eq('exception_type', 'schedule_override')
    .eq('tenant_id', tenantId)
    .order('exception_date', { ascending: true });

  if (error) throw error;

  return successResponse(data ?? []); });

export const POST = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => { const { id } = await context.params;
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role, isSuperAdmin } = ctxResult.context;

  if (role !== 'local_admin') { return forbiddenResponse('Only local_admin can create schedule overrides'); }

  // Fetch schedule — needed for program_id
  let schedQuery = supabaseAdmin
    .from('attendance_schedules')
    .select('id, program_id, tenant_id')
    .eq('id', id);
  if (!isSuperAdmin) schedQuery = schedQuery.eq('tenant_id', tenantId);
  const { data: schedule } = await schedQuery.maybeSingle();
  if (!schedule) return notFoundResponse('Attendance schedule not found');

  const body = await request.json();
  const validated = overrideSchema.parse(body);

  // FIX: Insert into attendance_exceptions instead of attendance_schedule_overrides
  const { data: override, error } = await supabaseAdmin
    .from('attendance_exceptions')
    .insert({ tenant_id:            tenantId,
      exception_type:       'schedule_override',
      program_id:           schedule.program_id,
      exception_date:       validated.date,
      reason:               validated.reason,
      exception_start_time: validated.custom_morning_open ?? null,
      exception_end_time:   validated.custom_afternoon_close ?? null,
      created_by:           userId, })
    .select()
    .single();

  if (error) { // Unique constraint — duplicate date + exception_type combo
    if ((error as any).code === '23505') { return errorResponse(`An override for ${validated.date} already exists on this schedule`, 409); }
    throw error; }

  // If full day off — also create a no_attendance_day exception
  if (validated.is_full_day_off) { try { await supabaseAdmin
      .from('attendance_exceptions')
      .insert({ tenant_id:      tenantId,
        exception_type: 'no_attendance_day',
        program_id:     schedule.program_id,
        exception_date: validated.date,
        reason:         `Full day off: ${validated.reason}`,
        created_by:     userId, }); } catch (nadError: any) { // If duplicate exception, that's fine
      if (nadError?.code !== '23505') throw nadError; } }

  await activityLogService.logAction(
    userId, 'create', 'attendance_schedule_override', override.id,
    { date: validated.date, is_full_day_off: validated.is_full_day_off }
  );

  return createdResponse(override, 'Schedule override created'); });
