/** * GET  /api/attendance/schedules?program_id=UUID  — list schedules for a program * POST /api/attendance/schedules  — create a new schedule * * Roles: *  GET  — local_admin, staff_training_coordinator *  POST — local_admin only */import { NextRequest, NextResponse } from 'next/server';

import { z } from 'zod';

import { supabaseAdmin } from '@/lib/supabase-admin';

import { requireTenantContext } from '@/middleware/tenantContext';

import { withErrorHandler } from '@/middleware/errorHandler';

import { handleOptionsRequest } from '@/middleware/cors';

import { activityLogService } from '@/services/activityLogService';

import { successResponse,  errorResponse,  forbiddenResponse,  createdResponse,} from '@/utils/responses';

// Validation schema
const scheduleSchema = z.object({
  program_id: z.string().uuid('Invalid program ID'),
  name: z.string().min(1, 'Name is required').max(255),
  effective_date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)'),
  effective_date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)'),
  morning_open: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time (HH:MM)'),
  morning_close: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time (HH:MM)'),
  morning_late_threshold: z.number().int().min(1).default(15),
  afternoon_open: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time (HH:MM)'),
  afternoon_close: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time (HH:MM)'),
  afternoon_late_threshold: z.number().int().min(1).default(15),
})
  .refine(d => d.effective_date_end >= d.effective_date_start, {
    message: 'effective_date_end must be on or after effective_date_start',
    path: ['effective_date_end'],
  })
  .refine(d => d.morning_close > d.morning_open, {
    message: 'morning_close must be after morning_open',
    path: ['morning_close'],
  })
  .refine(d => d.afternoon_close > d.afternoon_open, {
    message: 'afternoon_close must be after afternoon_open',
    path: ['afternoon_close'],
  });

// Handlers

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, role, isSuperAdmin } = ctxResult.context;

  const allowedRoles = ['local_admin', 'staff_training_coordinator'];
  if (!allowedRoles.includes(role)) {
    return forbiddenResponse('Insufficient permissions to view attendance schedules');
  }

const { searchParams } = new URL(request.url);
  const programId = searchParams.get('program_id');
  if (!programId) {
    return errorResponse('program_id query parameter is required');
  }

let query = supabaseAdmin
    .from('attendance_schedules')
    .select('*')
    .eq('program_id', programId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false });

  if (!isSuperAdmin) {
    query = query.eq('tenant_id', tenantId);
  }

const { data, error } = await query;
  if (error) throw error;
  return successResponse(data ?? []);
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role } = ctxResult.context;
  if (role !== 'local_admin') {
    return forbiddenResponse('Only local_admin can create attendance schedules');
  }

const body = await request.json();
  const validated = scheduleSchema.parse(body);

  const { data, error } = await supabaseAdmin
    .from('attendance_schedules')
    .insert({
      ...validated,
      tenant_id: tenantId,
      created_by: userId,
      status: 'inactive',
    })
    .select()
    .single();

  if (error) throw error;
  await activityLogService.logAction(
    userId,
    'create',
    'attendance_schedule',
    data.id,
    { name: validated.name, program_id: validated.program_id }
  );
  return createdResponse(data, 'Attendance schedule created');
});
