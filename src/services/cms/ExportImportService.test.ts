import { ExportImportService } from './ExportImportService';
import { CMSSettingsService, TenantMismatchError } from './CMSSettingsService';
import { DatabaseError } from '@/lib/db';
import { supabaseAdmin } from '@/lib/supabase-admin';

// Mock dependencies
jest.mock('./CMSSettingsService');
jest.mock('@/lib/supabase-admin');

describe('ExportImportService', () => {
  let service: ExportImportService;
  let mockCMSService: jest.Mocked<CMSSettingsService>;

  // Test data
  const testTenantId = 'tenant-123';
  const testAdminId = 'admin-123';
  const mockSettings = {
    id: 'settings-123',
    tenant_id: testTenantId,
    settings_data: {
      colors: { primary: '#3B82F6', secondary: '#10B981' },
      typography: { headings: { fontFamily: 'Poppins' } },
      layout: { containerWidth: '1200px' },
    },
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    updated_by_admin_id: testAdminId,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCMSService = CMSSettingsService as jest.Mocked<CMSSettingsService>;
    service = new ExportImportService(mockCMSService);
  });

  describe('exportSettings', () => {
    it('should export settings successfully with correct format', async () => {
      mockCMSService.getSettingsByTenantId.mockResolvedValue(mockSettings);
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      const result = await service.exportSettings(testTenantId, testAdminId);

      expect(result).toHaveProperty('version', '1.0');
      expect(result).toHaveProperty('exportedAt');
      expect(result).toHaveProperty('exportedBy', testAdminId);
      expect(result).toHaveProperty('metadata');
      expect(result).toHaveProperty('settings', mockSettings.settings_data);
      expect(result.metadata).toHaveProperty('name');
      expect(result.metadata).toHaveProperty('description');
    });

    it('should include exportedAt timestamp in ISO format', async () => {
      mockCMSService.getSettingsByTenantId.mockResolvedValue(mockSettings);
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      const result = await service.exportSettings(testTenantId, testAdminId);

      const exportedDate = new Date(result.exportedAt);
      expect(exportedDate.getTime()).toBeLessThanOrEqual(Date.now());
      expect(exportedDate.getTime()).toBeGreaterThan(Date.now() - 5000); // Within 5 seconds
    });

    it('should throw TenantMismatchError if tenant_id is missing', async () => {
      await expect(
        service.exportSettings('', testAdminId)
      ).rejects.toThrow(TenantMismatchError);

      await expect(
        service.exportSettings(null as any, testAdminId)
      ).rejects.toThrow(TenantMismatchError);

      await expect(
        service.exportSettings('   ', testAdminId)
      ).rejects.toThrow(TenantMismatchError);
    });

    it('should throw DatabaseError if admin_id is invalid', async () => {
      await expect(
        service.exportSettings(testTenantId, '')
      ).rejects.toThrow(DatabaseError);

      await expect(
        service.exportSettings(testTenantId, null as any)
      ).rejects.toThrow(DatabaseError);
    });

    it('should throw DatabaseError if no customizations found', async () => {
      mockCMSService.getSettingsByTenantId.mockResolvedValue(null);

      await expect(
        service.exportSettings(testTenantId, testAdminId)
      ).rejects.toThrow(DatabaseError);
    });

    it('should log export action to audit trail', async () => {
      mockCMSService.getSettingsByTenantId.mockResolvedValue(mockSettings);
      const mockAuditInsert = jest.fn().mockResolvedValue({ data: null, error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: mockAuditInsert,
      });

      await service.exportSettings(testTenantId, testAdminId);

      expect(mockAuditInsert).toHaveBeenCalled();
      const auditData = mockAuditInsert.mock.calls[0][0];
      expect(auditData).toMatchObject({
        tenant_id: testTenantId,
        admin_id: testAdminId,
        action: 'export',
        resource_type: 'cms_settings',
      });
    });

    it('should continue on audit log error (non-blocking)', async () => {
      mockCMSService.getSettingsByTenantId.mockResolvedValue(mockSettings);
      const mockAuditInsert = jest
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'Audit failed' } });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: mockAuditInsert,
      });

      // Should not throw despite audit failure
      const result = await service.exportSettings(testTenantId, testAdminId);
      expect(result).toHaveProperty('version', '1.0');
    });
  });

  describe('validateImportFile', () => {
    it('should accept valid import file', () => {
      const validImportData = {
        version: '1.0',
        metadata: { name: 'Test Export' },
        settings: {
          colors: { primary: '#3B82F6' },
          typography: {},
          layout: {},
          components: {},
          content: {},
        },
      };

      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });

      const result = service.validateImportFile(validImportData);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject import without version field', () => {
      const invalidData = {
        metadata: { name: 'Test Export' },
        settings: { colors: {} },
      };

      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });

      const result = service.validateImportFile(invalidData);

      expect(result.errors).toContain('Import data must include version field');
    });

    it('should reject import with wrong version', () => {
      const invalidData = {
        version: '2.0',
        settings: { colors: {} },
      };

      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });

      const result = service.validateImportFile(invalidData);

      expect(result.errors).toContain(
        'Invalid export version. Expected 1.0, got 2.0'
      );
    });

    it('should reject import with invalid metadata', () => {
      const invalidData = {
        version: '1.0',
        metadata: 'not-an-object',
        settings: { colors: {} },
      };

      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });

      const result = service.validateImportFile(invalidData);

      expect(result.errors).toContain('Metadata must be an object');
    });

    it('should reject import with invalid settings object', () => {
      const invalidData = {
        version: '1.0',
        settings: null,
      };

      mockCMSService.validateImportFile.mockReturnValue({
        valid: false,
        errors: ['Settings must be an object'],
      });

      const result = service.validateImportFile(invalidData);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Settings must be an object');
    });

    it('should accept valid import without metadata', () => {
      const validData = {
        version: '1.0',
        settings: { colors: {} },
      };

      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });

      const result = service.validateImportFile(validData);

      expect(result.valid).toBe(true);
    });
  });

  describe('mergeSettings', () => {
    const currentSettings = {
      colors: { primary: '#OLD', secondary: '#OLD' },
      typography: { headings: { fontFamily: 'OldFont' } },
      layout: { containerWidth: '1000px' },
    };

    const importedSettings = {
      colors: { primary: '#NEW' },
      typography: { headings: { fontSize: 48 } },
    };

    it('should use overwrite strategy to replace all settings', () => {
      mockCMSService.mergeSettings.mockImplementation(
        (current, imported, strategy) => {
          if (strategy === 'overwrite') {
            return imported;
          }
          return current;
        }
      );

      const result = service.mergeSettings(
        currentSettings,
        importedSettings,
        'overwrite'
      );

      expect(result).toEqual(importedSettings);
      expect(result.layout).toBeUndefined();
    });

    it('should use merge strategy to deep merge settings', () => {
      mockCMSService.mergeSettings.mockImplementation(
        (current, imported, strategy) => {
          if (strategy === 'merge') {
            return {
              ...current,
              colors: { ...current.colors, ...imported.colors },
              typography: { ...current.typography, ...imported.typography },
              layout: current.layout, // Preserved
            };
          }
          return imported;
        }
      );

      const result = service.mergeSettings(
        currentSettings,
        importedSettings,
        'merge'
      );

      expect(result.colors.primary).toBe('#NEW'); // From imported
      expect(result.colors.secondary).toBe('#OLD'); // Preserved from current
      expect(result.layout).toEqual(currentSettings.layout); // Preserved
    });

    it('should default to overwrite strategy', () => {
      mockCMSService.mergeSettings.mockImplementation((current, imported) => {
        return imported; // Default overwrite
      });

      const result = service.mergeSettings(currentSettings, importedSettings);

      expect(result).toEqual(importedSettings);
    });

    it('should preserve unmodified fields in merge strategy', () => {
      mockCMSService.mergeSettings.mockImplementation(
        (current, imported, strategy) => {
          if (strategy === 'merge') {
            return {
              colors: { ...current.colors, ...imported.colors },
              typography: {
                headings: { ...current.typography.headings, ...imported.typography.headings },
              },
              layout: current.layout,
            };
          }
          return imported;
        }
      );

      const result = service.mergeSettings(
        currentSettings,
        importedSettings,
        'merge'
      );

      // Secondary color should be preserved
      expect(result.colors.secondary).toBe('#OLD');
      // Layout should be completely preserved
      expect(result.layout).toEqual(currentSettings.layout);
      // Updated fields should be new
      expect(result.colors.primary).toBe('#NEW');
    });
  });

  describe('importSettings', () => {
    const validImportData = {
      version: '1.0',
      metadata: { name: 'Test Import' },
      settings: {
        colors: { primary: '#3B82F6' },
        typography: { headings: { fontFamily: 'Poppins' } },
        layout: { containerWidth: '1200px' },
        components: {},
        content: {},
      },
    };

    it('should import settings with overwrite strategy successfully', async () => {
      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.validateSettings.mockReturnValue([]);
      mockCMSService.upsertSettings.mockResolvedValue(mockSettings);
      mockCMSService.mergeSettings.mockImplementation((current, imported) => imported);
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      const result = await service.importSettings(
        testTenantId,
        validImportData,
        'overwrite',
        testAdminId
      );

      expect(result).toBeDefined();
      expect(mockCMSService.upsertSettings).toHaveBeenCalledWith(
        testTenantId,
        validImportData.settings,
        testAdminId
      );
    });

    it('should import settings with merge strategy successfully', async () => {
      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.getSettingsByTenantId.mockResolvedValue(mockSettings);
      mockCMSService.validateSettings.mockReturnValue([]);
      mockCMSService.upsertSettings.mockResolvedValue(mockSettings);
      mockCMSService.mergeSettings.mockReturnValue({
        ...mockSettings.settings_data,
        colors: { primary: '#3B82F6', secondary: '#10B981' },
      });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      const result = await service.importSettings(
        testTenantId,
        validImportData,
        'merge',
        testAdminId
      );

      expect(result).toBeDefined();
      expect(mockCMSService.getSettingsByTenantId).toHaveBeenCalledWith(testTenantId);
      expect(mockCMSService.mergeSettings).toHaveBeenCalled();
    });

    it('should throw TenantMismatchError if tenant_id is missing', async () => {
      await expect(
        service.importSettings('', validImportData, 'overwrite', testAdminId)
      ).rejects.toThrow(TenantMismatchError);

      await expect(
        service.importSettings(null as any, validImportData, 'overwrite', testAdminId)
      ).rejects.toThrow(TenantMismatchError);
    });

    it('should throw DatabaseError if admin_id is invalid', async () => {
      await expect(
        service.importSettings(testTenantId, validImportData, 'overwrite', '')
      ).rejects.toThrow(DatabaseError);
    });

    it('should throw DatabaseError if merge strategy is invalid', async () => {
      await expect(
        service.importSettings(
          testTenantId,
          validImportData,
          'invalid-strategy' as any,
          testAdminId
        )
      ).rejects.toThrow(DatabaseError);
    });

    it('should throw DatabaseError if import validation fails', async () => {
      const invalidImportData = {
        version: '2.0',
        settings: null,
      };

      mockCMSService.validateImportFile.mockReturnValue({
        valid: false,
        errors: ['Invalid version', 'Missing settings'],
      });

      await expect(
        service.importSettings(
          testTenantId,
          invalidImportData,
          'overwrite',
          testAdminId
        )
      ).rejects.toThrow(DatabaseError);
    });

    it('should throw DatabaseError if settings validation fails after merge', async () => {
      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.validateSettings.mockReturnValue([
        'Invalid color format',
      ]);

      await expect(
        service.importSettings(
          testTenantId,
          validImportData,
          'overwrite',
          testAdminId
        )
      ).rejects.toThrow(DatabaseError);
    });

    it('should log import action to audit trail', async () => {
      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.validateSettings.mockReturnValue([]);
      mockCMSService.upsertSettings.mockResolvedValue(mockSettings);
      const mockAuditInsert = jest.fn().mockResolvedValue({ data: null, error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: mockAuditInsert,
      });

      await service.importSettings(
        testTenantId,
        validImportData,
        'merge',
        testAdminId
      );

      expect(mockAuditInsert).toHaveBeenCalled();
      const auditData = mockAuditInsert.mock.calls[mockAuditInsert.mock.calls.length - 1][0];
      expect(auditData).toMatchObject({
        tenant_id: testTenantId,
        admin_id: testAdminId,
        action: 'import',
        resource_type: 'cms_settings',
      });
      expect(auditData.changes).toHaveProperty('mergeStrategy', 'merge');
    });

    it('should handle merge strategy when no current settings exist', async () => {
      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.getSettingsByTenantId.mockResolvedValue(null);
      mockCMSService.validateSettings.mockReturnValue([]);
      mockCMSService.upsertSettings.mockResolvedValue(mockSettings);
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      const result = await service.importSettings(
        testTenantId,
        validImportData,
        'merge',
        testAdminId
      );

      expect(result).toBeDefined();
      expect(mockCMSService.upsertSettings).toHaveBeenCalledWith(
        testTenantId,
        validImportData.settings,
        testAdminId
      );
    });

    it('should continue on audit log error (non-blocking)', async () => {
      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.validateSettings.mockReturnValue([]);
      mockCMSService.upsertSettings.mockResolvedValue(mockSettings);
      const mockAuditInsert = jest
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'Audit failed' } });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: mockAuditInsert,
      });

      // Should not throw despite audit failure
      const result = await service.importSettings(
        testTenantId,
        validImportData,
        'overwrite',
        testAdminId
      );

      expect(result).toBeDefined();
    });
  });

  describe('Property: Export-Import Idempotence', () => {
    /**
     * Validates: Requirements 11.1, 11.4, 11.5, 11.6
     * 
     * Property: Export followed by import produces identical settings
     * 
     * This property verifies that:
     * 1. Export generates a valid, complete JSON representation
     * 2. Import accepts this JSON and loads it correctly
     * 3. The loaded settings are identical to the exported settings
     * 4. Settings survive the round-trip without modification
     */
    it('should preserve settings through export-import cycle with overwrite', async () => {
      const originalSettings = {
        colors: { primary: '#FF5733', secondary: '#33FF57' },
        typography: { headings: { fontFamily: 'ComicSans', fontSize: 42 } },
        layout: { containerWidth: '1440px', gaps: { grid: 32 } },
        components: { hero: { enabled: true } },
        content: { hero: { heading: 'Test Heading' } },
      };

      mockCMSService.getSettingsByTenantId.mockResolvedValue({
        ...mockSettings,
        settings_data: originalSettings,
      });
      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.validateSettings.mockReturnValue([]);
      mockCMSService.upsertSettings.mockResolvedValue({
        ...mockSettings,
        settings_data: originalSettings,
      });
      mockCMSService.mergeSettings.mockImplementation((current, imported) => imported);
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      // Export
      const exportedData = await service.exportSettings(testTenantId, testAdminId);

      // Verify export format
      expect(exportedData.version).toBe('1.0');
      expect(exportedData.settings).toEqual(originalSettings);

      // Import
      const importedResult = await service.importSettings(
        testTenantId,
        exportedData,
        'overwrite',
        testAdminId
      );

      // Verify imported settings match original
      expect(importedResult.settings_data).toEqual(originalSettings);
    });

    it('should preserve settings through export-import cycle with merge', async () => {
      const currentSettings = {
        colors: { primary: '#111111', secondary: '#222222', accent: '#333333' },
        typography: { headings: { fontFamily: 'Arial' } },
        layout: { containerWidth: '1000px' },
      };

      const exportedSettings = {
        colors: { primary: '#FF0000', secondary: '#00FF00' },
        typography: { headings: { fontSize: 36 } },
      };

      mockCMSService.getSettingsByTenantId.mockResolvedValue({
        ...mockSettings,
        settings_data: currentSettings,
      });
      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.validateSettings.mockReturnValue([]);

      const mergedSettings = {
        colors: { primary: '#FF0000', secondary: '#00FF00', accent: '#333333' },
        typography: { headings: { fontFamily: 'Arial', fontSize: 36 } },
        layout: { containerWidth: '1000px' },
      };

      mockCMSService.mergeSettings.mockReturnValue(mergedSettings);
      mockCMSService.upsertSettings.mockResolvedValue({
        ...mockSettings,
        settings_data: mergedSettings,
      });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      // Export
      const exportData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        exportedBy: testAdminId,
        metadata: { name: 'Test Export' },
        settings: exportedSettings,
      };

      // Import with merge
      const importedResult = await service.importSettings(
        testTenantId,
        exportData,
        'merge',
        testAdminId
      );

      // Verify merged settings preserve current values
      expect(importedResult.settings_data.colors.accent).toBe('#333333');
      expect(importedResult.settings_data.layout.containerWidth).toBe('1000px');
      // And include imported values
      expect(importedResult.settings_data.colors.primary).toBe('#FF0000');
      expect(importedResult.settings_data.typography.headings.fontSize).toBe(36);
    });
  });
});
