import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireRoleAsync } from '@/middleware/auth';
import { successResponse, notFoundResponse, errorResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/trainees/:id/certificates - Handle CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

/**
 * GET /api/trainees/:id/certificates
 * Get all certificates for a trainee via the certificates table (linked through enrollments).
 * Accessible by admin, staff_training_coordinator, and the trainee themselves.
 */
export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const authResult = await requireRoleAsync(request, ['local_admin', 'staff_training_coordinator', 'trainee']);
    if ('error' in authResult) return authResult.error as NextResponse;

    const { id } = await params;

    // If trainee role, verify they're accessing their own profile

if (authResult.user.role === 'trainee') { 
      let isOwn = false;
      
      const { data: traineeAccount } = await supabaseAdmin
        .from('trainee_accounts')
        .select('trainee_id')
        .eq('user_id', authResult.user.userId)
        .maybeSingle();

      if (traineeAccount?.trainee_id === id) {
        isOwn = true;
      } else {
        // Fallback: check if trainee's user_id matches
        const { data: traineeByUser } = await supabaseAdmin
          .from('trainees')
          .select('id')
          .eq('user_id', authResult.user.userId)
          .eq('id', id)
          .maybeSingle();

        if (traineeByUser) {
          isOwn = true;
        }
      }

      if (!isOwn) { 
        return errorResponse('You can only access your own certificates', 403); 
      }
    }

    // Verify trainee exists

const { data: trainee, error: traineeError } = await supabaseAdmin
      .from('trainees')
      .select('id, first_name, last_name')
      .eq('id', id)
      .single();

    if (traineeError || !trainee) { return notFoundResponse('Trainee not found'); }

    // Fetch certificates via enrollments → certificates join

const { data: certificates, error } = await supabaseAdmin
      .from('certificates')
      .select(`
        id,
        certificate_number,
        issue_date,
        file_path,
        qr_code,
        qr_code_path,
        verification_url,
        signatory_name,
        signatory_title,
        created_at,
        enrollments!inner (
          trainee_id,
          program_id,
          programs ( name )
        )
      `)
      .eq('enrollments.trainee_id', id);

    if (error) throw error;

    return successResponse({ trainee_id: trainee.id,
      trainee_name: `${trainee.first_name} ${trainee.last_name}`,
      certificates: certificates || [], }); }
);

/**
 * POST /api/trainees/:id/certificates
 * Issue a certificate for a trainee by creating a row in the certificates table.
 * Requires an existing completed enrollment.
 * Admin and staff_training_coordinator only.
 */
export const POST = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const authResult = await requireRoleAsync(request, ['local_admin', 'staff_training_coordinator']);
    if ('error' in authResult) return authResult.error as NextResponse;

    const { id } = await params;
    const body = await request.json();
    const { enrollment_id, certificate_number, issue_date, file_path, qr_code, qr_code_path, verification_url, signatory_name, signatory_title } = body;

    if (!enrollment_id) return errorResponse('enrollment_id is required', 400);

    if (!certificate_number) return errorResponse('certificate_number is required', 400);

    if (!issue_date) return errorResponse('issue_date is required', 400);

    if (!file_path) return errorResponse('file_path is required', 400);

    if (!qr_code) return errorResponse('qr_code is required', 400);

    // Verify trainee exists

const { data: trainee, error: traineeError } = await supabaseAdmin
      .from('trainees')
      .select('id, first_name, last_name, tenant_id')
      .eq('id', id)
      .single();

    if (traineeError || !trainee) { return notFoundResponse('Trainee not found'); }

    // Verify enrollment belongs to this trainee

const { data: enrollment, error: enrollmentError } = await supabaseAdmin
      .from('enrollments')
      .select('id, trainee_id, tenant_id')
      .eq('id', enrollment_id)
      .eq('trainee_id', id)
      .single();

    if (enrollmentError || !enrollment) { return notFoundResponse('Enrollment not found for this trainee'); }

    // Insert into certificates table

const { data: newCertificate, error: insertError } = await supabaseAdmin
      .from('certificates')
      .insert({ tenant_id: enrollment.tenant_id,
        enrollment_id,
        certificate_number,
        issue_date,
        file_path,
        qr_code,
        qr_code_path: qr_code_path || null,
        verification_url: verification_url || null,
        signatory_name: signatory_name || null,
        signatory_title: signatory_title || null, })
      .select()
      .single();

    if (insertError) throw insertError;

    // Log activity

await activityLogService.logAction(
      authResult.user.userId,
      'create',
      'certificate',
      newCertificate.id,
      { certificate_number,
        trainee_id: id,
        trainee_name: `${trainee.first_name} ${trainee.last_name}`,
        enrollment_id, }
    );

    return successResponse(newCertificate, 'Certificate issued successfully'); }
);

/**
 * DELETE /api/trainees/:id/certificates?certificateId=<uuid>
 * Delete a certificate by its ID.
 * Admin and staff_training_coordinator only.
 */
export const DELETE = withErrorHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => { const authResult = await requireRoleAsync(request, ['local_admin', 'staff_training_coordinator']);
    if ('error' in authResult) return authResult.error as NextResponse;

    const { id } = await params;

    const { searchParams } = new URL(request.url);
    const certificateId = searchParams.get('certificateId');

    if (!certificateId) { return errorResponse('certificateId query parameter is required', 400); }

    // Verify trainee exists

const { data: trainee, error: traineeError } = await supabaseAdmin
      .from('trainees')
      .select('id, first_name, last_name')
      .eq('id', id)
      .single();

    if (traineeError || !trainee) { return notFoundResponse('Trainee not found'); }

    // Fetch the certificate and verify it belongs to this trainee via enrollment

const { data: certificate, error: certError } = await supabaseAdmin
      .from('certificates')
      .select('id, certificate_number, enrollments!inner ( trainee_id )')
      .eq('id', certificateId)
      .eq('enrollments.trainee_id', id)
      .single();

    if (certError || !certificate) { return notFoundResponse('Certificate not found for this trainee'); }

const { error: deleteError } = await supabaseAdmin
      .from('certificates')
      .delete()
      .eq('id', certificateId);

    if (deleteError) throw deleteError;

    // Log activity

await activityLogService.logAction(
      authResult.user.userId,
      'delete',
      'certificate',
      certificateId,
      { certificate_number: (certificate as any).certificate_number,
        trainee_id: id,
        trainee_name: `${trainee.first_name} ${trainee.last_name}`, }
    );

    return successResponse(
      { deleted_certificate_id: certificateId },
      'Certificate deleted successfully'
    ); }
);
