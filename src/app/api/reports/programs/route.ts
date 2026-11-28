/** * GET /api/reports/programs — program analytics (tenant-scoped, Req 7.9) * * Updated to enforce tenant context so each LGU only sees its own programs. * Super Admin can pass ?tenant_id= to query a specific tenant. */import { NextRequest, NextResponse } from 'next/server';

import { requireTenantContext } from '@/middleware/tenantContext';

import { successResponse, forbiddenResponse } from '@/utils/responses';

import { withErrorHandler } from '@/middleware/errorHandler';

import { handleOptionsRequest } from '@/middleware/cors';

import { supabaseAdmin } from '@/lib/supabase-admin';
import { chunkIds, fetchAllRows } from '@/lib/supabasePagination';

// OPTIONS /api/reports/programs - Handle CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request);}// GET /api/reports/programs - Get program analytics report (tenant-scoped)

export const GET = withErrorHandler(async (request: NextRequest) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role, isSuperAdmin } = ctxResult.context;

  const allowedRoles = [  'local_admin',  'staff_training_coordinator',  'staff_inventory_manager',  ];
  if (!allowedRoles.includes(role) && !isSuperAdmin) { return forbiddenResponse('Insufficient permissions to view program reports');
}

const { searchParams } = new URL(request.url);

  const startDate  = searchParams.get('startDate') || searchParams.get('start_date') || undefined;
  const endDate  = searchParams.get('endDate')  || searchParams.get('end_date')  || undefined;
  const endDateExclusive = endDate ? new Date(`${endDate}T00:00:00.000Z`) : undefined;
  if (endDateExclusive && !Number.isNaN(endDateExclusive.getTime())) {
    endDateExclusive.setUTCDate(endDateExclusive.getUTCDate() + 1);
  }

  const statusFilter = searchParams.get('status') || undefined;
  const targetTenantId = isSuperAdmin  ? (searchParams.get('tenant_id') || tenantId)  : tenantId;
  let programsQuery = supabaseAdmin
    .from('programs')
    .select('id, name, status, max_trainees, enrollment_limit, start_date, end_date, created_at')
    .eq('tenant_id', targetTenantId)
    .is('deleted_at', null);
  if (statusFilter) programsQuery = programsQuery.eq('status', statusFilter);

  const { data: programs, error: programsError } = await programsQuery.order('start_date', { ascending: false });
  if (programsError) throw programsError;

  const programRows = programs || [];
  const programIds = programRows.map((program) => program.id);
  
  // Query all active/completed enrollments for these programs so counts & rosters match ProgramsPage
  let enrollmentRows: Array<{ program_id: string; trainee_id: string; status: string; enrollment_date: string }> = [];
  if (programIds.length > 0) {
    const enrollmentBatches = await Promise.all(
      chunkIds(programIds, 150).map((programChunk) =>
        fetchAllRows<{ program_id: string; trainee_id: string; status: string; enrollment_date: string }>(() =>
          supabaseAdmin
            .from('enrollments')
            .select('program_id, trainee_id, status, enrollment_date')
            .in('program_id', programChunk)
            .in('status', ['enrolled', 'active', 'completed'])
        )
      )
    );
    enrollmentRows = enrollmentBatches.flat();
  }

  const traineeIds = [...new Set(enrollmentRows.map((enrollment) => enrollment.trainee_id).filter(Boolean))];
  const traineesById = new Map<string, string>();
  if (traineeIds.length > 0) {
    // Chunk `.in()` to avoid PostgREST URL length overflow (UND_ERR_HEADERS_OVERFLOW) with 500+ trainees
    const traineeBatches = await Promise.all(
      chunkIds(traineeIds, 150).map(async (idChunk) => {
        const { data: trainees, error: traineesError } = await supabaseAdmin
          .from('trainees')
          .select('id, first_name, last_name, email')
          .in('id', idChunk);
        if (traineesError) throw traineesError;
        return trainees || [];
      })
    );

    for (const trainee of traineeBatches.flat()) {
      const name = [trainee.first_name, trainee.last_name].filter(Boolean).join(' ').trim();
      traineesById.set(trainee.id, name || trainee.email || 'Unnamed trainee');
    }
  }

  const enrolledByProgram: Record<string, number> = {};
  const completedByProgram: Record<string, number> = {};
  for (const enrollment of enrollmentRows) {
    enrolledByProgram[enrollment.program_id] = (enrolledByProgram[enrollment.program_id] || 0) + 1;
    if (enrollment.status === 'completed') {
      completedByProgram[enrollment.program_id] = (completedByProgram[enrollment.program_id] || 0) + 1;
    }
  }

  const byCategory = programRows.reduce((acc, program) => {
    acc[program.status] = (acc[program.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const totalCapacity = programRows.reduce(
    (sum, program: any) => sum + (program.enrollment_limit || program.max_trainees || 0),
    0
  );
  const totalEnrolled = enrollmentRows.length;

  const completedPrograms = programRows.filter((program) => program.status === 'completed').length;
  const enrollmentRate = totalCapacity > 0
    ? Number(((totalEnrolled / totalCapacity) * 100).toFixed(2))
    : 0;

  const completionRate = programRows.length > 0
    ? Number(((completedPrograms / programRows.length) * 100).toFixed(2))
    : 0;

  const popularPrograms = [...programRows]
    .map((program) => ({
      id: program.id,
      name: program.name,
      enrolled: enrolledByProgram[program.id] || 0,
    }))
    .sort((a, b) => b.enrolled - a.enrolled)
    .slice(0, 10);

  const programStats = programRows.map((program: any) => {
    const enrolledCount = enrolledByProgram[program.id] || 0;
    const completedCount = completedByProgram[program.id] || 0;

    const programCompletionRate = enrolledCount > 0
      ? Number(((completedCount / enrolledCount) * 100).toFixed(2))
      : 0;
    return {
      id: program.id,
      name: program.name,
      status: program.status,
      enrolledCount,
      completedCount,
      completionRate: programCompletionRate,
      capacity: program.enrollment_limit || program.max_trainees || 0,
      start_date: program.start_date,
      end_date: program.end_date,
      students: enrollmentRows
        .filter((enrollment) => enrollment.program_id === program.id)
        .map((enrollment) => traineesById.get(enrollment.trainee_id))
        .filter((name): name is string => Boolean(name)),
    };
  });

  return successResponse({
    tenantId: targetTenantId,
    totalPrograms: programRows.length,
    enrollmentRate,
    completionRate,
    byCategory,
    popularPrograms,
    programStats,
  });});
