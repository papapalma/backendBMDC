import { supabaseAdmin } from '@/lib/supabase-admin';
import { DatabaseError } from '@/lib/db';

/**
 * Custom error class for tenant isolation violations
 * Thrown when a query is missing tenant_id filter or mismatches
 */
export class TenantMismatchError extends Error {
  public statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name = 'TenantMismatchError';
  }
}

/**
 * Default CMS settings structure for new tenants
 */
const DEFAULT_SETTINGS = {
  colors: {
    primary: '#3B82F6',
    secondary: '#10B981',
    accent: '#F59E0B',
    background: '#FFFFFF',
    text: '#1F2937',
    borders: '#E5E7EB',
  },
  typography: {
    headings: {
      fontFamily: 'Poppins',
      fontSize: { h1: 48, h2: 36, h3: 28 },
      fontWeight: 700,
      lineHeight: 1.2,
    },
    body: {
      fontFamily: 'Inter',
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 1.5,
    },
  },
  layout: {
    containerWidth: '1200px',
    containerLayout: 'centered',
    padding: { heroSection: 40, contentAreas: 32, footer: 24 },
    margins: { sectionSpacing: 48, elementSpacing: 16 },
    gaps: { grid: 24, flex: 16 },
  },
  components: {
    navigation: { enabled: true, style: 'light' },
    hero: {
      enabled: true,
      backgroundImage: 'url(...)',
      overlayColor: 'rgba(0,0,0,0.3)',
      height: '500px',
    },
    features: { enabled: true, layout: 'grid', columns: 3 },
    testimonials: { enabled: true, displayCount: 3 },
    ctaSection: { enabled: true, style: 'button' },
    contact: { enabled: true, formFields: ['email', 'phone', 'message'] },
    footer: { enabled: true, linkColumns: 4 },
  },
  content: {
    hero: {
      heading: 'Welcome to Our Platform',
      subheading: 'Build amazing things',
      ctaText: 'Get Started',
    },
    missionVision: {
      title: 'Our Mission',
      description: 'To empower businesses...',
      vision: 'To be the leading...',
    },
    features: [
      { title: 'Feature 1', description: 'Description...', icon: 'icon-name' },
    ],
    testimonials: [
      { text: 'Great product!', author: 'John Doe', image: 'url(...)' },
    ],
    contact: {
      email: 'contact@example.com',
      phone: '+1-555-000-0000',
      address: '123 Main St',
      socialLinks: {
        twitter: 'https://twitter.com/...',
        linkedin: 'https://linkedin.com/...',
      },
    },
  },
};

/**
 * Interface for CMS Settings record from database
 */
export interface CMSSettings {
  id: string;
  tenant_id: string;
  settings_data: Record<string, any>;
  created_at: string;
  updated_at: string;
  updated_by_admin_id: string | null;
}

/**
 * Interface for CMS Settings Version record
 */
export interface CMSSettingsVersion {
  id: string;
  cms_settings_id: string;
  tenant_id: string;
  settings_data: Record<string, any>;
  version_number: number;
  change_summary: string | null;
  created_at: string;
  created_by_admin_id: string | null;
}

/**
 * Interface for Audit Log entry
 */
export interface AuditLogEntry {
  id: string;
  tenant_id: string;
  admin_id: string | null;
  action: 'create' | 'update' | 'delete' | 'import' | 'rollback' | 'apply_preset' | 'export';
  resource_type: string;
  resource_id: string | null;
  changes: Record<string, any> | null;
  error_message: string | null;
  ip_address: string | null;
  user_agent: string | null;
  timestamp: string;
}

/**
 * CMSSettingsService
 *
 * Handles all database operations for CMS customization settings with strict tenant isolation.
 * Every query MUST include tenant_id filter to ensure data isolation.
 *
 * Requirements Addressed:
 * - 2.1 (Multi-tenant Architecture with data isolation)
 * - 2.3 (Database schema and queries)
 * - 2.11 (Audit logging)
 * - 8.1 (Database storage of customizations)
 * - 13.1 (Version history tracking)
 * - 13.3 (Rollback functionality)
 * - 15.1 (Audit trail for compliance)
 */
export class CMSSettingsService {
  private readonly TABLE_SETTINGS = 'cms_settings';
  private readonly TABLE_VERSIONS = 'cms_settings_versions';
  private readonly TABLE_AUDIT = 'cms_audit_log';

  /**
   * Throws TenantMismatchError if tenant_id is missing or mismatches
   * Used to ensure all queries include tenant filtering
   */
  private validateTenantId(tenantId: string | null | undefined): void {
    if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
      throw new TenantMismatchError(
        'Missing or invalid tenant_id. Tenant context required for all operations.'
      );
    }
  }

  /**
   * Returns default CMS settings for a tenant (used when no customization exists)
   * Requirement: 8.1 (Default settings)
   *
   * @returns Default settings object with all customization options
   */
  getDefaultSettings(): Record<string, any> {
    return DEFAULT_SETTINGS;
  }

  /**
   * Fetches current customization settings for a tenant
   * Requirement: 2.1, 2.3, 8.1, 9.1
   *
   * CRITICAL: Query includes tenant_id filter to ensure isolation
   *
   * @param tenantId - Tenant ID to fetch settings for
   * @returns CMS settings object or null if no customization exists
   * @throws TenantMismatchError if tenant_id is missing
   * @throws DatabaseError if query fails
   */
  async getSettingsByTenantId(tenantId: string): Promise<CMSSettings | null> {
    this.validateTenantId(tenantId);

    try {
      const { data, error } = await supabaseAdmin
        .from(this.TABLE_SETTINGS)
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error) {
        console.error('[CMSSettingsService] Error fetching settings:', {
          tenant_id: tenantId,
          error: error.message,
        });
        throw new DatabaseError(
          `Failed to fetch CMS settings: ${error.message}`,
          error.code
        );
      }

      return data as CMSSettings | null;
    } catch (error) {
      if (error instanceof TenantMismatchError || error instanceof DatabaseError) {
        throw error;
      }
      throw new DatabaseError(
        `Unexpected error fetching CMS settings: ${(error as Error).message}`
      );
    }
  }

  /**
   * Creates or updates CMS settings for a tenant, with version tracking and audit logging
   * Requirement: 2.1, 2.3, 8.1, 13.1, 15.1
   *
   * CRITICAL: Uses tenant_id as upsert key for isolation
   *
   * Operation:
   * 1. Fetch current settings (if any)
   * 2. Validate input settings
   * 3. Upsert cms_settings record
   * 4. Create version entry (for rollback)
   * 5. Log audit entry
   *
   * @param tenantId - Tenant ID to save settings for
   * @param settingsData - Customization data to save
   * @param adminId - Admin ID performing the update (for audit)
   * @returns Updated CMS settings record
   * @throws TenantMismatchError if tenant_id is missing
   * @throws DatabaseError if any database operation fails
   */
  async upsertSettings(
    tenantId: string,
    settingsData: Record<string, any>,
    adminId: string
  ): Promise<CMSSettings> {
    this.validateTenantId(tenantId);

    if (!adminId || typeof adminId !== 'string') {
      throw new TenantMismatchError('Invalid admin_id provided');
    }

    try {
      // Step 1: Fetch current settings to determine if this is create or update
      const currentSettings = await this.getSettingsByTenantId(tenantId);
      const isCreate = !currentSettings;

      // Step 2: Upsert settings (INSERT or UPDATE)
      const { data: upsertedSettings, error: upsertError } = await supabaseAdmin
        .from(this.TABLE_SETTINGS)
        .upsert(
          {
            tenant_id: tenantId,
            settings_data: settingsData,
            updated_by_admin_id: adminId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id' }
        )
        .select()
        .single();

      if (upsertError) {
        console.error('[CMSSettingsService] Error upserting settings:', {
          tenant_id: tenantId,
          error: upsertError.message,
        });
        throw new DatabaseError(
          `Failed to save CMS settings: ${upsertError.message}`,
          upsertError.code
        );
      }

      if (!upsertedSettings) {
        throw new DatabaseError('Upsert returned no data');
      }

      // Step 3: Create version entry for tracking and rollback
      await this.createVersion(
        tenantId,
        upsertedSettings.id,
        settingsData,
        isCreate ? 1 : (currentSettings?.id ? undefined : 1),
        adminId,
        isCreate ? 'Initial settings created' : 'Settings updated'
      );

      // Step 4: Log audit entry
      await this.logAuditEntry(
        tenantId,
        adminId,
        isCreate ? 'create' : 'update',
        'cms_settings',
        upsertedSettings.id,
        isCreate
          ? { created: true, settings: settingsData }
          : { before: currentSettings?.settings_data, after: settingsData }
      );

      console.log('[CMSSettingsService] Settings saved:', {
        tenant_id: tenantId,
        operation: isCreate ? 'create' : 'update',
        admin_id: adminId,
      });

      return upsertedSettings as CMSSettings;
    } catch (error) {
      if (error instanceof TenantMismatchError || error instanceof DatabaseError) {
        throw error;
      }
      throw new DatabaseError(
        `Unexpected error upserting CMS settings: ${(error as Error).message}`
      );
    }
  }

  /**
   * Fetches version history for a tenant's settings with pagination
   * Requirement: 2.1, 2.3, 13.1, 13.3
   *
   * CRITICAL: Query includes tenant_id filter to ensure isolation
   *
   * @param tenantId - Tenant ID to fetch versions for
   * @param limit - Number of records to return (default 10)
   * @param offset - Number of records to skip (default 0)
   * @returns Array of version records sorted by most recent first
   * @throws TenantMismatchError if tenant_id is missing
   * @throws DatabaseError if query fails
   */
  async getVersionHistory(
    tenantId: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<CMSSettingsVersion[]> {
    this.validateTenantId(tenantId);

    if (limit < 1 || limit > 1000) {
      throw new DatabaseError('Limit must be between 1 and 1000');
    }

    if (offset < 0) {
      throw new DatabaseError('Offset cannot be negative');
    }

    try {
      const { data, error } = await supabaseAdmin
        .from(this.TABLE_VERSIONS)
        .select('*')
        .eq('tenant_id', tenantId)
        .order('version_number', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('[CMSSettingsService] Error fetching version history:', {
          tenant_id: tenantId,
          error: error.message,
        });
        throw new DatabaseError(
          `Failed to fetch version history: ${error.message}`,
          error.code
        );
      }

      return data as CMSSettingsVersion[];
    } catch (error) {
      if (error instanceof TenantMismatchError || error instanceof DatabaseError) {
        throw error;
      }
      throw new DatabaseError(
        `Unexpected error fetching version history: ${(error as Error).message}`
      );
    }
  }

  /**
   * Fetches a specific version by ID (with tenant validation)
   * Requirement: 2.1, 2.3, 13.1
   *
   * CRITICAL: Query includes tenant_id filter to ensure isolation
   *
   * @param versionId - Version ID to fetch
   * @param tenantId - Tenant ID to validate ownership
   * @returns Version record or null if not found
   * @throws TenantMismatchError if tenant_id is missing or mismatches
   * @throws DatabaseError if query fails
   */
  async getVersionById(
    versionId: string,
    tenantId: string
  ): Promise<CMSSettingsVersion | null> {
    this.validateTenantId(tenantId);

    if (!versionId || typeof versionId !== 'string') {
      throw new DatabaseError('Invalid version_id provided');
    }

    try {
      const { data, error } = await supabaseAdmin
        .from(this.TABLE_VERSIONS)
        .select('*')
        .eq('id', versionId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error) {
        console.error('[CMSSettingsService] Error fetching version:', {
          version_id: versionId,
          tenant_id: tenantId,
          error: error.message,
        });
        throw new DatabaseError(
          `Failed to fetch version: ${error.message}`,
          error.code
        );
      }

      // Security check: If version exists but tenant_id doesn't match, throw error
      if (data && data.tenant_id !== tenantId) {
        throw new TenantMismatchError(
          'Version belongs to different tenant. Access denied.'
        );
      }

      return data as CMSSettingsVersion | null;
    } catch (error) {
      if (error instanceof TenantMismatchError || error instanceof DatabaseError) {
        throw error;
      }
      throw new DatabaseError(
        `Unexpected error fetching version: ${(error as Error).message}`
      );
    }
  }

  /**
   * Rolls back CMS settings to a previous version
   * Requirement: 2.1, 2.3, 13.1, 13.3, 15.1
   *
   * CRITICAL: Validates version ownership before rollback
   *
   * Operation:
   * 1. Fetch the target version (with tenant validation)
   * 2. Update cms_settings with version's settings_data
   * 3. Create new version entry (for audit trail)
   * 4. Log audit entry with rollback action
   *
   * @param tenantId - Tenant ID to roll back settings for
   * @param versionId - Version ID to roll back to
   * @param adminId - Admin ID performing the rollback (for audit)
   * @returns Updated CMS settings record
   * @throws TenantMismatchError if tenant_id is missing or version mismatches
   * @throws DatabaseError if version not found or database operation fails
   */
  async rollbackToVersion(
    tenantId: string,
    versionId: string,
    adminId: string
  ): Promise<CMSSettings> {
    this.validateTenantId(tenantId);

    if (!adminId || typeof adminId !== 'string') {
      throw new TenantMismatchError('Invalid admin_id provided');
    }

    try {
      // Step 1: Fetch target version (with tenant validation)
      const targetVersion = await this.getVersionById(versionId, tenantId);

      if (!targetVersion) {
        throw new DatabaseError('Version not found or does not belong to this tenant');
      }

      // Step 2: Fetch current settings to get cms_settings_id
      const currentSettings = await this.getSettingsByTenantId(tenantId);

      if (!currentSettings) {
        throw new DatabaseError('CMS settings not found for tenant');
      }

      // Step 3: Update cms_settings with rolled-back settings_data
      const { data: rolledBackSettings, error: updateError } = await supabaseAdmin
        .from(this.TABLE_SETTINGS)
        .update({
          settings_data: targetVersion.settings_data,
          updated_by_admin_id: adminId,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId)
        .select()
        .single();

      if (updateError) {
        console.error('[CMSSettingsService] Error rolling back settings:', {
          tenant_id: tenantId,
          version_id: versionId,
          error: updateError.message,
        });
        throw new DatabaseError(
          `Failed to rollback settings: ${updateError.message}`,
          updateError.code
        );
      }

      if (!rolledBackSettings) {
        throw new DatabaseError('Rollback returned no data');
      }

      // Step 4: Create new version entry documenting the rollback
      await this.createVersion(
        tenantId,
        currentSettings.id,
        targetVersion.settings_data,
        undefined, // Auto-increment version number
        adminId,
        `Rolled back to version ${targetVersion.version_number}`
      );

      // Step 5: Log audit entry
      await this.logAuditEntry(
        tenantId,
        adminId,
        'rollback',
        'cms_settings',
        currentSettings.id,
        {
          rolledBackToVersionId: versionId,
          rolledBackToVersionNumber: targetVersion.version_number,
          before: currentSettings.settings_data,
          after: targetVersion.settings_data,
        }
      );

      console.log('[CMSSettingsService] Settings rolled back:', {
        tenant_id: tenantId,
        version_id: versionId,
        admin_id: adminId,
      });

      return rolledBackSettings as CMSSettings;
    } catch (error) {
      if (error instanceof TenantMismatchError || error instanceof DatabaseError) {
        throw error;
      }
      throw new DatabaseError(
        `Unexpected error rolling back settings: ${(error as Error).message}`
      );
    }
  }

  /**
   * Creates a version entry in cms_settings_versions for tracking
   * Requirement: 13.1 (Version history tracking)
   *
   * CRITICAL: Query includes tenant_id filter to ensure isolation
   *
   * Version numbers auto-increment per cms_settings_id to track sequence
   *
   * @param tenantId - Tenant ID (for isolation filter)
   * @param cmsSettingsId - CMS settings ID this version belongs to
   * @param settingsData - Settings snapshot for this version
   * @param versionNumber - Explicit version number (or undefined to auto-increment)
   * @param adminId - Admin ID creating the version
   * @param changeSummary - Human-readable description of changes
   * @throws DatabaseError if insert fails
   */
  private async createVersion(
    tenantId: string,
    cmsSettingsId: string,
    settingsData: Record<string, any>,
    versionNumber?: number,
    adminId?: string,
    changeSummary?: string
  ): Promise<void> {
    try {
      // Determine version number if not provided
      let nextVersionNumber = versionNumber;

      if (!nextVersionNumber) {
        const { data: lastVersion, error: queryError } = await supabaseAdmin
          .from(this.TABLE_VERSIONS)
          .select('version_number')
          .eq('cms_settings_id', cmsSettingsId)
          .eq('tenant_id', tenantId)
          .order('version_number', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (queryError && queryError.code !== 'PGRST116') {
          throw queryError;
        }

        nextVersionNumber = (lastVersion?.version_number || 0) + 1;
      }

      const { error: insertError } = await supabaseAdmin
        .from(this.TABLE_VERSIONS)
        .insert({
          cms_settings_id: cmsSettingsId,
          tenant_id: tenantId,
          settings_data: settingsData,
          version_number: nextVersionNumber,
          change_summary: changeSummary || null,
          created_by_admin_id: adminId || null,
        });

      if (insertError) {
        console.error('[CMSSettingsService] Error creating version:', {
          cms_settings_id: cmsSettingsId,
          tenant_id: tenantId,
          error: insertError.message,
        });
        throw new DatabaseError(
          `Failed to create version: ${insertError.message}`,
          insertError.code
        );
      }

      console.log('[CMSSettingsService] Version created:', {
        cms_settings_id: cmsSettingsId,
        tenant_id: tenantId,
        version_number: nextVersionNumber,
      });
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw error;
      }
      throw new DatabaseError(
        `Unexpected error creating version: ${(error as Error).message}`
      );
    }
  }

  /**
   * Logs an audit entry for compliance and troubleshooting
   * Requirement: 15.1 (Audit trail for compliance)
   *
   * CRITICAL: Query includes tenant_id filter to ensure isolation
   *
   * Audit entries track: create, update, delete, import, rollback, apply_preset, export
   *
   * @param tenantId - Tenant ID (for isolation)
   * @param adminId - Admin ID performing the action
   * @param action - Type of action performed
   * @param resourceType - Type of resource (e.g., 'cms_settings')
   * @param resourceId - ID of resource being modified
   * @param changes - Change details (before/after, etc.)
   * @throws DatabaseError if insert fails (logged but doesn't fail the operation)
   */
  private async logAuditEntry(
    tenantId: string,
    adminId: string,
    action: string,
    resourceType: string,
    resourceId: string | null,
    changes?: Record<string, any>
  ): Promise<void> {
    try {
      // TODO: Extract IP address and user agent from request context when available
      const { error: insertError } = await supabaseAdmin
        .from(this.TABLE_AUDIT)
        .insert({
          tenant_id: tenantId,
          admin_id: adminId || null,
          action,
          resource_type: resourceType,
          resource_id: resourceId,
          changes: changes || null,
          timestamp: new Date().toISOString(),
        });

      if (insertError) {
        // Log error but don't throw - audit failures shouldn't block operations
        console.error('[CMSSettingsService] Error logging audit entry:', {
          tenant_id: tenantId,
          action,
          error: insertError.message,
        });
      }
    } catch (error) {
      // Silently catch - audit logging failures shouldn't break the operation
      console.error(
        '[CMSSettingsService] Unexpected error logging audit entry:',
        (error as Error).message
      );
    }
  }

  /**
   * Validates CMS settings structure against expected schema
   * Requirement: 2.3 (Validation)
   *
   * @param settings - Settings object to validate
   * @returns Array of validation errors (empty if valid)
   */
  validateSettings(settings: Record<string, any>): string[] {
    const errors: string[] = [];

    if (!settings || typeof settings !== 'object') {
      errors.push('Settings must be a valid object');
      return errors;
    }

    // Validate colors section
    if (settings.colors) {
      if (typeof settings.colors !== 'object') {
        errors.push('Colors must be an object');
      }
    }

    // Validate typography section
    if (settings.typography) {
      if (typeof settings.typography !== 'object') {
        errors.push('Typography must be an object');
      }
    }

    // Validate layout section
    if (settings.layout) {
      if (typeof settings.layout !== 'object') {
        errors.push('Layout must be an object');
      }
    }

    // Validate components section
    if (settings.components) {
      if (typeof settings.components !== 'object') {
        errors.push('Components must be an object');
      }
    }

    // Validate content section
    if (settings.content) {
      if (typeof settings.content !== 'object') {
        errors.push('Content must be an object');
      }
    }

    return errors;
  }

  /**
   * Merges settings with merge strategy (for imports)
   * Requirement: 11.2 (Import with merge strategy)
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
    if (strategy === 'overwrite') {
      return imported;
    }

    // Deep merge strategy
    return this.deepMerge(current, imported);
  }

  /**
   * Recursively merges two objects (for settings merge)
   *
   * @param target - Target object to merge into
   * @param source - Source object to merge from
   * @returns Merged object
   */
  private deepMerge(
    target: Record<string, any>,
    source: Record<string, any>
  ): Record<string, any> {
    const result = { ...target };

    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const sourceValue = source[key];
        const targetValue = result[key];

        if (
          sourceValue &&
          typeof sourceValue === 'object' &&
          !Array.isArray(sourceValue) &&
          targetValue &&
          typeof targetValue === 'object' &&
          !Array.isArray(targetValue)
        ) {
          result[key] = this.deepMerge(targetValue, sourceValue);
        } else {
          result[key] = sourceValue;
        }
      }
    }

    return result;
  }

  /**
   * Validates import file structure and metadata
   * Requirement: 11.2 (Import validation)
   *
   * @param importData - Import data object to validate
   * @returns Validation result with valid flag and errors array
   */
  validateImportFile(importData: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!importData || typeof importData !== 'object') {
      errors.push('Import data must be a valid object');
      return { valid: false, errors };
    }

    if (!importData.settings || typeof importData.settings !== 'object') {
      errors.push('Import data must contain settings object');
    }

    if (importData.version && importData.version !== '1.0') {
      errors.push('Import version must be 1.0');
    }

    const settingsErrors = this.validateSettings(importData.settings);
    if (settingsErrors.length > 0) {
      errors.push(...settingsErrors);
    }

    return { valid: errors.length === 0, errors };
  }
}
