import { NextRequest, NextResponse } from 'next/server';
import { requireRoleAsync } from '@/middleware/auth';
import { activityLogService } from '@/services/activityLogService';
import { errorResponse, successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { scheduleReportSchema } from '@/utils/validators';
import { supabaseAdmin } from '@/lib/supabase-admin';

const calculateNextRunAt = (frequency: 'daily' | 'weekly' | 'monthly'): string => {
  const now = new Date();

  if (frequency === 'daily') {
  now.setDate(now.getDate() + 1);
  } else if (frequency === 'weekly') {
  now.setDate(now.getDate() + 7);
  } else {
  now.setMonth(now.getMonth() + 1);
  }

  return now.toISOString();
};

const isMissingTableError = (error: unknown): boolean => {
  return Boolean(
  error
  && typeof error === 'object'
  && 'code' in error
  && (error as { code?: string }).code === '42P01'
  );
};

// OPTIONS /api/reports/schedule - Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/reports/schedule - List report schedules

export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRoleAsync(request, ['local_admin', 'staff_inventory_manager', 'staff_training_coordinator']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const user = authResult.user;
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || undefined;
  const isActiveParam = searchParams.get('isActive') || searchParams.get('is_active');
  const limitParam = Number(searchParams.get('limit') || '50');
  const limit = Number.isNaN(limitParam) ? 50 : Math.min(Math.max(limitParam, 1), 200);

  let query = supabaseAdmin
  .from('report_schedules')
  .select('*');

  // Tenant isolation: non-super-admins can only see their own tenant's schedules

if (user.role !== 'super_admin') {
  query = query.eq('tenant_id', user.tenantId);
  }

  query = query.order('created_at', { ascending: false }).limit(limit);

  if (status) {
  query = query.eq('status', status);
  }

if (isActiveParam === 'true' || isActiveParam === 'false') {
  query = query.eq('is_active', isActiveParam === 'true');
  }

const { data, error } = await query;

  if (error) {
  if (isMissingTableError(error)) {
  return errorResponse('Report scheduling is not initialized. Run migration add-report-schedules.sql first.', 500);
  }
  throw error;
  }

  return successResponse(data || []);
});

// POST /api/reports/schedule - Create report schedule

export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRoleAsync(request, ['local_admin', 'staff_inventory_manager', 'staff_training_coordinator']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const user = authResult.user;
  const body = await request.json();
  const validated = scheduleReportSchema.parse(body);

  const nextRunAt = calculateNextRunAt(validated.frequency);

  const { data, error } = await supabaseAdmin
  .from('report_schedules')
  .insert({
  report_type: validated.reportType,
  frequency: validated.frequency,
  recipients: validated.recipients,
  format: validated.format,
  filters: validated.filters || null,
  is_active: validated.isActive,
  status: validated.isActive ? 'scheduled' : 'paused',
  execution_strategy: 'db-cron-worker',
  next_run_at: nextRunAt,
  created_by: authResult.user.userId,
  tenant_id: user.tenantId,
  })
  .select('*')
  .single();

  if (error) {
  if (isMissingTableError(error)) {
  return errorResponse('Report scheduling is not initialized. Run migration add-report-schedules.sql first.', 500);
  }
  throw error;
  }

  await activityLogService.logAction(
  authResult.user.userId,
  'schedule_report',
  'report',
  data.id,
  {
  report_type: data.report_type,
  frequency: data.frequency,
  recipients_count: Array.isArray(data.recipients) ? data.recipients.length : 0,
  format: data.format,
  next_run_at: data.next_run_at,
  tenant_id: user.tenantId,
  }
  );

  return successResponse(
  {
  ...data,
  execution_notes: 'Schedule stored. Execute due schedules via worker/cron integration.',
  },
  'Report schedule created successfully',
  201
  );
});
