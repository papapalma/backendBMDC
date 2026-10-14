import { NextRequest, NextResponse } from 'next/server';
import { traineeService } from '@/services/traineeService';
import { requireRoleAsync } from '@/middleware/auth';
import { successResponse, notFoundResponse, errorResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireFeature, FeatureKey } from '@/lib/featureFlags';
import { z } from 'zod';

// Fields a trainee is permitted to update on their own profile (SEC-10)
const updateTraineeSelfSchema = z.object({
  phone: z.string().min(10).max(20).regex(/^[0-9+\-\s()]+$/).optional(),
  province: z.string().min(1).max(100).optional(),
  municipality: z.string().min(1).max(100).optional(),
  barangay: z.string().min(1).max(100).optional(),
  street: z.string().min(1).optional(),
  photo_path: z.string().optional().nullable(),
  emergency_contact_name: z.string().max(255).optional().nullable(),
  emergency_contact_phone: z.string().max(50).optional().nullable(),
});

// OPTIONS /api/trainees/me - Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

/**
 * GET /api/trainees/me
 * Get the current trainee's profile (trainee role only).
 * Requires mobile_app_access feature flag (Req 23.4).
 *
 * FIXED: Properly retrieves trainee data through trainee_accounts link,
 * with fallback to trainees table by user_id + tenant_id with approval status validation.
 * Programs are fetched separately through enrollments table (normalized schema).
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRoleAsync(request, ['trainee']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const userId = authResult.user.userId;
  const tenantId = authResult.user.tenantId; // Capture from JWT context

  // Stage 1: Try trainee_accounts first (primary path after approval)
  let traineeData: any = null;
  let traineeId: string | null = null;

  const { data: traineeAccount } = await supabaseAdmin
    .from('trainee_accounts')
    .select('trainee_id, trainees(*)')
    .eq('user_id', userId)
    .maybeSingle();

  if (traineeAccount?.trainees) {
    traineeData = traineeAccount.trainees;
    traineeId = traineeAccount.trainee_id;
  } else {
    // Stage 2: Fallback to direct trainees table query with tenant_id + user_id + approval validation
    // This handles cases where trainee_accounts link doesn't exist yet
    const { data: traineeByUser } = await supabaseAdmin
      .from('trainees')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .maybeSingle();

    // Validate trainee has approved status (registration_status='completed' or status='active')
    if (traineeByUser && (traineeByUser.registration_status === 'completed' || traineeByUser.status === 'active')) {
      traineeData = traineeByUser;
      traineeId = traineeByUser.id;
    }
  }

  if (!traineeData || !traineeId) {
    return notFoundResponse('Trainee profile not found for this user');
  }

  // Feature gate: mobile_app_access must be enabled for this tenant (Req 23.4)
  if (traineeData?.tenant_id) {
    const featureCheck = await requireFeature(traineeData.tenant_id, FeatureKey.MOBILE_APP_ACCESS);
    if (featureCheck) return featureCheck as any;
  }

  // Fetch programs through enrollments (normalized schema: no direct trainee.program_id)
  const { data: enrollments } = await supabaseAdmin
    .from('enrollments')
    .select('program_id, programs(*)')
    .eq('trainee_id', traineeId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(1); // Get most recent enrollment for primary program

  // Format the response to include program at the top level
  const response = {
    ...traineeData,
    program: enrollments && enrollments.length > 0 && enrollments[0].programs ? enrollments[0].programs : undefined,
  };

  return successResponse(response);
});

/**
 * PUT /api/trainees/me
 * Update the current trainee's own profile (trainee role only)
 * Trainees can only update certain fields
 */
export const PUT = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRoleAsync(request, ['trainee']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const userId = authResult.user.userId;
  const tenantId = authResult.user.tenantId; // Capture from JWT context

  // Stage 1: Get trainee_id and tenant_id from trainee_accounts table
  let traineeId: string | null = null;
  let resolvedTenantId: string | null = null;

  const { data: traineeAccount } = await supabaseAdmin
    .from('trainee_accounts')
    .select('trainee_id, trainees(id, tenant_id)')
    .eq('user_id', userId)
    .maybeSingle();

  if (traineeAccount?.trainee_id) {
    traineeId = traineeAccount.trainee_id;
    resolvedTenantId = (traineeAccount.trainees as any)?.tenant_id;
  } else {
    // Stage 2: Fallback query with tenant_id + user_id + approval status validation
    const { data: traineeByUser } = await supabaseAdmin
      .from('trainees')
      .select('id, tenant_id, registration_status, status')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .maybeSingle();

    // Validate trainee has approved status
    if (traineeByUser && (traineeByUser.registration_status === 'completed' || traineeByUser.status === 'active')) {
      traineeId = traineeByUser.id;
      resolvedTenantId = traineeByUser.tenant_id;
    }
  }

  if (!traineeId) {
    return notFoundResponse('Trainee profile not found for this user');
  }

  const body = await request.json();

  // Only allow the fields defined in updateTraineeSelfSchema (SEC-10)
  const updateData = updateTraineeSelfSchema.parse(body);

  // Remove undefined keys so we don't accidentally null-out fields
  const filteredData = Object.fromEntries(
    Object.entries(updateData).filter(([, v]) => v !== undefined)
  );

  if (Object.keys(filteredData).length === 0) {
    return errorResponse('No valid fields to update', 400);
  }

  // Update trainee profile
  const { data: updatedTrainee, error: updateError } = await supabaseAdmin
    .from('trainees')
    .update(filteredData)
    .eq('id', traineeId)
    .select()
    .single();

  if (updateError) {
    throw updateError;
  }

  // Log the activity
  await activityLogService.logAction(
    userId,
    'update',
    'trainee',
    traineeId,
    { fields: Object.keys(updateData), changes: updateData },
    undefined,
    resolvedTenantId || undefined
  );

  return successResponse(updatedTrainee, 'Profile updated successfully');
});
