import { CMSSettingsService, TenantMismatchError } from './CMSSettingsService';
import { DatabaseError } from '@/lib/db';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * Export format for CMS settings
 * Version 1.0 includes metadata and settings
 */
export interface CMSSettingsExport {
  version: '1.0';
  exportedAt: string;
  exportedBy: string;
  metadata: {
    name: string;
    description?: string;
  };
  settings: Record<string, any>;
}

/**
 * Import validation result
 */
export interface ImportValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * ExportImportService
 *
 * Handles configuration export and import operations with validation and merge strategies.
 * Reuses CMSSettingsService for validation and merge logic.
 *
 * Requirements Addressed:
 * - 11.1 (Theme Export and Import - generate JSON export)
 * - 11.2 (Theme Export and Import - export includes metadata)
 * - 11.3 (Theme Export and Import - import validation)
 * - 11.4 (Theme Export and Import - validate file format and structure)
 * - 11.5 (Theme Export and Import - offer merge strategy)
 * - 11.6 (Theme Export and Import - load imported customizations)
 */
export class ExportImportService {
  private cmsService: CMSSettingsService;
  private readonly TABLE_AUDIT = 'cms_audit_log';

  constructor(cmsService?: CMSSettingsService) {
    this.cmsService = cmsService || new CMSSettingsService();
  }

  /**
   * Exports current CMS settings to JSON format with metadata
   * Requirement: 11.1, 11.2
   *
   * Export format includes:
   * - version: "1.0" (for compatibility checking on import)
   * - exportedAt: ISO timestamp
   * - exportedBy: admin_id of who performed export
   * - metadata: name and description
   * - settings: the actual customization JSONB data
   *
   * @param tenantId - Tenant ID to export settings for
   * @param adminId - Admin ID performing the export (for audit)
   * @returns Export object with version, metadata, and settings
   * @throws TenantMismatchError if tenant_id is missing or invalid
   * @throws DatabaseError if settings fetch fails
   */
  async exportSettings(tenantId: string, adminId: string): Promise<CMSSettingsExport> {
    if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
      throw new TenantMismatchError(
        'Missing or invalid tenant_id. Tenant context required for export.'
      );
    }

    if (!adminId || typeof adminId !== 'string') {
      throw new DatabaseError('Invalid admin_id provided');
    }

    try {
      // Fetch current settings
      const settings = await this.cmsService.getSettingsByTenantId(tenantId);

      if (!settings) {
        throw new DatabaseError('No customizations found to export');
      }

      // Log export action for audit trail
      await this.logExportAction(tenantId, adminId);

      // Generate export object
      const exportData: CMSSettingsExport = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        exportedBy: adminId,
        metadata: {
          name: `Export_${new Date().toISOString().split('T')[0]}`,
          description: 'CMS Settings Export',
        },
        settings: settings.settings_data,
      };

      console.log('[ExportImportService] Settings exported:', {
        tenant_id: tenantId,
        admin_id: adminId,
        exported_at: exportData.exportedAt,
      });

      return exportData;
    } catch (error) {
      if (error instanceof TenantMismatchError || error instanceof DatabaseError) {
        throw error;
      }
      throw new DatabaseError(
        `Unexpected error exporting settings: ${(error as Error).message}`
      );
    }
  }

  /**
   * Validates import file structure and metadata
   * Requirement: 11.3, 11.4
   *
   * Validates:
   * - Import data is a valid object
   * - version field equals "1.0"
   * - settings object exists and is valid
   * - settings object matches expected schema
   *
   * Reuses CMSSettingsService.validateImportFile() for file structure validation
   *
   * @param importData - Import data object to validate
   * @returns Validation result with valid flag and errors array
   */
  validateImportFile(importData: any): ImportValidationResult {
    const errors: string[] = [];

    // Use CMSSettingsService validation (already handles structure validation)
    const baseValidation = this.cmsService.validateImportFile(importData);

    if (!baseValidation.valid) {
      return baseValidation;
    }

    // Additional version check
    if (!importData.version) {
      errors.push('Import data must include version field');
    } else if (importData.version !== '1.0') {
      errors.push(`Invalid export version. Expected 1.0, got ${importData.version}`);
    }

    // Check for metadata (optional but recommended)
    if (importData.metadata && typeof importData.metadata !== 'object') {
      errors.push('Metadata must be an object');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Merges settings using specified strategy
   * Requirement: 11.5 (Support merge strategies: 'overwrite' and 'merge')
   *
   * Reuses CMSSettingsService.mergeSettings() for actual merge logic
   *
   * Merge Strategies:
   * - 'overwrite': Replace entire settings with imported data
   * - 'merge': Deep merge imported settings into current settings, preserving unmodified fields
   *
   * @param current - Current settings
   * @param imported - Imported settings
   * @param strategy - Merge strategy ('overwrite' or 'merge')
   * @returns Merged settings
   */
  mergeSettings(
    current: Record<string, any>,
    imported: Record<string, any>,
    strategy: 'overwrite' | 'merge' = 'overwrite'
  ): Record<string, any> {
    return this.cmsService.mergeSettings(current, imported, strategy);
  }

  /**
   * Imports settings from export file with validation and merge
   * Requirement: 11.3, 11.4, 11.5, 11.6
   *
   * Operation:
   * 1. Validate import file format
   * 2. Fetch current settings (if any)
   * 3. Apply merge strategy (overwrite or merge)
   * 4. Validate merged settings
   * 5. Save via CMSSettingsService
   * 6. Log import action for audit
   *
   * @param tenantId - Tenant ID to import settings for
   * @param importData - Import data object with settings
   * @param mergeStrategy - Merge strategy ('overwrite' or 'merge'), default 'overwrite'
   * @param adminId - Admin ID performing the import (for audit)
   * @returns Saved settings result
   * @throws TenantMismatchError if tenant_id is missing or invalid
   * @throws DatabaseError if validation or import fails
   */
  async importSettings(
    tenantId: string,
    importData: any,
    mergeStrategy: 'overwrite' | 'merge' = 'overwrite',
    adminId: string
  ): Promise<any> {
    if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
      throw new TenantMismatchError(
        'Missing or invalid tenant_id. Tenant context required for import.'
      );
    }

    if (!adminId || typeof adminId !== 'string') {
      throw new DatabaseError('Invalid admin_id provided');
    }

    if (mergeStrategy !== 'overwrite' && mergeStrategy !== 'merge') {
      throw new DatabaseError(
        `Invalid merge strategy: ${mergeStrategy}. Must be 'overwrite' or 'merge'.`
      );
    }

    try {
      // Step 1: Validate import file
      const validation = this.validateImportFile(importData);
      if (!validation.valid) {
        throw new DatabaseError(
          `Import validation failed: ${validation.errors.join(', ')}`
        );
      }

      // Step 2: Extract settings from import data
      const importedSettings = importData.settings;

      // Step 3: Determine final settings based on merge strategy
      let finalSettings = importedSettings;

      if (mergeStrategy === 'merge') {
        // Fetch current settings to merge with
        const currentSettings = await this.cmsService.getSettingsByTenantId(tenantId);

        if (currentSettings) {
          // Deep merge imported settings into current settings
          finalSettings = this.mergeSettings(
            currentSettings.settings_data,
            importedSettings,
            'merge'
          );
        }
        // If no current settings, use imported settings as-is
      }
      // For 'overwrite' strategy, finalSettings is already set to importedSettings

      // Step 4: Validate merged/final settings
      const settingsValidationErrors =
        this.cmsService.validateSettings(finalSettings);
      if (settingsValidationErrors.length > 0) {
        throw new DatabaseError(
          `Validation failed after merge: ${settingsValidationErrors.join(', ')}`
        );
      }

      // Step 5: Save settings via CMSSettingsService
      const result = await this.cmsService.upsertSettings(
        tenantId,
        finalSettings,
        adminId
      );

      // Step 6: Log import action for audit
      await this.logImportAction(tenantId, adminId, mergeStrategy, importData.metadata);

      console.log('[ExportImportService] Settings imported successfully:', {
        tenant_id: tenantId,
        admin_id: adminId,
        merge_strategy: mergeStrategy,
      });

      return result;
    } catch (error) {
      if (error instanceof TenantMismatchError || error instanceof DatabaseError) {
        throw error;
      }
      throw new DatabaseError(
        `Unexpected error importing settings: ${(error as Error).message}`
      );
    }
  }

  /**
   * Logs export action to audit trail
   * (Private helper for audit logging)
   *
   * @param tenantId - Tenant ID
   * @param adminId - Admin ID performing export
   */
  private async logExportAction(tenantId: string, adminId: string): Promise<void> {
    try {
      await supabaseAdmin.from(this.TABLE_AUDIT).insert({
        tenant_id: tenantId,
        admin_id: adminId,
        action: 'export',
        resource_type: 'cms_settings',
        resource_id: null,
        changes: null,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Silently log audit failure - don't block the operation
      console.error(
        '[ExportImportService] Failed to log export action:',
        (error as Error).message
      );
    }
  }

  /**
   * Logs import action to audit trail
   * (Private helper for audit logging)
   *
   * @param tenantId - Tenant ID
   * @param adminId - Admin ID performing import
   * @param mergeStrategy - Merge strategy used
   * @param metadata - Import metadata (name, description)
   */
  private async logImportAction(
    tenantId: string,
    adminId: string,
    mergeStrategy: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      await supabaseAdmin.from(this.TABLE_AUDIT).insert({
        tenant_id: tenantId,
        admin_id: adminId,
        action: 'import',
        resource_type: 'cms_settings',
        resource_id: null,
        changes: {
          mergeStrategy,
          importedFrom: metadata?.name || 'unknown',
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Silently log audit failure - don't block the operation
      console.error(
        '[ExportImportService] Failed to log import action:',
        (error as Error).message
      );
    }
  }
}
