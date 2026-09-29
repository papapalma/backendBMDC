/**
 * GET /api/reports/trainees — trainee analytics (tenant-scoped, Req 4.6)
 *
 * Updated to enforce tenant context so each LGU only sees its own trainees.
 */
import { NextRequest, NextResponse } from 'next/server';

import { requireTenantContext } from '@/middleware/tenantContext';

import { successResponse, forbiddenResponse } from '@/utils/responses';

import { withErrorHandler } from '@/middleware/errorHandler';

import { handleOptionsRequest } from '@/middleware/cors';

import { supabaseAdmin } from '@/lib/supabase-admin';

// OPTIONS /api/reports/trainees - Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/reports/trainees - Get trainee analytics report (tenant-scoped)
export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, role, isSuperAdmin } = ctxResult.context;

  const allowedRoles = ['local_admin', 'staff_training_coordinator'];
  if (!allowedRoles.includes(role) && !isSuperAdmin) {
    return forbiddenResponse('Insufficient permissions to view trainee reports');
  }

const { searchParams } = new URL(request.url);

  const startDate = searchParams.get('startDate') || searchParams.get('start_date') || undefined;
  const endDate = searchParams.get('endDate') || searchParams.get('end_date') || undefined;

  const programId = searchParams.get('program') || searchParams.get('program_id') || undefined;
  const status = searchParams.get('status') || undefined;
  const employmentStatus = searchParams.get('employment_status') || undefined;
  const traineeStatus = searchParams.get('trainee_status') || undefined;

  const targetTenantId = isSuperAdmin
    ? searchParams.get('tenant_id') || tenantId
    : tenantId;

  // Query enrollments (not trainees) because that's where enrollment_date and program data live
  // in the normalized schema
  let enrollmentsQuery = supabaseAdmin
    .from('enrollments')
    .select('id, trainee_id, program_id, status, enrollment_date, tenant_id')
    .eq('tenant_id', targetTenantId);

  if (programId) enrollmentsQuery = enrollmentsQuery.eq('program_id', programId);
  if (status) enrollmentsQuery = enrollmentsQuery.eq('status', status);
  if (startDate) enrollmentsQuery = enrollmentsQuery.gte('enrollment_date', startDate);
  if (endDate) enrollmentsQuery = enrollmentsQuery.lte('enrollment_date', endDate);

  let traineesQuery = supabaseAdmin
    .from('trainees')
    .select('id, first_name, last_name, employment_status, status')
    .eq('tenant_id', targetTenantId)
    .is('deleted_at', null);

  if (employmentStatus) traineesQuery = traineesQuery.eq('employment_status', employmentStatus);
  if (traineeStatus) traineesQuery = traineesQuery.eq('status', traineeStatus);

  const [
    { data: enrollments, error: enrollmentsError },
    { data: programs, error: programsError },
    { data: trainees, error: traineesError },
  ] = await Promise.all([
    enrollmentsQuery.order('enrollment_date', { ascending: true }),
    supabaseAdmin.from('programs').select('id, name').eq('tenant_id', targetTenantId),
    traineesQuery.order('last_name', { ascending: true }),
  ]);

  if (enrollmentsError) throw enrollmentsError;
  if (programsError) throw programsError;
  if (traineesError) throw traineesError;

  const enrollmentRows = enrollments || [];
  const programRows = programs || [];
  const traineeRows = trainees || [];

  const programNameById = new Map(
    programRows.map((p) => [p.id as string, p.name as string])
  );
  const traineeProgramById = new Map<string, string>();
  for (const enrollment of enrollmentRows) {
    if (!traineeProgramById.has(enrollment.trainee_id as string)) {
      traineeProgramById.set(enrollment.trainee_id as string, enrollment.program_id as string);
    }
  }

  const byProgram: { [key: string]: number } = {};
  const byStatus: { [key: string]: number } = {};
  const trendMap: { [key: string]: number } = {};

  for (const enrollment of enrollmentRows) {
    const programName: string =
      (programNameById.get(enrollment.program_id as string) as string) || 'Unknown Program';
    byProgram[programName] = (byProgram[programName] ?? 0) + 1;

    const statusStr: string = String(enrollment.status);
    byStatus[statusStr] = (byStatus[statusStr] ?? 0) + 1;

    const dateKey: string =
      ((enrollment.enrollment_date || '').split('T')[0]) || 'unknown';
    trendMap[dateKey] = (trendMap[dateKey] ?? 0) + 1;
  }

  const enrollmentTrend = Object.entries(trendMap)
    .filter(([date]) => date !== 'unknown')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const completedCount = byStatus.completed || 0;

  const completionRate =
    enrollmentRows.length > 0
      ? Number(((completedCount / enrollmentRows.length) * 100).toFixed(2))
      : 0;

  const employmentStatusCounts = traineeRows.reduce((counts: Record<string, number>, trainee: any) => {
    const employmentStatus = trainee.employment_status || 'Unknown';
    counts[employmentStatus] = (counts[employmentStatus] || 0) + 1;
    return counts;
  }, {});

  const employmentStatusRecords = traineeRows
    .filter((trainee: any) => !programId || traineeProgramById.has(trainee.id))
    .map((trainee: any) => ({
    id: trainee.id,
    name: `${trainee.first_name || ''} ${trainee.last_name || ''}`.trim(),
    employmentStatus: trainee.employment_status || 'Unknown',
    traineeStatus: trainee.status || 'Unknown',
    programId: traineeProgramById.get(trainee.id) || null,
    program: programNameById.get(traineeProgramById.get(trainee.id) || '') || 'No program',
  }));

  return successResponse({
    tenantId: targetTenantId,
    totalEnrollments: enrollmentRows.length,
    byProgram,
    byStatus,
    enrollmentTrend,
    completionRate,
    employmentStatusCounts,
    employmentStatusRecords,
  });
});
