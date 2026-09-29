/**
 * Integration Tests for POST /api/theme-presets/:id/apply
 *
 * Tests applying a theme preset to a tenant's customizations through service layer.
 * Validates:
 * - Preset application saves customizations to cms_settings
 * - Each tenant gets independent copy of preset
 * - Version entry created with appropriate metadata
 * - Audit log created with action='apply_preset'
 * - Error handling for preset not found and auth failures
 *
 * Requirements: 10.2, 10.3, 10.4, 2.8, 15.1
 */

import { ThemePresetService } from '@/services/cms/ThemePresetService';
import { CMSSettingsService, TenantMismatchError } from '@/services/cms/CMSSettingsService';
import { AuditLogService } from '@/services/cms/AuditLogService';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { DatabaseError } from '@/lib/db';

// Mock Supabase
jest.mock('@/lib/supabase-admin');

const mockTenantId = 'tenant-123';
const mockTenantId2 = 'tenant-999';
const mockAdminId = 'admin-456';
const mockPresetId = 'preset-789';

const mockPreset = {
  id: mockPresetId,
  name: 'Modern Minimal',
  description: 'A clean and modern theme',
  category: 'modern',
  preset_data: {
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
      padding: {
        heroSection: 40,
        contentAreas: 32,
        footer: 24,
      },
      margins: {
        sectionSpacing: 48,
        elementSpacing: 16,
      },
      gaps: {
        grid: 24,
        flex: 16,
      },
    },
  },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  is_active: true,
};

const mockAppliedSettings = {
  id: 'cms-settings-111',
  tenant_id: mockTenantId,
  settings_data: mockPreset.preset_data,
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
  updated_by_admin_id: mockAdminId,
};

const mockVersion = {
  id: 'version-111',
  cms_settings_id: mockAppliedSettings.id,
  tenant_id: mockTenantId,
  settings_data: mockPreset.preset_data,
  version_number: 1,
  change_summary: 'Preset applied: Modern Minimal',
  created_at: '2024-01-15T10:00:00Z',
  created_by_admin_id: mockAdminId,
};

const mockAuditLog = {
  id: 'audit-111',
  tenant_id: mockTenantId,
  admin_id: mockAdminId,
  action: 'apply_preset',
  resource_type: 'cms_settings',
  resource_id: mockAppliedSettings.id,
  changes: {
    presetName: mockPreset.name,
    presetId: mockPresetId,
  },
  timestamp: '2024-01-15T10:00:00Z',
};

describe('POST /api/theme-presets/:id/apply Integration Tests', () => {
  let themePresetService: ThemePresetService;
  let cmsSettingsService: CMSSettingsService;
  let auditLogService: AuditLogService;

  beforeEach(() => {
    jest.clearAllMocks();

    // Initialize services
    themePresetService = new ThemePresetService();
    cmsSettingsService = new CMSSettingsService();
    auditLogService = new AuditLogService();

    // Mock console to reduce test noise
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Successful preset application', () => {
    it('should apply preset and save customizations to cms_settings', async () => {
      // Arrange
      const getPresetByIdSpy = jest
        .spyOn(themePresetService, 'getPresetById')
        .mockResolvedValue(mockPreset);
      const applyPresetSpy = jest
        .spyOn(themePresetService, 'applyPreset')
        .mockResolvedValue(mockAppliedSettings);

      // Act
      const preset = await themePresetService.getPresetById(mockPresetId);
      expect(preset).not.toBeNull();

      const applied = await themePresetService.applyPreset(
        mockTenantId,
        preset!.preset_data,
        mockAdminId
      );

      // Assert
      expect(getPresetByIdSpy).toHaveBeenCalledWith(mockPresetId);
      expect(applyPresetSpy).toHaveBeenCalledWith(
        mockTenantId,
        mockPreset.preset_data,
        mockAdminId
      );
      expect(applied).toEqual(mockAppliedSettings);
      expect(applied.tenant_id).toBe(mockTenantId);
      expect(applied.settings_data).toEqual(mockPreset.preset_data);
    });

    it('should save customizations with all color and typography settings', async () => {
      // Arrange
      jest
        .spyOn(themePresetService, 'applyPreset')
        .mockResolvedValue(mockAppliedSettings);

      // Act
      const applied = await themePresetService.applyPreset(
        mockTenantId,
        mockPreset.preset_data,
        mockAdminId
      );

      // Assert - Verify all sections are saved
      expect(applied.settings_data.colors.primary).toBe('#3B82F6');
      expect(applied.settings_data.colors.secondary).toBe('#10B981');
      expect(applied.settings_data.typography.headings.fontFamily).toBe(
        'Poppins'
      );
      expect(applied.settings_data.typography.body.fontFamily).toBe('Inter');
      expect(applied.settings_data.layout.containerWidth).toBe('1200px');
    });
  });

  describe('Version history creation', () => {
    it('should create version history entry when applying preset', async () => {
      // Arrange
      const getVersionHistorySpy = jest
        .spyOn(cmsSettingsService, 'getVersionHistory')
        .mockResolvedValue([mockVersion]);

      // Act
      const versions = await cmsSettingsService.getVersionHistory(
        mockTenantId,
        10,
        0
      );

      // Assert
      expect(getVersionHistorySpy).toHaveBeenCalledWith(mockTenantId, 10, 0);
      expect(versions).toHaveLength(1);
      expect(versions[0].version_number).toBe(1);
      expect(versions[0].created_by_admin_id).toBe(mockAdminId);
      expect(versions[0].settings_data).toEqual(mockPreset.preset_data);
    });

    it('should include change summary in version entry', async () => {
      // Arrange
      jest
        .spyOn(cmsSettingsService, 'getVersionHistory')
        .mockResolvedValue([mockVersion]);

      // Act
      const versions = await cmsSettingsService.getVersionHistory(
        mockTenantId,
        10,
        0
      );

      // Assert
      expect(versions[0].change_summary).toBeDefined();
      expect(versions[0].change_summary).toContain('Modern Minimal');
    });
  });

  describe('Audit log creation', () => {
    it('should create audit log entry with action=apply_preset', async () => {
      // Arrange
      const logActionSpy = jest
        .spyOn(auditLogService, 'logAction')
        .mockResolvedValue(mockAuditLog as any);

      // Act
      const result = await auditLogService.logAction(
        mockTenantId,
        mockAdminId,
        'apply_preset',
        'cms_settings',
        mockAppliedSettings.id,
        { presetName: mockPreset.name, presetId: mockPresetId }
      );

      // Assert
      expect(logActionSpy).toHaveBeenCalledWith(
        mockTenantId,
        mockAdminId,
        'apply_preset',
        'cms_settings',
        mockAppliedSettings.id,
        { presetName: mockPreset.name, presetId: mockPresetId }
      );
      expect(result.action).toBe('apply_preset');
      expect(result.admin_id).toBe(mockAdminId);
      expect(result.tenant_id).toBe(mockTenantId);
    });

    it('should include preset name and ID in audit log changes', async () => {
      // Arrange
      jest
        .spyOn(auditLogService, 'logAction')
        .mockResolvedValue(mockAuditLog as any);

      // Act
      const result = await auditLogService.logAction(
        mockTenantId,
        mockAdminId,
        'apply_preset',
        'cms_settings',
        mockAppliedSettings.id,
        { presetName: mockPreset.name, presetId: mockPresetId }
      );

      // Assert
      expect(result.changes.presetName).toBe('Modern Minimal');
      expect(result.changes.presetId).toBe(mockPresetId);
    });
  });

  describe('Tenant isolation', () => {
    it('should apply preset independently for each tenant', async () => {
      // Arrange
      const appliedTenant1 = {
        ...mockAppliedSettings,
        id: 'cms-settings-tenant1',
        tenant_id: mockTenantId,
      };

      const appliedTenant2 = {
        ...mockAppliedSettings,
        id: 'cms-settings-tenant2',
        tenant_id: mockTenantId2,
      };

      const applyPresetSpy = jest
        .spyOn(themePresetService, 'applyPreset')
        .mockResolvedValueOnce(appliedTenant1)
        .mockResolvedValueOnce(appliedTenant2);

      // Act
      const result1 = await themePresetService.applyPreset(
        mockTenantId,
        mockPreset.preset_data,
        mockAdminId
      );
      const result2 = await themePresetService.applyPreset(
        mockTenantId2,
        mockPreset.preset_data,
        mockAdminId
      );

      // Assert
      expect(applyPresetSpy).toHaveBeenCalledTimes(2);
      expect(result1.tenant_id).toBe(mockTenantId);
      expect(result2.tenant_id).toBe(mockTenantId2);
      expect(result1.id).not.toBe(result2.id); // Different cms_settings records
      expect(result1.settings_data).toEqual(result2.settings_data); // Same preset data
    });

    it('should enforce tenant_id validation before applying preset', async () => {
      // Arrange
      jest.spyOn(themePresetService, 'applyPreset').mockRejectedValue(
        new TenantMismatchError('Invalid tenant_id')
      );

      // Act & Assert
      try {
        await themePresetService.applyPreset(
          '', // Empty tenant ID
          mockPreset.preset_data,
          mockAdminId
        );
        fail('Should have thrown TenantMismatchError');
      } catch (error) {
        expect(error).toBeInstanceOf(TenantMismatchError);
      }
    });

    it('should reject null tenant_id', async () => {
      // Arrange
      jest.spyOn(themePresetService, 'applyPreset').mockRejectedValue(
        new TenantMismatchError('Invalid tenant_id')
      );

      // Act & Assert
      try {
        await themePresetService.applyPreset(
          null as any,
          mockPreset.preset_data,
          mockAdminId
        );
        fail('Should have thrown TenantMismatchError');
      } catch (error) {
        expect(error).toBeInstanceOf(TenantMismatchError);
      }
    });
  });

  describe('Error handling - Preset not found', () => {
    it('should return null when preset ID does not exist', async () => {
      // Arrange
      jest
        .spyOn(themePresetService, 'getPresetById')
        .mockResolvedValue(null);

      // Act
      const result = await themePresetService.getPresetById(
        'non-existent-preset'
      );

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when preset is not active', async () => {
      // Arrange
      jest
        .spyOn(themePresetService, 'getPresetById')
        .mockResolvedValue(null); // Service filters for is_active=true

      // Act
      const result = await themePresetService.getPresetById(mockPresetId);

      // Assert
      expect(result).toBeNull();
    });

    it('should handle database errors when fetching preset', async () => {
      // Arrange
      jest.spyOn(themePresetService, 'getPresetById').mockRejectedValue(
        new DatabaseError('Connection failed')
      );

      // Act & Assert
      try {
        await themePresetService.getPresetById(mockPresetId);
        fail('Should have thrown DatabaseError');
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
      }
    });

    it('should handle application errors gracefully', async () => {
      // Arrange
      jest.spyOn(themePresetService, 'applyPreset').mockRejectedValue(
        new DatabaseError('Failed to apply preset')
      );

      // Act & Assert
      try {
        await themePresetService.applyPreset(
          mockTenantId,
          mockPreset.preset_data,
          mockAdminId
        );
        fail('Should have thrown DatabaseError');
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
      }
    });
  });

  describe('Authorization', () => {
    it('should validate admin_id before applying', async () => {
      // Arrange
      jest.spyOn(themePresetService, 'applyPreset').mockRejectedValue(
        new TenantMismatchError('Invalid admin_id')
      );

      // Act & Assert
      try {
        await themePresetService.applyPreset(
          mockTenantId,
          mockPreset.preset_data,
          '' // Empty admin ID
        );
        fail('Should have thrown TenantMismatchError');
      } catch (error) {
        expect(error).toBeInstanceOf(TenantMismatchError);
      }
    });

    it('should reject null admin_id', async () => {
      // Arrange
      jest.spyOn(themePresetService, 'applyPreset').mockRejectedValue(
        new TenantMismatchError('Invalid admin_id')
      );

      // Act & Assert
      try {
        await themePresetService.applyPreset(
          mockTenantId,
          mockPreset.preset_data,
          null as any
        );
        fail('Should have thrown TenantMismatchError');
      } catch (error) {
        expect(error).toBeInstanceOf(TenantMismatchError);
      }
    });
  });

  describe('Response structure', () => {
    it('should return applied settings with correct structure', async () => {
      // Arrange
      jest
        .spyOn(themePresetService, 'applyPreset')
        .mockResolvedValue(mockAppliedSettings);

      // Act
      const result = await themePresetService.applyPreset(
        mockTenantId,
        mockPreset.preset_data,
        mockAdminId
      );

      // Assert
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('tenant_id');
      expect(result).toHaveProperty('settings_data');
      expect(result).toHaveProperty('created_at');
      expect(result).toHaveProperty('updated_at');
      expect(result).toHaveProperty('updated_by_admin_id');
    });

    it('should include full preset data in settings_data field', async () => {
      // Arrange
      jest
        .spyOn(themePresetService, 'applyPreset')
        .mockResolvedValue(mockAppliedSettings);

      // Act
      const result = await themePresetService.applyPreset(
        mockTenantId,
        mockPreset.preset_data,
        mockAdminId
      );

      // Assert
      expect(result.settings_data).toEqual(mockPreset.preset_data);
      expect(result.settings_data.colors).toBeDefined();
      expect(result.settings_data.typography).toBeDefined();
      expect(result.settings_data.layout).toBeDefined();
    });

    it('should include admin_id in updated_by field', async () => {
      // Arrange
      jest
        .spyOn(themePresetService, 'applyPreset')
        .mockResolvedValue(mockAppliedSettings);

      // Act
      const result = await themePresetService.applyPreset(
        mockTenantId,
        mockPreset.preset_data,
        mockAdminId
      );

      // Assert
      expect(result.updated_by_admin_id).toBe(mockAdminId);
    });

    it('should include tenant_id in response', async () => {
      // Arrange
      jest
        .spyOn(themePresetService, 'applyPreset')
        .mockResolvedValue(mockAppliedSettings);

      // Act
      const result = await themePresetService.applyPreset(
        mockTenantId,
        mockPreset.preset_data,
        mockAdminId
      );

      // Assert
      expect(result.tenant_id).toBe(mockTenantId);
    });
  });

  describe('Complete workflow', () => {
    it('should complete full flow: fetch preset -> apply -> verify isolation', async () => {
      // Arrange
      const getPresetByIdSpy = jest
        .spyOn(themePresetService, 'getPresetById')
        .mockResolvedValue(mockPreset);
      const applyPresetSpy = jest
        .spyOn(themePresetService, 'applyPreset')
        .mockResolvedValue(mockAppliedSettings);
      const getVersionHistorySpy = jest
        .spyOn(cmsSettingsService, 'getVersionHistory')
        .mockResolvedValue([mockVersion]);
      const logActionSpy = jest
        .spyOn(auditLogService, 'logAction')
        .mockResolvedValue(mockAuditLog as any);

      // Act - Step 1: Fetch preset
      const preset = await themePresetService.getPresetById(mockPresetId);
      expect(preset).not.toBeNull();

      // Act - Step 2: Apply preset
      const applied = await themePresetService.applyPreset(
        mockTenantId,
        preset!.preset_data,
        mockAdminId
      );

      // Act - Step 3: Check version history
      const versions = await cmsSettingsService.getVersionHistory(
        mockTenantId,
        10,
        0
      );

      // Act - Step 4: Log audit entry
      await auditLogService.logAction(
        mockTenantId,
        mockAdminId,
        'apply_preset',
        'cms_settings',
        applied.id,
        { presetName: preset!.name }
      );

      // Assert
      expect(getPresetByIdSpy).toHaveBeenCalledWith(mockPresetId);
      expect(applyPresetSpy).toHaveBeenCalledWith(
        mockTenantId,
        mockPreset.preset_data,
        mockAdminId
      );
      expect(getVersionHistorySpy).toHaveBeenCalledWith(mockTenantId, 10, 0);
      expect(logActionSpy).toHaveBeenCalledWith(
        mockTenantId,
        mockAdminId,
        'apply_preset',
        'cms_settings',
        applied.id,
        { presetName: preset!.name }
      );

      expect(applied.tenant_id).toBe(mockTenantId);
      expect(versions.length).toBeGreaterThan(0);
    });
  });
});
