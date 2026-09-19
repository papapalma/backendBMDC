/**
 * POST /api/programs/:id/enroll — Enroll a trainee in a program from social shared link
 *
 * Requirements: 4.1, 4.2, 4.3, 5.1, 10.2
 *
 * Responsibility:
 * - Verify caller is authenticated (logged-in trainee)
 * - Verify program exists and is active
 * - Prevent duplicate enrollments
 * - Check program capacity
 * - Create enrollment record
 * - Return success response
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, forbiddenResponse, errorResponse, notFoundResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { z } from 'zod';

const enrollSchema = z.object({
  trainee_id: z.string().uuid('Invalid trainee ID format'),
});

/**
 * Handle OPTIONS request (CORS preflight)
 */
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

/**
 * POST /api/programs/:id/enroll
 *
 * Enroll a trainee in a program (from social shared link)
 *
 * Request body:
 * {
 *   "trainee_id": "uuid"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "enrollment_id": "uuid",
 *     "program_id": "uuid",
 *     "trainee_id": "uuid",
 *     "status": "enrolled",
 *     "enrollment_date": "2024-01-15T10:30:00Z"
 *   }
 * }
 */
export const POST = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    // Verify authentication
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const { tenantId, userId } = ctxResult.context;
    const { id: programId } = await params;

    if (!programId) {
      return errorResponse('Program ID is required', 400);
    }

    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON in request body', 400);
    }

    let validatedData;
    try {
      validatedData = enrollSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.errors.map((err) => `${err.path.join('.')}: ${err.message}`);
        return errorResponse(`Validation failed: ${fieldErrors.join('; ')}`, 400);
      }
      return errorResponse('Validation failed', 400);
    }

    const { trainee_id } = validatedData;

    try {
      // 1. Verify program exists and is active
      const { data: program, error: programError } = await supabaseAdmin
        .from('programs')
        .select('id, status, enrollment_limit, tenant_id')
        .eq('id', programId)
        .maybeSingle();

      if (programError) throw programError;
      if (!program) return notFoundResponse('Program not found');
      if (program.status !== 'active') {
        return forbiddenResponse('Can only enroll in active programs');
      }

      // 2. Check for existing enrollment
      const { data: existingEnrollment, error: enrollmentCheckError } = await supabaseAdmin
        .from('enrollments')
        .select('id, status')
        .eq('trainee_id', trainee_id)
        .eq('program_id', programId)
        .maybeSingle();

      if (enrollmentCheckError) throw enrollmentCheckError;

      if (existingEnrollment) {
        if (existingEnrollment.status === 'dropped' || existingEnrollment.status === 'cancelled') {
          // Re-enroll if previously dropped/cancelled
          // Update existing enrollment record
          const { data: updated, error: updateError } = await supabaseAdmin
            .from('enrollments')
            .update({
              status: 'enrolled',
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingEnrollment.id)
            .select()
            .single();

          if (updateError) throw updateError;

          return successResponse({
            enrollment_id: updated.id,
            program_id: programId,
            trainee_id,
            status: updated.status,
            enrollment_date: updated.created_at,
          });
        } else {
          // Already enrolled
          return errorResponse('You are already enrolled in this program', 409);
        }
      }

      // 3. Check program capacity
      const { count: currentEnrollment, error: countError } = await supabaseAdmin
        .from('enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('program_id', programId)
        .not('status', 'in', '(dropped,cancelled)');

      if (countError) throw countError;

      const enrollmentCount = currentEnrollment || 0;
      if (program.enrollment_limit && enrollmentCount >= program.enrollment_limit) {
        return forbiddenResponse('Program is at full capacity');
      }

      // 4. Create enrollment
      const { data: newEnrollment, error: enrollError } = await supabaseAdmin
        .from('enrollments')
        .insert({
          program_id: programId,
          trainee_id,
          status: 'enrolled',
          enrollment_source: 'social_share', // Track that this came from social sharing
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (enrollError) throw enrollError;

      return successResponse(
        {
          enrollment_id: newEnrollment.id,
          program_id: programId,
          trainee_id,
          status: newEnrollment.status,
          enrollment_date: newEnrollment.created_at,
        },
        'Successfully enrolled in program',
        201
      );
    } catch (error) {
      console.error('[enroll] Error:', error);
      throw error;
    }
  }
);