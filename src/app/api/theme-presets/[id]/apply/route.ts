/**
 * POST /api/theme-presets/:id/apply
 * Apply a theme preset to the current tenant's customizations
 *
 * This endpoint:
 * 1. Extracts tenant context from authentication
 * 2. Validates the preset exists and is active
 * 3. Applies the preset as the tenant's new customization
 * 4. Creates version history record (automatic from upsertSettings)
 * 5. Creates audit log entry with action='apply_preset'
 * 6. Returns 200 with applied settings
 *
 * Requirements: 10.2, 10.3, 10.4, 2.8, 15.1
 *
 * Tenant Isolation:
 * - Each tenant receives their own isolated copy of the preset
 * - Original preset template remains unchanged
 * - Full tenant isolation enforced via tenant_id context extraction
 * - Cross-tenant access returns 404 (preset not found)
 */

import { NextRequest } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import {
  successResponse,
  notFoundResponse,
} from '@/utils/responses';
import { ThemePresetService } from '@/services/cms/ThemePresetService';
import { CMSSettingsService, TenantMismatchError } from '@/services/cms/CMSSettingsService';
import { DatabaseError } from '@/lib/db';

// Instantiate services
const themePresetService = new ThemePresetService();
const cmsSettingsService = new CMSSettingsService();

// OPTIONS handler for CORS
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

/**
 * POST /api/theme-presets/:id/apply
 * Apply a theme preset to the current tenant
 */
export const POST = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    // Step 1: Extract tenant context (enforces authentication and admin authorization)
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) {
      return ctxResult.error;
    }

    const { tenantId, userId, role } = ctxResult.context;

    // Step 2: Validate admin role (only admins can apply presets)
    // Admin or local_admin roles required
    const allowedRoles = ['admin', 'superadmin', 'local_admin'];
    if (!allowedRoles.includes(role)) {
      return notFoundResponse('Preset not found');
    }

    // Step 3: Extract preset ID from route parameters
    const { id: presetId } = await context.params;

    if (!presetId || typeof presetId !== 'string') {
      return notFoundResponse('Preset not found');
    }

    // Step 4: Fetch the preset from database (validates existence and is_active)
    let preset;
    try {
      preset = await themePresetService.getPresetById(presetId);
    } catch (error) {
      console.error('[POST /theme-presets/:id/apply] Error fetching preset:', error);
      return notFoundResponse('Preset not found');
    }

    if (!preset) {
      return notFoundResponse('Preset not found');
    }

    // Step 5: Apply the preset for the current tenant
    // This calls CMSSettingsService.upsertSettings which:
    // - Creates/updates cms_settings with tenant_id (enforces one record per tenant)
    // - Creates version history record automatically
    // - Creates audit log entry automatically
    // - Returns the applied customization
    let appliedSettings;
    try {
      appliedSettings = await themePresetService.applyPreset(
        tenantId,
        preset.preset_data,
        userId
      );
    } catch (error) {
      if (error instanceof TenantMismatchError) {
        console.warn('[POST /theme-presets/:id/apply] Tenant mismatch error:', error);
        return notFoundResponse('Preset not found');
      }
      if (error instanceof DatabaseError) {
        console.error('[POST /theme-presets/:id/apply] Database error:', error);
        throw error;
      }
      throw error;
    }

    // Step 6: Return 200 with applied settings
    // Note: Version history and audit log are created automatically by upsertSettings
    console.log(
      '[POST /theme-presets/:id/apply] Preset applied successfully:',
      {
        preset_id: presetId,
        preset_name: preset.name,
        tenant_id: tenantId,
        admin_id: userId,
      }
    );

    return successResponse(appliedSettings, 'Preset applied successfully');
  } catch (error) {
    console.error('[POST /theme-presets/:id/apply] Unexpected error:', error);
    throw error;
  }
});
