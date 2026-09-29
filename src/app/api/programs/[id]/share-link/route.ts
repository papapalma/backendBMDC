/**
 * GET /api/programs/:id/share-link — generate shareable link with OG metadata
 *
 * Requirements: 1.1, 1.2, 1.3, 1.5
 *
 * Responsibility:
 * - Verify caller is admin with permission to share this program
 * - Return fully formed shareable URL with embedded program_id query parameter
 * - Generate Open Graph metadata for social media previews
 * - Idempotent: same program → same link each time
 * - No database write needed (URL is deterministic)
 */

import { NextRequest, NextResponse } from 'next/server';
import { programService } from '@/services/programService';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, notFoundResponse, forbiddenResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';

/**
 * Open Graph metadata for social media previews
 */
interface OpenGraphMetadata {
  title: string;
  description: string;
  image?: string;
  url: string;
}

/**
 * Shareable link response structure
 */
interface ShareableLinkResponse {
  url: string;
  programId: string;
  generatedAt: string;
  og: OpenGraphMetadata;
}

/**
 * Get the base URL from environment or request
 */
function getBaseUrl(request: NextRequest): string {
  const host = request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto') || 'http';
  const baseUrl = `${protocol}://${host}`;
  return baseUrl;
}

/**
 * Generate Open Graph metadata for a program
 */
function generateOpenGraphMetadata(
  program: any,
  shareUrl: string
): OpenGraphMetadata {
  // Construct description from program details
  const description = program.description || `Join the ${program.name} program`;
  
  // Use program image if available, otherwise default placeholder
  const imageUrl = program.image_path ? `${process.env.BACKEND_URL || ''}/uploads/${program.image_path}` : undefined;

  return {
    title: `${program.name} - Training Program`,
    description: description.substring(0, 160), // OG description limit
    image: imageUrl,
    url: shareUrl,
  };
}

/**
 * GET /api/programs/:id/share-link
 *
 * Generate a shareable link for a program with Open Graph metadata.
 * Requires admin authorization.
 *
 * Query Parameters:
 *   - utm_source (optional): Social platform name (facebook, twitter, etc.)
 *   - utm_medium (optional): Always 'social' for shares
 *   - utm_campaign (optional): Campaign identifier for tracking
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "url": "https://bmdc.online/share?program_id=...",
 *     "programId": "...",
 *     "generatedAt": "2024-01-15T10:30:00Z",
 *     "og": {
 *       "title": "Program Name - Training Program",
 *       "description": "Program description",
 *       "image": "https://...",
 *       "url": "https://bmdc.online/share?program_id=..."
 *     }
 *   }
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
    // Verify admin authorization
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const { tenantId, role, isSuperAdmin } = ctxResult.context;

    // Only local_admin, staff_training_coordinator, and super_admin can generate share links
    const allowedRoles = ['local_admin', 'staff_training_coordinator', 'super_admin'];
    if (!allowedRoles.includes(role)) {
      return forbiddenResponse('Insufficient permissions to generate share links');
    }

    const { id: programId } = await params;
    const { searchParams } = new URL(request.url);

    // Fetch program to verify it exists and belongs to tenant
    const program = await programService.getProgramById(programId, isSuperAdmin ? undefined : tenantId);

    if (!program) {
      return notFoundResponse('Program not found');
    }

    // Verify program is active (Requirement 1.2, 1.3)
    if (program.status !== 'active') {
      return forbiddenResponse('Can only generate share links for active programs');
    }

    // Generate shareable URL
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    
    // Build UTM parameters if provided (optional tracking)
    const utmParams = new URLSearchParams();
    utmParams.set('program_id', programId);
    
    const utm_source = searchParams.get('utm_source');
    const utm_medium = searchParams.get('utm_medium');
    const utm_campaign = searchParams.get('utm_campaign');
    
    if (utm_source) utmParams.set('utm_source', utm_source);
    if (utm_medium) utmParams.set('utm_medium', utm_medium);
    if (utm_campaign) utmParams.set('utm_campaign', utm_campaign);

    // URL is deterministic (same program_id always produces same base URL structure)
    // This satisfies Requirement 1.5 (idempotent link generation)
    const shareUrl = `${baseUrl}/share?${utmParams.toString()}`;

    // Generate Open Graph metadata for social media previews
    const ogMetadata = generateOpenGraphMetadata(program, shareUrl);

    const response: ShareableLinkResponse = {
      url: shareUrl,
      programId: programId,
      generatedAt: new Date().toISOString(),
      og: ogMetadata,
    };

    return successResponse(response);
  }
);
