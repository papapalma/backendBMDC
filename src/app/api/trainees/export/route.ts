import { NextRequest, NextResponse } from 'next/server';
import { traineeService } from '@/services/traineeService';
import { programService } from '@/services/programService';
import { requireRoleAsync } from '@/middleware/auth';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { createCsvDownloadResponse, objectsToCsv } from '@/utils/export';
import { supabaseAdmin } from '@/lib/supabase-admin';

// OPTIONS /api/trainees/ -- Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/trainees/ -- Export trainees as CSV

export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRoleAsync(request, ['local_admin', 'staff_training_coordinator', 'staff_inventory_manager']);
  if ('error' in authResult) return authResult.error as NextResponse;
  
  const user = authResult.user;
  const context = {
  userId: user.userId,
  tenantId: user.tenantId,
  role: user.role,
  isSuperAdmin: user.role === 'super_admin',
  };

  const { searchParams } = new URL(request.url);
  const program_id = searchParams.get('program_id') || searchParams.get('program') || undefined;
  const status = searchParams.get('status') || undefined;
  const search = searchParams.get('search') || undefined;

  // FIX: Query enrollments to get program_id and enrollment_date (removed from trainees table)
  const [trainees, programs, enrollmentsResult] = await Promise.all([
    traineeService.getAllTrainees(context, { program_id, status, search }),
    programService.getAllPrograms(),
    supabaseAdmin
      .from('enrollments')
      .select('trainee_id, program_id, enrollment_date')
      .eq('tenant_id', user.tenantId)
      .then(({ data, error }) => {
        if (error) throw error;
        return data || [];
      }),
  ]);

  const programNameById = new Map(programs.map((program) => [program.id, program.name]));

  // FIX: Create map of trainee_id → enrollments (handle multiple enrollments per trainee)
  const enrollmentsByTrainee = new Map<
    string,
    Array<{ program_id: string; enrollment_date: string }>
  >();
  enrollmentsResult.forEach((enrollment) => {
    if (!enrollmentsByTrainee.has(enrollment.trainee_id as string)) {
      enrollmentsByTrainee.set(enrollment.trainee_id as string, []);
    }
    enrollmentsByTrainee.get(enrollment.trainee_id as string)!.push({
      program_id: enrollment.program_id as string,
      enrollment_date: enrollment.enrollment_date as string,
    });
  });

  const rows = trainees.map((trainee) => {
    // Get first enrollment (or first matching program if filtered)
    const traineeEnrollments = enrollmentsByTrainee.get(trainee.id as string) || [];
    const firstEnrollment = traineeEnrollments[0];

    return {
      id: trainee.id,
      last_name: trainee.last_name,
      first_name: trainee.first_name,
      middle_name: trainee.middle_name || '',
      email: trainee.email,
      phone: trainee.phone,
      sex: trainee.sex,
      // FIX: Get program name from enrollments table
      program: firstEnrollment ? (programNameById.get(firstEnrollment.program_id) || 'Unknown') : 'Not Enrolled',
      status: trainee.status,
      // FIX: Get enrollment date from enrollments table
      enrollment_date: firstEnrollment?.enrollment_date || '',
      municipality: trainee.municipality || '',
      province: trainee.province || '',
    };
  });

  const csv = objectsToCsv(rows, [
  'id',
  'last_name',
  'first_name',
  'middle_name',
  'email',
  'phone',
  'sex',
  'program',
  'status',
  'enrollment_date',
  'municipality',
  'province',
  ]);

  return createCsvDownloadResponse(csv, 'trainees-export.csv');
});
