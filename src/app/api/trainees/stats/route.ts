import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAsync } from '@/middleware/auth';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/trainees/stats - Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/trainees/stats - Get trainee statistics for the current tenant

export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuthAsync(request);
  if ('error' in authResult) return authResult.error as NextResponse;

  const tenantId = authResult.user.tenantId;

  // FIX: Query enrollments instead of trainees.program_id (removed in schema normalization)
  const [traineesResult, programsResult, enrollmentsResult] = await Promise.all([
    supabaseAdmin.from('trainees').select('id, status').eq('tenant_id', tenantId),
    supabaseAdmin.from('programs').select('id, name').eq('tenant_id', tenantId),
    supabaseAdmin
      .from('enrollments')
      .select('trainee_id, program_id')
      .eq('tenant_id', tenantId)
      .in('status', ['enrolled', 'active']),  // Active enrollments only
  ]);

  if (traineesResult.error) throw traineesResult.error;
  if (programsResult.error) throw programsResult.error;
  if (enrollmentsResult.error) throw enrollmentsResult.error;

  const trainees = traineesResult.data || [];
  const programs = programsResult.data || [];
  const enrollments = enrollmentsResult.data || [];

  const programNameById = new Map<string, string>(
    programs.map((p) => [p.id as string, p.name as string])
  );

  // FIX: Aggregate from enrollments table instead of trainees.program_id
  const byProgram: Record<string, number> = {};
  enrollments.forEach((enrollment) => {
    const programName = programNameById.get(enrollment.program_id as string) || 'Unknown Program';
    byProgram[programName] = (byProgram[programName] || 0) + 1;
  });

  // Include unassigned trainees (no active enrollments)
  const enrolledTraineeIds = new Set(enrollments.map((e) => e.trainee_id as string));
  const unassignedCount = trainees.filter((t) => !enrolledTraineeIds.has(t.id as string)).length;
  if (unassignedCount > 0) {
    byProgram['Unassigned'] = unassignedCount;
  }

  return successResponse({
    totalTrainees: trainees.length,
    active: trainees.filter((t) => t.status === 'active').length,
    inactive: trainees.filter((t) => t.status === 'inactive').length,
    completed: trainees.filter((t) => t.status === 'completed').length,
    dropped: trainees.filter((t) => t.status === 'dropped').length,
    byProgram,
  });
});
