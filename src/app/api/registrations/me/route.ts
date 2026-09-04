import { NextRequest, NextResponse } from 'next/server';
import { requireRoleAsync } from '@/middleware/auth';
import { successResponse, notFoundResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';

// OPTIONS /api/registrations/me - Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

/**
 * GET /api/registrations/me
 * Get the current trainee's registration/application records
 * This endpoint is for trainees to view their pending registrations
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRoleAsync(request, ['trainee']);
  if ('error' in authResult) return authResult.error as NextResponse;

  // Get trainee's email from auth context

const userEmail = authResult.user.email;

  if (!userEmail) {
    return notFoundResponse('User email not found');
  }

  // Fetch all registrations for this trainee's email
  // In normalized schema, registrations are in trainees table with registration_status
  // This shows both pending and historical registrations (approved/rejected/completed)

  const { data: registrations, error } = await supabaseAdmin
    .from('trainees')
    .select(`
      id,
      tenant_id,
      email,
      first_name,
      last_name,
      middle_name,
      phone,
      sex,
      birth_date,
      birth_place,
      civil_status,
      province,
      municipality,
      barangay,
      street,
      educational_attainment,
      course,
      year_graduated,
      classification,
      disability,
      employment_status,
      registration_status,
      registration_rejection_reason,
      registration_reviewed_by,
      registration_reviewed_at,
      created_at,
      updated_at,
      enrollments(id, program_id, status, programs(id, name, description, start_date, end_date, status))
    `)
    .eq('email', userEmail.toLowerCase())
    .in('registration_status', ['pending', 'approved', 'rejected', 'completed'])
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return successResponse(registrations || []);
});
