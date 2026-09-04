/**
 * GET  /api/enrollments  — list enrollments (tenant-scoped, Req 7.4)
 * POST /api/enrollments  — enroll a trainee in a program (tenant-scoped, Req 7.4)
 *
 * Requirements: 7.4, 3.6, 3.7
 *
 * Cross-tenant enrollment is explicitly prevented: both the trainee and the
 * program must belong to the requesting user's tenant.
 *
 * On successful enrollment creation, an 'enrollment-added' event is emitted
 * to the enrollment event bus for real-time synchronization.
 */
import { NextRequest, NextResponse } from 'next/server';

import { requireTenantContext } from '@/middleware/tenantContext';

import { successResponse, forbiddenResponse, errorResponse } from '@/utils/responses';

import { withErrorHandler } from '@/middleware/errorHandler';

import { activityLogService } from '@/services/activityLogService';

import { handleOptionsRequest } from '@/middleware/cors';

import { supabaseAdmin } from '@/lib/supabase-admin';

import { enrollmentEventBus } from '@/lib/enrollment-event-bus';

import { z } from 'zod';

// Validation schemas
const createEnrollmentSchema = z.object({
  trainee_id: z.string().uuid('Invalid trainee ID'),
  program_id: z.string().uuid('Invalid program ID'),
  enrollment_date: z.string().optional(),
  notes: z.string().max(1000).optional(),
  source: z.enum(['social_share', 'direct', 'admin_assigned']).optional().default('direct'),
});

const updateEnrollmentStatusSchema = z.object({
  status: z.enum(['enrolled', 'active', 'completed', 'dropped', 'failed']),
  completion_date: z.string().optional(),
  final_grade: z.number().min(0).max(100).optional(),
});

// OPTIONS /api/enrollments - Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/enrollments - Get all enrollments scoped to the requesting user's tenant (Req 7.4)
export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, isSuperAdmin } = ctxResult.context;

  const { searchParams } = new URL(request.url);

  const traineeId = searchParams.get('trainee_id') || undefined;
  const programId = searchParams.get('program_id') || undefined;
  const status = searchParams.get('status') || undefined;

  let query = supabaseAdmin
    .from('enrollments')
    .select(`
      *,
      trainee:trainees(id, first_name, last_name, middle_name, email, qr_code, photo_path),
      program:programs(id, name, description, start_date, end_date, status)
    `);

  // Tenant isolation — Super Admin can see all, others see only their tenant (Req 7.4)

if (!isSuperAdmin) {
    query = query.eq('tenant_id', tenantId);
  }

if (traineeId) query = query.eq('trainee_id', traineeId);
  if (programId) query = query.eq('program_id', programId);
  if (status) query = query.eq('status', status);

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw error;

  return successResponse(data || []);
});

// POST /api/enrollments - Enroll a trainee in a program within the same tenant (Req 7.4)
export const POST = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role } = ctxResult.context;

  const allowedRoles = ['local_admin', 'staff_training_coordinator'];
  if (!allowedRoles.includes(role)) {
    return forbiddenResponse('Insufficient permissions to create enrollments');
  }

const body = await request.json();

  const validatedData = createEnrollmentSchema.parse(body);

  // Verify trainee belongs to this tenant — prevent cross-tenant enrollment (Req 7.4)

const { data: trainee, error: traineeError } = await supabaseAdmin
    .from('trainees')
    .select('id, tenant_id, first_name, last_name')
    .eq('id', validatedData.trainee_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (traineeError) throw traineeError;
  if (!trainee) {
    return errorResponse('Trainee not found in your tenant', 404);
  }

  // Verify program belongs to this tenant — prevent cross-tenant enrollment (Req 7.4)

const { data: program, error: programError } = await supabaseAdmin
    .from('programs')
    .select('id, tenant_id, name, status, enrollment_limit')
    .eq('id', validatedData.program_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (programError) throw programError;
  if (!program) {
    return errorResponse('Program not found in your tenant', 404);
  }

  // Check if trainee is already enrolled in this program
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('enrollments')
    .select('id, status')
    .eq('trainee_id', validatedData.trainee_id)
    .eq('program_id', validatedData.program_id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    return errorResponse(
      `Trainee is already enrolled in this program (status: ${existing.status})`,
      409
    );
  }

  // Check enrollment capacity (Req 13.1, 13.2, 13.3, 13.5)
  // If enrollment_limit is null, skip capacity check (unlimited)
  if (program.enrollment_limit !== null) {
    const currentEnrollment = await (await import('@/services/programService')).programService.getCurrentEnrollmentCount(
      validatedData.program_id,
      tenantId
    );

    if (currentEnrollment >= program.enrollment_limit) {
      return errorResponse(
        'Program is at capacity and cannot accept new enrollments.',
        400
      );
    }
  }

  // Create the enrollment record with tenant_id injected from JWT
const enrollmentRecord = {
    tenant_id: tenantId,
    trainee_id: validatedData.trainee_id,
    program_id: validatedData.program_id,
    enrollment_date: validatedData.enrollment_date || new Date().toISOString().split('T')[0],
    status: 'enrolled' as const,
    source: validatedData.source,
  };

  const { data: enrollment, error: insertError } = await supabaseAdmin
    .from('enrollments')
    .insert(enrollmentRecord)
    .select(`
      *,
      trainee:trainees(id, first_name, last_name, middle_name, email),
      program:programs(id, name, start_date, end_date)
    `)
    .single();
  if (insertError) throw insertError;

  await activityLogService.logAction(userId, 'create', 'enrollment', enrollment.id, {
    trainee_id: validatedData.trainee_id,
    program_id: validatedData.program_id,
    source: validatedData.source,
    tenantId,
  });

  // Emit 'enrollment-added' event to event bus for real-time synchronization (Req 3.6, 3.7)
  enrollmentEventBus.emit({
    type: 'enrollment-added',
    enrollment: {
      id: enrollment.id,
      trainee_id: enrollment.trainee_id,
      program_id: enrollment.program_id,
      status: enrollment.status,
      source: enrollment.source,
      enrollment_date: enrollment.enrollment_date,
      completion_date: enrollment.completion_date,
      created_at: enrollment.created_at,
      updated_at: enrollment.updated_at,
    },
    tenantId,
    timestamp: new Date().toISOString(),
    userId,
  });

  return successResponse(enrollment, 'Trainee enrolled successfully', 201);
});
