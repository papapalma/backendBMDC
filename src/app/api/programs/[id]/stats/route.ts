import { NextRequest, NextResponse } from 'next/server';
import { programService } from '@/services/programService';
import { requireRoleAsync } from '@/middleware/auth';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, notFoundResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/programs/[id]/stats
 * 
 * Get program-specific statistics including registration counts only.
 * 
 * Access: local_admin, staff_training_coordinator, staff_inventory_manager, super_admin
 * Tenant-scoped: Yes (can only see programs in your tenant)
 * 
 * NOTE: Enrollment data should come from the enriched program object or /enrollments endpoint.
 *       This endpoint focuses on registration statistics for the program card display.
 */
export const GET = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const authResult = await requireRoleAsync(request, [
    'local_admin',
    'staff_training_coordinator',
    'staff_inventory_manager',
    'super_admin',
  ]);
  if ('error' in authResult) return authResult.error;

  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;
  const isSuperAdmin = authResult.user.role === 'super_admin';
  const resolvedParams = await params;
  const programId = resolvedParams.id;

  // Get program with tenant scoping
  const program = await programService.getProgramById(
    programId,
    isSuperAdmin ? undefined : context.tenantId
  );

  if (!program) {
    return notFoundResponse('Program not found');
  }

  const tenantId = program.tenant_id || context.tenantId;

  // Query all trainees with pending or approved registration status that have enrollments for this program
  const { data: registrations, error: registrationError } = await supabaseAdmin
    .from('trainees')
    .select(`
      id,
      registration_status,
      enrollments(id, program_id, status)
    `)
    .eq('tenant_id', tenantId)
    .in('registration_status', ['pending', 'approved']);

  if (registrationError) {
    console.error('[Program Stats] Error fetching registrations:', registrationError);
    throw registrationError;
  }

  // Count registrations specific to this program
  let pendingRegistrations = 0;
  let approvedRegistrations = 0;

  registrations?.forEach((trainee: any) => {
    if (trainee.enrollments && Array.isArray(trainee.enrollments)) {
      // Check if trainee has any enrollment for this program
      const hasEnrollmentForProgram = trainee.enrollments.some(
        (e: any) => e.program_id === programId
      );
      
      if (hasEnrollmentForProgram) {
        if (trainee.registration_status === 'pending') {
          pendingRegistrations++;
        } else if (trainee.registration_status === 'approved') {
          approvedRegistrations++;
        }
      }
    }
  });

  return successResponse({
    program_id: program.id,
    program_name: program.name,
    pending_registrations: pendingRegistrations,
    approved_registrations: approvedRegistrations,
    total_registrations: pendingRegistrations + approvedRegistrations,
  });
});
