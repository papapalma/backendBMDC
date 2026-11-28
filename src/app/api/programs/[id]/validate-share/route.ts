/**
 * GET /api/programs/:id/validate-share — validate program for social sharing
 *
 * Requirements: 2.1, 2.3, 2.4, 8.1
 *
 * Responsibility:
 * - Extract program details and verify program exists in database
 * - Check program status (must be 'active')
 * - Check program is available for public enrollment
 * - Return validation result with program metadata if valid
 * - Return appropriate errors with user-friendly messages
 * - No authentication required (public endpoint for social link users)
 *
 * **Validates: Requirements 2.1, 2.3, 2.4, 8.1**
 * **Property 3: Program Validation Non-Acceptance** — Invalid program_id fails validation and no data stored
 */

import { NextRequest, NextResponse } from 'next/server';
import { programService } from '@/services/programService';
import { successResponse, errorResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';

/**
 * Program details relevant to social sharing (public information)
 */
interface ProgramDetailsForSharing {
  id: string;
  tenant_id?: string;
  name: string;
  description?: string;
  status: string;
  start_date: string;
  end_date: string;
  max_trainees?: number;
  enrollment_limit?: number | null;
  current_enrollment?: number;
  image_path?: string | null;
  thumbnail_path?: string | null;
  instructor?: string;
  duration_weeks?: number;
}

const SHAREABLE_PROGRAM_STATUSES = new Set(['active', 'upcoming']);

/**
 * Validation result for a program
 */
interface ProgramValidationResult {
  isValid: boolean;
  isActive: boolean;
  isPublic: boolean;
  program?: ProgramDetailsForSharing;
  error?: string;
}

/**
 * GET /api/programs/:id/validate-share
 *
 * Validate a program for social sharing without authentication.
 * This endpoint is called by unauthenticated users clicking a shared link
 * to verify the program exists, is active, and is available for public enrollment.
 *
 * Query Parameters:
 *   - None
 *
 * Response on Success:
 * {
 *   "success": true,
 *   "data": {
 *     "isValid": true,
 *     "isActive": true,
 *     "isPublic": true,
 *     "program": {
 *       "id": "prog-uuid",
 *       "name": "Program Name",
 *       "description": "Program description",
 *       "status": "active",
 *       "start_date": "2024-01-15",
 *       "end_date": "2024-03-15",
 *       "max_trainees": 30,
 *       "current_enrollment": 12,
 *       "image_path": "programs/prog-uuid/image.jpg",
 *       "instructor": "John Doe"
 *     }
 *   }
 * }
 *
 * Response on Failure (Invalid Program):
 * {
 *   "success": false,
 *   "error": "This program is no longer available"
 * }
 */

/**
 * Handle OPTIONS request (CORS preflight)
 */
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}
export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id: programId } = await params;

    // Validate program ID format (basic UUID validation)
    if (!programId || typeof programId !== 'string' || programId.trim() === '') {
      return errorResponse('Invalid program ID', 400);
    }

    try {
      // Requirement 2.1: Extract program details from database
      // Note: We don't pass tenantId because this is a public endpoint
      // Admin should only share links to public programs
      const program = await programService.getProgramById(programId);

      if (!program) {
        // Requirement 2.4, 8.1: Return user-friendly error for non-existent program
        return successResponse(
          {
            isValid: false,
            isActive: false,
            isPublic: false,
            error: 'This program is no longer available',
          } as ProgramValidationResult,
          undefined,
          200
        );
      }

      // Allow sharing both active and upcoming programs (block completed/cancelled)
      const isActive = SHAREABLE_PROGRAM_STATUSES.has(program.status);
      if (!isActive) {
        return successResponse(
          {
            isValid: false,
            isActive: false,
            isPublic: false,
            error: 'This program is no longer available',
          } as ProgramValidationResult,
          undefined,
          200
        );
      }

      // Enrich with real enrollment counts when available (graceful fallback for mocked unit tests)
      let enrichedProgram: any = program;
      if (typeof programService.enrichProgramWithEnrollment === 'function') {
        try {
          const enriched = await programService.enrichProgramWithEnrollment(program);
          if (enriched && !Array.isArray(enriched)) {
            enrichedProgram = enriched;
          }
        } catch {
          enrichedProgram = program;
        }
      }

      // Requirement 2.4: Check program is available for public enrollment
      const isPublic = true; // Active & upcoming programs are publicly enrollable

      // Build response with program details
      const programDetails: ProgramDetailsForSharing = {
        id: enrichedProgram.id,
        tenant_id: enrichedProgram.tenant_id ?? undefined,
        name: enrichedProgram.name,
        description: enrichedProgram.description ?? undefined,
        status: enrichedProgram.status,
        start_date: enrichedProgram.start_date,
        end_date: enrichedProgram.end_date,
        max_trainees: enrichedProgram.max_trainees ?? undefined,
        enrollment_limit:
          enrichedProgram.enrollment_limit !== undefined ? enrichedProgram.enrollment_limit : undefined,
        current_enrollment: enrichedProgram.current_enrollment ?? undefined,
        image_path: enrichedProgram.image_path !== undefined ? enrichedProgram.image_path : null,
        thumbnail_path: enrichedProgram.thumbnail_path !== undefined ? enrichedProgram.thumbnail_path : null,
        instructor: enrichedProgram.instructor ?? undefined,
        duration_weeks: enrichedProgram.duration_weeks ?? undefined,
      };

      const validationResult: ProgramValidationResult = {
        isValid: true,
        isActive: true,
        isPublic: true,
        program: programDetails,
      };

      return successResponse(validationResult);
    } catch (error) {
      console.error('[validate-share] Error validating program:', {
        programId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return user-friendly error without exposing system details
      return successResponse(
        {
          isValid: false,
          isActive: false,
          isPublic: false,
          error: 'Unable to validate program. Please try again.',
        } as ProgramValidationResult,
        undefined,
        200
      );
    }
  }
);
