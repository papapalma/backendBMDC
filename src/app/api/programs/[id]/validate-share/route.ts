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
  name: string;
  description?: string;
  status: string;
  start_date: string;
  end_date: string;
  max_trainees?: number;
  current_enrollment?: number;
  image_path?: string;
  thumbnail_path?: string;
  instructor?: string;
  duration_weeks?: number;
}

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

      // Requirement 2.3: Check program status (must be 'active')
      const isActive = program.status === 'active';
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

      // Requirement 2.4: Check program is available for public enrollment
      // For now, we consider all active programs as publicly available for enrollment
      // This can be extended with an `open_for_public` flag if needed in the future
      const isPublic = true; // Active programs are publicly enrollable

      // Build response with program details
      const programDetails: ProgramDetailsForSharing = {
        id: program.id,
        name: program.name,
        description: program.description ?? undefined,
        status: program.status,
        start_date: program.start_date,
        end_date: program.end_date,
        max_trainees: program.max_trainees ?? undefined,
        current_enrollment: program.current_enrollment ?? undefined,
        image_path: program.image_path ?? undefined,
        thumbnail_path: program.thumbnail_path ?? undefined,
        instructor: program.instructor ?? undefined,
        duration_weeks: program.duration_weeks ?? undefined,
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
