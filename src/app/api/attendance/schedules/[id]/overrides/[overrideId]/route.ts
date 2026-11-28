/**
 * DELETE /api/attendance/schedules/[id]/overrides/[overrideId]
 *
 * Deletes a single schedule override.
 * If the override was a full-day-off, also removes the matching
 * no_attendance_day exception that was created alongside it.
 *
 * Roles: local_admin only
 *
 * FIX: Using attendance_exceptions table instead of attendance_schedule_overrides (removed in schema normalization)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireTenantContext } from '@/middleware/tenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { activityLogService } from '@/services/activityLogService';
import { successResponse,
  forbiddenResponse,
  notFoundResponse, } from '@/utils/responses';

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

export const DELETE = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string; overrideId: string }> }
) => { const { id, overrideId } = await context.params;
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role, isSuperAdmin } = ctxResult.context;

  if (role !== 'local_admin') { return forbiddenResponse('Only local_admin can delete schedule overrides'); }

  // Verify schedule exists and belongs to tenant
  let schedQuery = supabaseAdmin
    .from('attendance_schedules')
    .select('id, program_id, tenant_id')
    .eq('id', id);
  if (!isSuperAdmin) schedQuery = schedQuery.eq('tenant_id', tenantId);
  const { data: schedule } = await schedQuery.maybeSingle();
  if (!schedule) return notFoundResponse('Attendance schedule not found');

  // FIX: Fetch the override from attendance_exceptions
  let overrideQuery = supabaseAdmin
    .from('attendance_exceptions')
    .select('id, exception_date, exception_type, program_id, tenant_id')
    .eq('id', overrideId)
    .eq('exception_type', 'schedule_override')
    .eq('program_id', schedule.program_id);

  if (!isSuperAdmin) { overrideQuery = overrideQuery.eq('tenant_id', tenantId); }

  const { data: override, error: fetchError } = await overrideQuery.maybeSingle();
  if (fetchError) throw fetchError;
  if (!override) return notFoundResponse('Override not found');

  // FIX: Delete the override from attendance_exceptions
  const { error: deleteError } = await supabaseAdmin
    .from('attendance_exceptions')
    .delete()
    .eq('id', overrideId);

  if (deleteError) throw deleteError;

  // Also remove any matching no_attendance_day exception
  await supabaseAdmin
    .from('attendance_exceptions')
    .delete()
    .eq('exception_date', override.exception_date)
    .eq('exception_type', 'no_attendance_day')
    .eq('program_id', schedule.program_id);

  await activityLogService.logAction(
    userId, 'delete', 'attendance_schedule_override', overrideId,
    { schedule_id: id, date: override.exception_date }
  );

  return successResponse(
    { id: overrideId },
    'Override deleted'
  ); });
