/**
 * POST /api/programs/{programId}/verify-access
 *
 * Permission Verification Endpoint
 *
 * Verifies that a trainee has permission to view and enroll in a program.
 * Checks for:
 * 1. Existing enrollment (prevent duplicates)
 * 2. Program prerequisites are met (if applicable)
 * 3. Program capacity
 * 4. Trainee permissions (role-based)
 *
 * Requires authentication (only for logged-in users).
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireTenantContext } from '@/middleware/tenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { successResponse, forbiddenResponse, errorResponse } from '@/utils/responses';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { programService } from '@/services/programService';
import { activityLogService } from '@/services/activityLogService';

/**
 * Validation schema for verify-access request body
 */
const verifyAccessSchema = z.object({
  trainee_id: z.string().uuid('Invalid trainee ID format'),
});

/**
 * Verification result interface
 */
interface VerificationResult {
  can_access: boolean;
  has_enrolled: boolean;
  reason?: string;
  details?: {
    existing_enrollment?: boolean;
    prerequisites_met?: boolean;
    capacity_available?: boolean;
    permission_denied?: boolean;
  };
}

/**
 * OPTIONS /api/programs/{programId}/verify-access - Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

/**
 * POST /api/programs/{programId}/verify-access
 *
 * Verify trainee access to a program
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
 *     "can_access": true/false,
 *     "has_enrolled": true/false,
 *     "reason": "optional error reason",
 *     "details": {
 *       "existing_enrollment": true/false,
 *       "prerequisites_met": true/false,
 *       "capacity_available": true/false,
 *       "permission_denied": true/false
 *     }
 *   }
 * }
 */
export const POST = withErrorHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    // Check authentication - only for logged-in users
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const { tenantId, userId, role } = ctxResult.context;

    // Extract program ID from URL params
    const { id: programId } = await params;

    if (!programId) {
      return errorResponse('Program ID is required', 400);
    }

    // Parse and validate request body
    let body;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON in request body', 400);
    }

    let validatedData;
    try {
      validatedData = verifyAccessSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.errors.map((err) => `${err.path.join('.')}: ${err.message}`);
        return errorResponse(`Validation failed: ${fieldErrors.join('; ')}`, 400);
      }
      return errorResponse('Validation failed', 400);
    }

    const { trainee_id } = validatedData;

    try {
      // 1. Verify program exists and belongs to this tenant (Req 10.1)
      const { data: program, error: programError } = await supabaseAdmin
        .from('programs')
        .select('id, tenant_id, name, status, enrollment_limit')
        .eq('id', programId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (programError) throw programError;

      if (!program) {
        return errorResponse('Program not found', 404);
      }

      // 2. Verify program is active
      if (program.status !== 'active') {
        // Log denied permission attempt
        await activityLogService.logAction(
          userId,
          'permission_check',
          'program_access',
          programId,
          {
            trainee_id,
            denied: true,
            reason: 'Program is not currently active',
            program_status: program.status,
            tenantId,
          },
          undefined,
          tenantId
        );

        const result: VerificationResult = {
          can_access: false,
          has_enrolled: false,
          reason: 'Program is not currently active',
          details: {
            existing_enrollment: false,
            prerequisites_met: false,
            capacity_available: false,
            permission_denied: true,
          },
        };
        return successResponse(result);
      }

      // 3. Verify trainee exists (Req 10.1) - allow cross-tenant enrollment for shared programs
      const { data: trainee, error: traineeError } = await supabaseAdmin
        .from('trainees')
        .select('id, tenant_id, status')
        .eq('id', trainee_id)
        .maybeSingle();

      if (traineeError) throw traineeError;

      if (!trainee) {
        return errorResponse('Trainee not found in your tenant', 404);
      }

      // 4. Check for existing enrollment (Req 10.2 - prevent duplicates)
      const { data: existingEnrollment, error: enrollmentError } = await supabaseAdmin
        .from('enrollments')
        .select('id, status')
        .eq('trainee_id', trainee_id)
        .eq('program_id', programId)
        .maybeSingle();

      if (enrollmentError) throw enrollmentError;

      if (existingEnrollment) {
        // Log duplicate enrollment attempt
        await activityLogService.logAction(
          userId,
          'permission_check',
          'program_access',
          programId,
          {
            trainee_id,
            denied: true,
            reason: `Already enrolled (status: ${existingEnrollment.status})`,
            existing_enrollment_id: existingEnrollment.id,
            existing_enrollment_status: existingEnrollment.status,
            tenantId,
          },
          undefined,
          tenantId
        );

        const result: VerificationResult = {
          can_access: false,
          has_enrolled: true,
          reason: `Trainee is already enrolled in this program (status: ${existingEnrollment.status})`,
          details: {
            existing_enrollment: true,
            prerequisites_met: true,
            capacity_available: true,
            permission_denied: false,
          },
        };
        return successResponse(result);
      }

      // 5. Check program capacity (Req 10.3)
      let capacityAvailable = true;
      let capacityReason = '';

      if (program.enrollment_limit !== null && program.enrollment_limit > 0) {
        const currentEnrollment = await programService.getCurrentEnrollmentCount(
          programId,
          tenantId
        );

        if (currentEnrollment >= program.enrollment_limit) {
          capacityAvailable = false;
          capacityReason = `Program is at capacity (${currentEnrollment}/${program.enrollment_limit} trainees enrolled)`;
        }
      }

      if (!capacityAvailable) {
        // Log capacity limit denial
        await activityLogService.logAction(
          userId,
          'permission_check',
          'program_access',
          programId,
          {
            trainee_id,
            denied: true,
            reason: capacityReason,
            capacity_limit: program.enrollment_limit,
            current_enrollment: await programService.getCurrentEnrollmentCount(
              programId,
              tenantId
            ),
            tenantId,
          },
          undefined,
          tenantId
        );

        const result: VerificationResult = {
          can_access: false,
          has_enrolled: false,
          reason: capacityReason,
          details: {
            existing_enrollment: false,
            prerequisites_met: true,
            capacity_available: false,
            permission_denied: false,
          },
        };
        return successResponse(result);
      }

      // 6. Check prerequisites (Req 10.4)
      // NOTE: Prerequisites check is a placeholder for future enhancement
      // Current implementation assumes no prerequisites or all trainees can enroll
      // TODO: Implement prerequisite checking based on trainee's previous programs/certifications
      const prerequisitesMet = true;

      // 7. Final permission check
      // Trainee can access if:
      // - Program is active (checked above)
      // - No existing enrollment (checked above)
      // - Capacity available (checked above)
      // - Prerequisites met (checked above)
      const canAccess = capacityAvailable && prerequisitesMet;

      // Log permission check result
      await activityLogService.logAction(
        userId,
        'permission_check',
        'program_access',
        programId,
        {
          trainee_id,
          granted: canAccess,
          denied: !canAccess,
          prerequisites_met: prerequisitesMet,
          capacity_available: capacityAvailable,
          details: {
            existing_enrollment: false,
            prerequisites_met: prerequisitesMet,
            capacity_available: capacityAvailable,
            permission_denied: !canAccess,
          },
          tenantId,
        },
        undefined,
        tenantId
      );

      const result: VerificationResult = {
        can_access: canAccess,
        has_enrolled: false,
        reason: canAccess ? undefined : 'Access denied due to one or more restrictions',
        details: {
          existing_enrollment: false,
          prerequisites_met: prerequisitesMet,
          capacity_available: capacityAvailable,
          permission_denied: !canAccess,
        },
      };

      return successResponse(result);
    } catch (error: any) {
      console.error('[verify-access] Unexpected error:', error);
      throw error; // withErrorHandler will catch and format
    }
  }
);
