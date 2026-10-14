import { NextRequest } from 'next/server';
import { withCMSAuth, CMSTenantContext } from '@/middleware/cmsAuth';
import { ThemePresetService } from '@/services/cms/ThemePresetService';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';

// Initialize theme preset service
const themePresetService = new ThemePresetService();

/**
 * GET /api/theme-presets
 *
 * Fetch all active theme presets available for the tenant to apply.
 * Presets are global templates; each tenant can apply them independently.
 *
 * Requirements Addressed:
 * - 10.1: Display available theme preset options
 * - 2.1: Extract tenant context from JWT
 * - 12.2: Display customization interface for authorized admins
 * - 12.3: Reject unauthorized API calls with 403 Forbidden
 *
 * Authentication:
 * - Requires valid JWT token with admin role (admin or superadmin)
 * - Returns 401 if no token provided
 * - Returns 403 if tenant_id invalid or role insufficient
 *
 * Response:
 * - 200: Array of preset objects (id, name, description, category, preset_data, etc.)
 * - 401: Missing or invalid authentication token
 * - 403: Insufficient permissions (not admin)
 * - 500: Server error
 *
 * Response Format:
 * ```json
 * [
 *   {
 *     "id": "uuid",
 *     "name": "Modern Minimal",
 *     "description": "Clean and minimalist design",
 *     "category": "modern",
 *     "preset_data": { ... },
 *     "created_at": "2024-01-01T00:00:00Z",
 *     "updated_at": "2024-01-01T00:00:00Z",
 *     "is_active": true
 *   },
 *   ...
 * ]
 * ```
 */

// OPTIONS handler for CORS
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const GET = withCMSAuth(async (request: NextRequest, context: CMSTenantContext) => {
  const { tenantId, adminId } = context;

  try {
    console.log('[GET /api/theme-presets] Fetching presets', {
      tenantId,
      adminId,
    });

    // Call ThemePresetService to fetch all active presets
    // Presets are global and not tenant-specific, so no filtering by tenant_id
    const presets = await themePresetService.getAllActivePresets();

    console.log('[GET /api/theme-presets] Successfully fetched presets', {
      tenantId,
      adminId,
      presetCount: presets.length,
    });

    // Return 200 with array of presets
    return successResponse(presets);
  } catch (error) {
    console.error('[GET /api/theme-presets] Error fetching presets', {
      tenantId,
      adminId,
      error: (error as Error).message,
    });

    return new Response(
      JSON.stringify({ error: 'Failed to fetch presets' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});
