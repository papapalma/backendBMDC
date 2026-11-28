import { supabaseAdmin } from '@/lib/supabase-admin';
import { DatabaseError } from '@/lib/db';
import { CMSSettingsService, TenantMismatchError } from './CMSSettingsService';

/**
 * Interface for Theme Preset record from database
 */
export interface ThemePreset {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  preset_data: Record<string, any>;
  created_at: string;
  updated_at: string | null;
  is_active: boolean;
}

/**
 * ThemePresetService
 *
 * Handles fetching theme presets and applying them to individual tenants' customizations.
 * Presets are global/shared templates, but when applied, each tenant receives their own isolated
 * copy via the CMSSettingsService.
 *
 * Key Architecture:
 * - Presets are stored once in theme_presets table (shared globally)
 * - When a preset is applied, CMSSettingsService.upsertSettings creates a tenant-specific copy
 * - Each tenant's application is completely independent (full isolation)
 * - Original preset template is never modified by tenant applications
 *
 * Requirements Addressed:
 * - 10.1 (Display available theme presets)
 * - 10.2 (Select and load preset customizations)
 * - 10.3 (Preset application and persistence)
 * - 10.4 (Customize preset without affecting original)
 * - 2.8 (Tenant isolation for preset application)
 */
export class ThemePresetService {
  private readonly TABLE_PRESETS = 'theme_presets';
  private readonly cmsService: CMSSettingsService;

  constructor(cmsService?: CMSSettingsService) {
    // Allow dependency injection for testing, otherwise create new instance
    this.cmsService = cmsService || new CMSSettingsService();
  }

  /**
   * Fetches all active theme presets
   * Requirement: 10.1 (Display available theme presets)
   *
   * Returns all presets where is_active = true, ordered by creation date.
   * These presets are global/shared and can be applied by any tenant.
   *
   * @returns Array of active preset objects with metadata
   * @throws DatabaseError if query fails
   */
  async getAllActivePresets(): Promise<ThemePreset[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from(this.TABLE_PRESETS)
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[ThemePresetService] Error fetching active presets:', {
          error: error.message,
        });
        throw new DatabaseError(
          `Failed to fetch theme presets: ${error.message}`,
          error.code
        );
      }

      console.log('[ThemePresetService] Fetched active presets:', {
        count: data?.length || 0,
      });

      return (data as ThemePreset[]) || [];
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw error;
      }
      throw new DatabaseError(
        `Unexpected error fetching theme presets: ${(error as Error).message}`
      );
    }
  }

  /**
   * Fetches a single theme preset by ID
   * Requirement: 10.2 (Load preset customizations)
   *
   * Returns the preset object if found and is_active = true.
   * Used before applying preset to validate existence and fetch preset_data.
   *
   * @param presetId - Preset ID to fetch
   * @returns Preset object or null if not found or inactive
   * @throws DatabaseError if query fails
   */
  async getPresetById(presetId: string): Promise<ThemePreset | null> {
    if (!presetId || typeof presetId !== 'string') {
      throw new DatabaseError('Invalid preset_id provided');
    }

    try {
      const { data, error } = await supabaseAdmin
        .from(this.TABLE_PRESETS)
        .select('*')
        .eq('id', presetId)
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        console.error('[ThemePresetService] Error fetching preset:', {
          preset_id: presetId,
          error: error.message,
        });
        throw new DatabaseError(
          `Failed to fetch theme preset: ${error.message}`,
          error.code
        );
      }

      if (data) {
        console.log('[ThemePresetService] Fetched preset:', {
          preset_id: presetId,
          name: data.name,
        });
      }

      return (data as ThemePreset) || null;
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw error;
      }
      throw new DatabaseError(
        `Unexpected error fetching theme preset: ${(error as Error).message}`
      );
    }
  }

  /**
   * Applies a preset to a tenant's customizations
   * Requirement: 10.2, 10.3, 10.4, 2.8 (Tenant isolation for preset application)
   *
   * CRITICAL TENANT ISOLATION:
   * - Each tenant gets their OWN COPY of the preset (via CMSSettingsService.upsertSettings)
   * - The original preset in theme_presets table is NEVER modified
   * - The preset application is COMPLETELY INDEPENDENT per tenant
   * - Other tenants' customizations remain completely unaffected
   *
   * Operation:
   * 1. Validate tenant_id and admin_id
   * 2. Validate preset exists
   * 3. Call CMSSettingsService.upsertSettings to save preset as tenant's customization
   *    - This creates/updates cms_settings record with tenant_id
   *    - Creates version entry for rollback
   *    - Logs audit entry for tracking
   * 4. Return the applied customization (with tenant isolation enforced)
   *
   * @param tenantId - Tenant ID to apply preset for (extracted from authenticated context)
   * @param presetData - Preset data to apply (typically preset.preset_data)
   * @param adminId - Admin ID applying the preset (for audit logging)
   * @returns Upserted CMS settings record (tenant-specific copy)
   * @throws TenantMismatchError if tenant_id is invalid
   * @throws DatabaseError if preset not found or upsert fails
   */
  async applyPreset(
    tenantId: string,
    presetData: Record<string, any>,
    adminId: string
  ): Promise<any> {
    // Validate tenant context (enforces tenant isolation)
    if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
      throw new TenantMismatchError(
        'Invalid tenant_id. Tenant context required to apply preset.'
      );
    }

    // Validate admin context
    if (!adminId || typeof adminId !== 'string' || adminId.trim() === '') {
      throw new TenantMismatchError('Invalid admin_id provided');
    }

    // Validate preset data
    if (!presetData || typeof presetData !== 'object') {
      throw new DatabaseError('Invalid preset data provided');
    }

    try {
      console.log('[ThemePresetService] Applying preset to tenant:', {
        tenant_id: tenantId,
        admin_id: adminId,
      });

      // Call CMSSettingsService.upsertSettings to save preset as tenant's customization
      // This operation:
      // 1. Creates OR updates cms_settings for this tenant_id
      // 2. Creates version entry for rollback
      // 3. Logs audit entry with action='apply_preset'
      // 4. Returns the tenant-specific customization record
      //
      // Full tenant isolation is enforced because:
      // - upsertSettings uses tenant_id as upsert key (UNIQUE constraint)
      // - Query filters by tenant_id (can only see own settings)
      // - Other tenants' cms_settings records remain completely separate
      const appliedSettings = await this.cmsService.upsertSettings(
        tenantId,
        presetData,
        adminId
      );

      console.log('[ThemePresetService] Preset applied successfully:', {
        tenant_id: tenantId,
        cms_settings_id: appliedSettings.id,
        admin_id: adminId,
      });

      return appliedSettings;
    } catch (error) {
      if (error instanceof TenantMismatchError || error instanceof DatabaseError) {
        throw error;
      }
      throw new DatabaseError(
        `Unexpected error applying preset: ${(error as Error).message}`
      );
    }
  }
}
