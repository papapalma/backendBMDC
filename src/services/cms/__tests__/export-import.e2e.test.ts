/**
 * End-to-End Tests for Export/Import Feature
 * 
 * This test suite validates the complete export/import workflow including:
 * - Export flow: fetch settings → generate JSON with metadata → download
 * - Import flow: upload file → validate structure → merge/overwrite → apply settings
 * - Both merge strategies (overwrite and merge)
 * - Export followed by import produces identical settings (idempotence)
 * - Error scenarios: malformed files, invalid data, merge conflicts
 * - Audit logging for export/import actions
 * 
 * Requirements Addressed:
 * - 11.1: Export generates JSON file
 * - 11.2: Export includes metadata
 * - 11.3: Import accepts JSON files
 * - 11.4: Import file validation
 * - 11.5: Merge strategies work correctly
 * - 11.6: Import applies settings
 * - 15: Audit logging for all actions
 * - 2: Tenant isolation throughout workflow
 */

import { ExportImportService } from '../ExportImportService';
import { CMSSettingsService, TenantMismatchError } from '../CMSSettingsService';
import { AuditLogService } from '../AuditLogService';
import { DatabaseError } from '@/lib/db';
import { supabaseAdmin } from '@/lib/supabase-admin';

// Mock dependencies
jest.mock('../CMSSettingsService');
jest.mock('../AuditLogService');
jest.mock('@/lib/supabase-admin');

describe('Export/Import End-to-End Tests', () => {
  let exportImportService: ExportImportService;
  let mockCMSService: jest.Mocked<CMSSettingsService>;
  let mockAuditService: jest.Mocked<AuditLogService>;

  // Test data fixtures
  const tenantA = 'tenant-a-uuid';
  const tenantB = 'tenant-b-uuid';
  const adminA = 'admin-a-uuid';
  const adminB = 'admin-b-uuid';

  const baseSettings = {
    colors: {
      primary: '#3B82F6',
      secondary: '#10B981',
      accent: '#F59E0B',
      background: '#FFFFFF',
      text: '#1F2937',
    },
    typography: {
      headings: {
        fontFamily: 'Poppins',
        fontSize: {
          h1: 48,
          h2: 36,
          h3: 28,
        },
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
    components: {
      navigation: { enabled: true, style: 'light' },
      hero: { enabled: true, backgroundImage: 'url(...)', overlayColor: 'rgba(0,0,0,0.3)', height: '500px' },
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
        { title: 'Feature 2', description: 'Description...', icon: 'icon-name' },
      ],
      testimonials: [
        { text: 'Great product!', author: 'John Doe', image: 'url(...)' },
      ],
      contact: {
        email: 'contact@example.com',
        phone: '+1-555-000-0000',
        address: '123 Main St',
        socialLinks: { twitter: 'https://twitter.com/...', linkedin: 'https://linkedin.com/...' },
      },
    },
  };

  const tenantASettings = {
    id: 'settings-a',
    tenant_id: tenantA,
    settings_data: baseSettings,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    updated_by_admin_id: adminA,
  };

  const tenantBSettings = {
    id: 'settings-b',
    tenant_id: tenantB,
    settings_data: {
      ...baseSettings,
      colors: { ...baseSettings.colors, primary: '#FF5733' },
      content: {
        ...baseSettings.content,
        hero: { heading: 'Tenant B Landing Page', subheading: '', ctaText: 'Join Now' },
      },
    },
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    updated_by_admin_id: adminB,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCMSService = CMSSettingsService as jest.Mocked<CMSSettingsService>;
    mockAuditService = AuditLogService as jest.Mocked<AuditLogService>;
    exportImportService = new ExportImportService(mockCMSService);

    // Default mock implementations
    (supabaseAdmin.from as jest.Mock).mockReturnValue({
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });
  });

  describe('E2E: Complete Export Flow', () => {
    /**
     * Scenario: Admin logs in → Navigates to Export → Clicks Export → Downloads JSON file
     * 
     * Validates Requirements:
     * - 11.1: Export generates JSON file
     * - 11.2: Export includes metadata
     * - 15.1: Audit logging of export action
     * - 2: Tenant isolation (only current tenant's data exported)
     */
    it('should export complete settings with metadata successfully', async () => {
      mockCMSService.getSettingsByTenantId.mockResolvedValue(tenantASettings);
      const mockInsert = jest.fn().mockResolvedValue({ data: null, error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: mockInsert,
      });

      const exportData = await exportImportService.exportSettings(tenantA, adminA);

      // Verify export structure
      expect(exportData).toHaveProperty('version', '1.0');
      expect(exportData).toHaveProperty('exportedAt');
      expect(exportData).toHaveProperty('exportedBy', adminA);
      expect(exportData).toHaveProperty('metadata');
      expect(exportData).toHaveProperty('settings');

      // Verify metadata
      expect(exportData.metadata).toHaveProperty('name');
      expect(exportData.metadata).toHaveProperty('description');

      // Verify settings are complete
      expect(exportData.settings).toEqual(baseSettings);

      // Verify exportedAt is valid timestamp
      const exportDate = new Date(exportData.exportedAt);
      expect(exportDate.getTime()).toBeLessThanOrEqual(Date.now());

      // Verify audit log created
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: tenantA,
          admin_id: adminA,
          action: 'export',
          resource_type: 'cms_settings',
        })
      );
    });

    it('should include all customization categories in export', async () => {
      mockCMSService.getSettingsByTenantId.mockResolvedValue(tenantASettings);
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      const exportData = await exportImportService.exportSettings(tenantA, adminA);

      // Verify all customization categories present
      expect(exportData.settings).toHaveProperty('colors');
      expect(exportData.settings).toHaveProperty('typography');
      expect(exportData.settings).toHaveProperty('layout');
      expect(exportData.settings).toHaveProperty('components');
      expect(exportData.settings).toHaveProperty('content');

      // Verify detailed structure
      expect(exportData.settings.colors).toEqual(expect.objectContaining({
        primary: expect.any(String),
        secondary: expect.any(String),
        accent: expect.any(String),
      }));

      expect(exportData.settings.typography).toEqual(expect.objectContaining({
        headings: expect.any(Object),
        body: expect.any(Object),
      }));

      expect(exportData.settings.layout).toEqual(expect.objectContaining({
        containerWidth: expect.any(String),
        padding: expect.any(Object),
        margins: expect.any(Object),
      }));
    });

    it('should reject export for non-existent settings', async () => {
      mockCMSService.getSettingsByTenantId.mockResolvedValue(null);

      await expect(
        exportImportService.exportSettings(tenantA, adminA)
      ).rejects.toThrow(DatabaseError);
    });

    it('should reject export without valid tenant context', async () => {
      await expect(
        exportImportService.exportSettings('', adminA)
      ).rejects.toThrow(TenantMismatchError);

      await expect(
        exportImportService.exportSettings(null as any, adminA)
      ).rejects.toThrow(TenantMismatchError);
    });

    it('should enforce tenant isolation in export', async () => {
      mockCMSService.getSettingsByTenantId.mockResolvedValue(tenantASettings);
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      // Admin A exports Tenant A settings
      const exportData = await exportImportService.exportSettings(tenantA, adminA);

      // Verify exported settings belong to Tenant A
      expect(exportData.settings).toEqual(tenantASettings.settings_data);
      expect(exportData.settings).not.toEqual(tenantBSettings.settings_data);
    });
  });

  describe('E2E: Complete Import Flow', () => {
    /**
     * Scenario: Admin clicks Import → Selects file → System validates → Preview shown → Confirms → Settings applied
     * 
     * Validates Requirements:
     * - 11.3: Import accepts JSON files
     * - 11.4: Import file validation
     * - 11.5: Merge strategies work
     * - 11.6: Import applies settings
     * - 15.1: Audit logging of import action
     */
    it('should import valid file with overwrite strategy successfully', async () => {
      const exportedData = {
        version: '1.0' as const,
        exportedAt: new Date().toISOString(),
        exportedBy: adminA,
        metadata: { name: 'Test Export', description: 'Test' },
        settings: baseSettings,
      };

      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.validateSettings.mockReturnValue([]);
      mockCMSService.upsertSettings.mockResolvedValue(tenantASettings);
      const mockInsert = jest.fn().mockResolvedValue({ data: null, error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: mockInsert,
      });

      const result = await exportImportService.importSettings(
        tenantA,
        exportedData,
        'overwrite',
        adminA
      );

      expect(result).toBeDefined();
      expect(result.tenant_id).toBe(tenantA);

      // Verify settings applied correctly
      expect(mockCMSService.upsertSettings).toHaveBeenCalledWith(
        tenantA,
        baseSettings,
        adminA
      );

      // Verify audit log
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: tenantA,
          admin_id: adminA,
          action: 'import',
          resource_type: 'cms_settings',
        })
      );
    });

    it('should validate import file structure before applying', async () => {
      const invalidData = {
        version: '2.0', // Wrong version
        settings: null,
      };

      mockCMSService.validateImportFile.mockReturnValue({
        valid: false,
        errors: ['Invalid version', 'Missing settings'],
      });

      await expect(
        exportImportService.importSettings(tenantA, invalidData, 'overwrite', adminA)
      ).rejects.toThrow(DatabaseError);

      // Verify settings not applied
      expect(mockCMSService.upsertSettings).not.toHaveBeenCalled();
    });

    it('should validate settings after merge before applying', async () => {
      const exportedData = {
        version: '1.0' as const,
        exportedAt: new Date().toISOString(),
        exportedBy: adminA,
        metadata: { name: 'Test Export' },
        settings: {
          colors: { primary: 'invalid-color' }, // Invalid color format
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
      mockCMSService.validateSettings.mockReturnValue([
        'Invalid color format for primary',
      ]);

      await expect(
        exportImportService.importSettings(tenantA, exportedData, 'overwrite', adminA)
      ).rejects.toThrow(DatabaseError);

      // Verify settings not applied due to validation failure
      expect(mockCMSService.upsertSettings).not.toHaveBeenCalled();
    });

    it('should reject import without valid tenant context', async () => {
      const exportedData = {
        version: '1.0' as const,
        exportedAt: new Date().toISOString(),
        exportedBy: adminA,
        metadata: { name: 'Test Export' },
        settings: baseSettings,
      };

      await expect(
        exportImportService.importSettings('', exportedData, 'overwrite', adminA)
      ).rejects.toThrow(TenantMismatchError);

      await expect(
        exportImportService.importSettings(null as any, exportedData, 'overwrite', adminA)
      ).rejects.toThrow(TenantMismatchError);
    });

    it('should enforce tenant isolation in import', async () => {
      const exportedData = {
        version: '1.0' as const,
        exportedAt: new Date().toISOString(),
        exportedBy: adminB,
        metadata: { name: 'Tenant B Export' },
        settings: tenantBSettings.settings_data,
      };

      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.validateSettings.mockReturnValue([]);
      mockCMSService.upsertSettings.mockResolvedValue(tenantASettings);
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      // Admin A imports Tenant B's settings into Tenant A
      const result = await exportImportService.importSettings(
        tenantA,
        exportedData,
        'overwrite',
        adminA
      );

      // Settings should be imported INTO Tenant A (not replace Tenant A settings with Tenant B data)
      expect(mockCMSService.upsertSettings).toHaveBeenCalledWith(
        tenantA,
        tenantBSettings.settings_data,
        adminA
      );
    });
  });

  describe('E2E: Merge Strategies', () => {
    /**
     * Scenario 1 (Overwrite): Admin imports file → All settings replaced completely
     * Scenario 2 (Merge): Admin imports file → Only specified fields updated, others preserved
     * 
     * Validates Requirement 11.5: Merge strategies work correctly
     */
    describe('Overwrite Strategy', () => {
      it('should completely replace all settings with overwrite strategy', async () => {
        const currentSettings = {
          colors: { primary: '#000000', secondary: '#111111', accent: '#222222' },
          typography: { headings: { fontFamily: 'OldFont' } },
          layout: { containerWidth: '800px' },
          components: { hero: { enabled: false } },
          content: { hero: { heading: 'Old Heading' } },
        };

        const newSettings = {
          colors: { primary: '#FFFFFF', secondary: '#EEEEEE' },
          typography: { headings: { fontFamily: 'NewFont' } },
          layout: { containerWidth: '1400px' },
          components: {},
          content: {},
        };

        mockCMSService.validateImportFile.mockReturnValue({
          valid: true,
          errors: [],
        });
        mockCMSService.validateSettings.mockReturnValue([]);
        mockCMSService.upsertSettings.mockResolvedValue({
          ...tenantASettings,
          settings_data: newSettings,
        });
        (supabaseAdmin.from as jest.Mock).mockReturnValue({
          insert: jest.fn().mockResolvedValue({ data: null, error: null }),
        });

        const importData = {
          version: '1.0' as const,
          exportedAt: new Date().toISOString(),
          exportedBy: adminA,
          metadata: { name: 'New Export' },
          settings: newSettings,
        };

        const result = await exportImportService.importSettings(
          tenantA,
          importData,
          'overwrite',
          adminA
        );

        // Verify complete replacement
        expect(mockCMSService.upsertSettings).toHaveBeenCalledWith(
          tenantA,
          newSettings,
          adminA
        );

        expect(result.settings_data).toEqual(newSettings);
      });
    });

    describe('Merge Strategy', () => {
      it('should merge settings preserving unmodified fields with merge strategy', async () => {
        const currentSettings = {
          colors: { primary: '#000000', secondary: '#111111', accent: '#222222' },
          typography: { headings: { fontFamily: 'OldFont', fontSize: 48 }, body: { fontFamily: 'Arial' } },
          layout: { containerWidth: '1000px', padding: { hero: 40 } },
          components: { hero: { enabled: true }, navigation: { enabled: true } },
          content: { hero: { heading: 'Current' }, features: [] },
        };

        const importedSettings = {
          colors: { primary: '#FFFFFF' }, // Only primary changes
          typography: { headings: { fontSize: 36 } }, // Only font size changes
          layout: { containerWidth: '1200px' }, // Only width changes
        };

        mockCMSService.validateImportFile.mockReturnValue({
          valid: true,
          errors: [],
        });
        mockCMSService.getSettingsByTenantId.mockResolvedValue({
          ...tenantASettings,
          settings_data: currentSettings,
        });
        mockCMSService.validateSettings.mockReturnValue([]);

        // Mock the merge to preserve unmodified fields
        const mergedSettings = {
          colors: { primary: '#FFFFFF', secondary: '#111111', accent: '#222222' },
          typography: {
            headings: { fontFamily: 'OldFont', fontSize: 36 },
            body: { fontFamily: 'Arial' },
          },
          layout: { containerWidth: '1200px', padding: { hero: 40 } },
          components: { hero: { enabled: true }, navigation: { enabled: true } },
          content: { hero: { heading: 'Current' }, features: [] },
        };

        mockCMSService.mergeSettings.mockReturnValue(mergedSettings);
        mockCMSService.upsertSettings.mockResolvedValue({
          ...tenantASettings,
          settings_data: mergedSettings,
        });
        (supabaseAdmin.from as jest.Mock).mockReturnValue({
          insert: jest.fn().mockResolvedValue({ data: null, error: null }),
        });

        const importData = {
          version: '1.0' as const,
          exportedAt: new Date().toISOString(),
          exportedBy: adminA,
          metadata: { name: 'Partial Export' },
          settings: importedSettings,
        };

        const result = await exportImportService.importSettings(
          tenantA,
          importData,
          'merge',
          adminA
        );

        // Verify merge was called
        expect(mockCMSService.mergeSettings).toHaveBeenCalledWith(
          currentSettings,
          importedSettings,
          'merge'
        );

        // Verify unmodified fields preserved
        expect(result.settings_data.colors.secondary).toBe('#111111');
        expect(result.settings_data.typography.body.fontFamily).toBe('Arial');
        expect(result.settings_data.layout.padding.hero).toBe(40);
        expect(result.settings_data.components.navigation.enabled).toBe(true);

        // Verify modified fields updated
        expect(result.settings_data.colors.primary).toBe('#FFFFFF');
        expect(result.settings_data.typography.headings.fontSize).toBe(36);
        expect(result.settings_data.layout.containerWidth).toBe('1200px');
      });

      it('should use imported settings when no current settings exist with merge strategy', async () => {
        mockCMSService.validateImportFile.mockReturnValue({
          valid: true,
          errors: [],
        });
        mockCMSService.getSettingsByTenantId.mockResolvedValue(null); // No existing settings
        mockCMSService.validateSettings.mockReturnValue([]);
        mockCMSService.upsertSettings.mockResolvedValue(tenantASettings);
        (supabaseAdmin.from as jest.Mock).mockReturnValue({
          insert: jest.fn().mockResolvedValue({ data: null, error: null }),
        });

        const importData = {
          version: '1.0' as const,
          exportedAt: new Date().toISOString(),
          exportedBy: adminA,
          metadata: { name: 'Initial Import' },
          settings: baseSettings,
        };

        const result = await exportImportService.importSettings(
          tenantA,
          importData,
          'merge',
          adminA
        );

        // Verify merge not needed (no current settings)
        expect(mockCMSService.mergeSettings).not.toHaveBeenCalled();

        // Verify imported settings used as-is
        expect(mockCMSService.upsertSettings).toHaveBeenCalledWith(
          tenantA,
          baseSettings,
          adminA
        );
      });
    });
  });

  describe('E2E: Export-Import Idempotence', () => {
    /**
     * Property: Export followed by import produces identical settings
     * 
     * Validates Requirements:
     * - 11.1, 11.2, 11.3, 11.4, 11.5, 11.6: Complete export/import cycle
     */
    it('should preserve all settings through export-import cycle with overwrite', async () => {
      // Step 1: Export settings
      mockCMSService.getSettingsByTenantId.mockResolvedValue(tenantASettings);
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      const exportData = await exportImportService.exportSettings(tenantA, adminA);

      // Verify exported data structure
      expect(exportData.version).toBe('1.0');
      expect(exportData.settings).toEqual(baseSettings);

      // Step 2: Import the exported data back
      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.validateSettings.mockReturnValue([]);
      mockCMSService.upsertSettings.mockResolvedValue(tenantASettings);

      const importResult = await exportImportService.importSettings(
        tenantA,
        exportData,
        'overwrite',
        adminA
      );

      // Step 3: Verify idempotence - imported settings match original
      expect(importResult.settings_data).toEqual(baseSettings);
      expect(importResult.settings_data).toEqual(tenantASettings.settings_data);

      // Verify no data loss
      expect(importResult.settings_data.colors).toEqual(baseSettings.colors);
      expect(importResult.settings_data.typography).toEqual(baseSettings.typography);
      expect(importResult.settings_data.layout).toEqual(baseSettings.layout);
      expect(importResult.settings_data.components).toEqual(baseSettings.components);
      expect(importResult.settings_data.content).toEqual(baseSettings.content);
    });

    it('should preserve settings through multiple export-import cycles', async () => {
      // First cycle
      mockCMSService.getSettingsByTenantId.mockResolvedValue(tenantASettings);
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      const firstExport = await exportImportService.exportSettings(tenantA, adminA);

      // Import first export
      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.validateSettings.mockReturnValue([]);
      mockCMSService.upsertSettings.mockResolvedValue(tenantASettings);

      await exportImportService.importSettings(tenantA, firstExport, 'overwrite', adminA);

      // Second cycle - export should produce identical result
      const secondExport = await exportImportService.exportSettings(tenantA, adminA);

      expect(secondExport.settings).toEqual(firstExport.settings);
      expect(secondExport.version).toEqual(firstExport.version);

      // Import second export
      const secondImport = await exportImportService.importSettings(
        tenantA,
        secondExport,
        'overwrite',
        adminA
      );

      expect(secondImport.settings_data).toEqual(firstExport.settings);
    });

    it('should preserve complex nested structures through export-import', async () => {
      const complexSettings = {
        colors: {
          primary: '#3B82F6',
          secondary: '#10B981',
          accent: '#F59E0B',
          variants: {
            light: '#DBEAFE',
            dark: '#1E40AF',
          },
        },
        typography: {
          headings: {
            fontFamily: 'Poppins',
            variants: {
              h1: { fontSize: 48, fontWeight: 700 },
              h2: { fontSize: 36, fontWeight: 600 },
              h3: { fontSize: 28, fontWeight: 500 },
            },
          },
          body: {
            fontFamily: 'Inter',
            fontSize: 16,
            variants: {
              sm: { fontSize: 14 },
              lg: { fontSize: 18 },
            },
          },
        },
        content: {
          features: [
            {
              id: 'feature-1',
              title: 'Feature 1',
              description: 'Description 1',
              icon: 'icon-1',
              details: {
                category: 'core',
                priority: 1,
              },
            },
            {
              id: 'feature-2',
              title: 'Feature 2',
              description: 'Description 2',
              icon: 'icon-2',
              details: {
                category: 'advanced',
                priority: 2,
              },
            },
          ],
        },
      };

      mockCMSService.getSettingsByTenantId.mockResolvedValue({
        ...tenantASettings,
        settings_data: complexSettings,
      });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      const exportData = await exportImportService.exportSettings(tenantA, adminA);

      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.validateSettings.mockReturnValue([]);
      mockCMSService.upsertSettings.mockResolvedValue({
        ...tenantASettings,
        settings_data: complexSettings,
      });

      const importResult = await exportImportService.importSettings(
        tenantA,
        exportData,
        'overwrite',
        adminA
      );

      // Verify deep nested structures preserved
      expect(importResult.settings_data).toEqual(complexSettings);
      expect(importResult.settings_data.colors.variants).toEqual(
        complexSettings.colors.variants
      );
      expect(importResult.settings_data.typography.headings.variants).toEqual(
        complexSettings.typography.headings.variants
      );
      expect(importResult.settings_data.content.features).toEqual(
        complexSettings.content.features
      );
    });
  });

  describe('E2E: Error Scenarios', () => {
    /**
     * Validates Requirement 14: Error handling and validation
     */
    describe('Malformed Import Files', () => {
      it('should reject import with null settings object', async () => {
        const malformedData = {
          version: '1.0',
          settings: null,
        };

        mockCMSService.validateImportFile.mockReturnValue({
          valid: false,
          errors: ['Settings must be an object'],
        });

        await expect(
          exportImportService.importSettings(tenantA, malformedData, 'overwrite', adminA)
        ).rejects.toThrow(DatabaseError);
      });

      it('should reject import with undefined settings', async () => {
        const malformedData = {
          version: '1.0',
          // settings missing
        };

        mockCMSService.validateImportFile.mockReturnValue({
          valid: false,
          errors: ['Settings field required'],
        });

        await expect(
          exportImportService.importSettings(tenantA, malformedData, 'overwrite', adminA)
        ).rejects.toThrow(DatabaseError);
      });

      it('should reject import with wrong version', async () => {
        const malformedData = {
          version: '2.0', // Wrong version
          settings: baseSettings,
        };

        mockCMSService.validateImportFile.mockReturnValue({
          valid: true,
          errors: [],
        });

        const validation = exportImportService.validateImportFile(malformedData);
        expect(validation.valid).toBe(false);
        expect(validation.errors).toContain(
          'Invalid export version. Expected 1.0, got 2.0'
        );
      });

      it('should reject import missing version field', async () => {
        const malformedData = {
          // version missing
          settings: baseSettings,
        };

        mockCMSService.validateImportFile.mockReturnValue({
          valid: true,
          errors: [],
        });

        const validation = exportImportService.validateImportFile(malformedData);
        expect(validation.valid).toBe(false);
        expect(validation.errors).toContain(
          'Import data must include version field'
        );
      });
    });

    describe('Invalid Data in Import', () => {
      it('should reject import with invalid color values', async () => {
        const invalidData = {
          version: '1.0',
          settings: {
            colors: { primary: 'not-a-color' },
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
        mockCMSService.validateSettings.mockReturnValue([
          'Invalid color format: primary must be hex, RGB, or HSL',
        ]);

        await expect(
          exportImportService.importSettings(tenantA, invalidData, 'overwrite', adminA)
        ).rejects.toThrow(DatabaseError);
      });

      it('should reject import with invalid numeric spacing values', async () => {
        const invalidData = {
          version: '1.0',
          settings: {
            colors: {},
            typography: {},
            layout: {
              padding: { heroSection: 'not-a-number' }, // Invalid
            },
            components: {},
            content: {},
          },
        };

        mockCMSService.validateImportFile.mockReturnValue({
          valid: true,
          errors: [],
        });
        mockCMSService.validateSettings.mockReturnValue([
          'padding.heroSection must be a positive number',
        ]);

        await expect(
          exportImportService.importSettings(tenantA, invalidData, 'overwrite', adminA)
        ).rejects.toThrow(DatabaseError);
      });

      it('should reject import with invalid font size', async () => {
        const invalidData = {
          version: '1.0',
          settings: {
            colors: {},
            typography: {
              headings: { fontSize: { h1: -10 } }, // Negative value
            },
            layout: {},
            components: {},
            content: {},
          },
        };

        mockCMSService.validateImportFile.mockReturnValue({
          valid: true,
          errors: [],
        });
        mockCMSService.validateSettings.mockReturnValue([
          'Font sizes must be positive numbers',
        ]);

        await expect(
          exportImportService.importSettings(tenantA, invalidData, 'overwrite', adminA)
        ).rejects.toThrow(DatabaseError);
      });
    });

    describe('Merge Conflicts', () => {
      it('should handle merge when imported data conflicts with current', async () => {
        const currentSettings = {
          colors: { primary: '#000000', secondary: '#111111' },
          typography: { headings: { fontFamily: 'Arial', fontSize: 48 } },
          layout: { containerWidth: '1000px' },
        };

        const conflictingImport = {
          colors: { primary: '#FFFFFF' }, // Conflicts with primary
          typography: { headings: { fontSize: 36 } }, // Conflicts with fontSize
        };

        mockCMSService.validateImportFile.mockReturnValue({
          valid: true,
          errors: [],
        });
        mockCMSService.getSettingsByTenantId.mockResolvedValue({
          ...tenantASettings,
          settings_data: currentSettings,
        });
        mockCMSService.validateSettings.mockReturnValue([]);

        const mergedSettings = {
          colors: { primary: '#FFFFFF', secondary: '#111111' }, // Conflict resolved (imported wins)
          typography: { headings: { fontFamily: 'Arial', fontSize: 36 } }, // Conflict resolved
          layout: { containerWidth: '1000px' }, // Preserved
        };

        mockCMSService.mergeSettings.mockReturnValue(mergedSettings);
        mockCMSService.upsertSettings.mockResolvedValue({
          ...tenantASettings,
          settings_data: mergedSettings,
        });
        (supabaseAdmin.from as jest.Mock).mockReturnValue({
          insert: jest.fn().mockResolvedValue({ data: null, error: null }),
        });

        const importData = {
          version: '1.0' as const,
          exportedAt: new Date().toISOString(),
          exportedBy: adminA,
          metadata: { name: 'Conflicting Import' },
          settings: conflictingImport,
        };

        const result = await exportImportService.importSettings(
          tenantA,
          importData,
          'merge',
          adminA
        );

        expect(mockCMSService.mergeSettings).toHaveBeenCalled();
        expect(result.settings_data.colors.primary).toBe('#FFFFFF');
        expect(result.settings_data.typography.headings.fontSize).toBe(36);
        expect(result.settings_data.layout.containerWidth).toBe('1000px');
      });
    });
  });

  describe('E2E: Audit Logging', () => {
    /**
     * Validates Requirement 15: Audit logging for export/import actions
     */
    it('should create audit log for export action with correct metadata', async () => {
      mockCMSService.getSettingsByTenantId.mockResolvedValue(tenantASettings);
      const mockInsert = jest.fn().mockResolvedValue({ data: null, error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: mockInsert,
      });

      await exportImportService.exportSettings(tenantA, adminA);

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: tenantA,
          admin_id: adminA,
          action: 'export',
          resource_type: 'cms_settings',
          resource_id: null,
        })
      );

      const auditData = mockInsert.mock.calls[0][0];
      expect(auditData).toHaveProperty('timestamp');
      expect(new Date(auditData.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should create audit log for import action with merge strategy', async () => {
      const exportedData = {
        version: '1.0' as const,
        exportedAt: new Date().toISOString(),
        exportedBy: adminA,
        metadata: { name: 'Test Export', description: 'Test' },
        settings: baseSettings,
      };

      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.validateSettings.mockReturnValue([]);
      mockCMSService.upsertSettings.mockResolvedValue(tenantASettings);
      const mockInsert = jest.fn().mockResolvedValue({ data: null, error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: mockInsert,
      });

      await exportImportService.importSettings(
        tenantA,
        exportedData,
        'merge',
        adminA
      );

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: tenantA,
          admin_id: adminA,
          action: 'import',
          resource_type: 'cms_settings',
          changes: expect.objectContaining({
            mergeStrategy: 'merge',
            importedFrom: 'Test Export',
          }),
        })
      );
    });

    it('should record separate audit logs for each export/import action', async () => {
      mockCMSService.getSettingsByTenantId.mockResolvedValue(tenantASettings);
      const mockInsert = jest.fn().mockResolvedValue({ data: null, error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: mockInsert,
      });

      // First export
      await exportImportService.exportSettings(tenantA, adminA);
      expect(mockInsert).toHaveBeenCalledTimes(1);

      // Second export by different admin
      await exportImportService.exportSettings(tenantA, adminB);
      expect(mockInsert).toHaveBeenCalledTimes(2);

      // Verify separate audit entries
      const call1 = mockInsert.mock.calls[0][0];
      const call2 = mockInsert.mock.calls[1][0];

      expect(call1.admin_id).toBe(adminA);
      expect(call2.admin_id).toBe(adminB);
    });

    it('should include merge strategy details in import audit log', async () => {
      const exportedData = {
        version: '1.0' as const,
        exportedAt: new Date().toISOString(),
        exportedBy: adminA,
        metadata: { name: 'Partial Settings', description: 'Only colors' },
        settings: baseSettings,
      };

      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.validateSettings.mockReturnValue([]);
      mockCMSService.upsertSettings.mockResolvedValue(tenantASettings);
      const mockInsert = jest.fn().mockResolvedValue({ data: null, error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: mockInsert,
      });

      // Import with overwrite strategy
      await exportImportService.importSettings(
        tenantA,
        exportedData,
        'overwrite',
        adminA
      );

      const auditData = mockInsert.mock.calls[0][0];
      expect(auditData.changes).toMatchObject({
        mergeStrategy: 'overwrite',
        importedFrom: 'Partial Settings',
      });
    });

    it('should continue operation even if audit log fails', async () => {
      mockCMSService.getSettingsByTenantId.mockResolvedValue(tenantASettings);
      const mockInsert = jest.fn().mockRejectedValue(new Error('Audit service down'));
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: mockInsert,
      });

      // Should not throw despite audit failure
      const exportData = await exportImportService.exportSettings(tenantA, adminA);

      expect(exportData).toBeDefined();
      expect(exportData.version).toBe('1.0');
    });
  });

  describe('E2E: Tenant Isolation Throughout Workflow', () => {
    /**
     * Validates Requirement 2: Tenant isolation at all layers
     */
    it('should maintain tenant isolation across complete export-import cycle', async () => {
      // Tenant A exports
      mockCMSService.getSettingsByTenantId.mockResolvedValue(tenantASettings);
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      const exportData = await exportImportService.exportSettings(tenantA, adminA);

      // Verify exported data contains only Tenant A settings
      expect(mockCMSService.getSettingsByTenantId).toHaveBeenCalledWith(tenantA);
      expect(exportData.settings).toEqual(tenantASettings.settings_data);

      // Tenant B tries to import Tenant A's export
      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.validateSettings.mockReturnValue([]);
      mockCMSService.upsertSettings.mockResolvedValue(tenantBSettings);
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      const result = await exportImportService.importSettings(
        tenantB, // Different tenant
        exportData,
        'overwrite',
        adminB
      );

      // Verify import applied to Tenant B (not Tenant A)
      expect(mockCMSService.upsertSettings).toHaveBeenCalledWith(
        tenantB,
        exportData.settings,
        adminB
      );

      // Verify result is for Tenant B
      expect(result.tenant_id).toBe(tenantB);
    });

    it('should reject export without valid tenant context', async () => {
      await expect(
        exportImportService.exportSettings('', adminA)
      ).rejects.toThrow(TenantMismatchError);

      await expect(
        exportImportService.exportSettings(null as any, adminA)
      ).rejects.toThrow(TenantMismatchError);
    });

    it('should reject import without valid tenant context', async () => {
      const exportData = {
        version: '1.0' as const,
        exportedAt: new Date().toISOString(),
        exportedBy: adminA,
        metadata: { name: 'Test' },
        settings: baseSettings,
      };

      await expect(
        exportImportService.importSettings('', exportData, 'overwrite', adminA)
      ).rejects.toThrow(TenantMismatchError);

      await expect(
        exportImportService.importSettings(null as any, exportData, 'overwrite', adminA)
      ).rejects.toThrow(TenantMismatchError);
    });

    it('should validate admin context in all operations', async () => {
      mockCMSService.getSettingsByTenantId.mockResolvedValue(tenantASettings);

      await expect(
        exportImportService.exportSettings(tenantA, '')
      ).rejects.toThrow(DatabaseError);

      await expect(
        exportImportService.exportSettings(tenantA, null as any)
      ).rejects.toThrow(DatabaseError);
    });

    it('should include tenant_id and admin_id in all audit logs', async () => {
      mockCMSService.getSettingsByTenantId.mockResolvedValue(tenantASettings);
      const mockInsert = jest.fn().mockResolvedValue({ data: null, error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: mockInsert,
      });

      await exportImportService.exportSettings(tenantA, adminA);

      const auditData = mockInsert.mock.calls[0][0];
      expect(auditData).toHaveProperty('tenant_id', tenantA);
      expect(auditData).toHaveProperty('admin_id', adminA);
      expect(auditData).toHaveProperty('timestamp');
    });
  });

  describe('E2E: Complete Workflow Scenarios', () => {
    /**
     * Realistic end-to-end scenarios testing the complete feature
     */
    it('Scenario 1: Admin exports current theme, modifies on test server, reimports', async () => {
      // Step 1: Export current theme
      mockCMSService.getSettingsByTenantId.mockResolvedValue(tenantASettings);
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      const exportedTheme = await exportImportService.exportSettings(tenantA, adminA);
      expect(exportedTheme.version).toBe('1.0');

      // Step 2: Modify theme locally (simulated)
      const modifiedTheme = {
        ...exportedTheme,
        settings: {
          ...exportedTheme.settings,
          colors: {
            ...exportedTheme.settings.colors,
            primary: '#FF0000', // Changed color
          },
        },
      };

      // Step 3: Test on test server (import with merge to preserve other settings)
      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.getSettingsByTenantId.mockResolvedValue(tenantASettings);
      mockCMSService.validateSettings.mockReturnValue([]);

      const mergedResult = {
        ...tenantASettings.settings_data,
        colors: {
          ...tenantASettings.settings_data.colors,
          primary: '#FF0000',
        },
      };

      mockCMSService.mergeSettings.mockReturnValue(mergedResult);
      mockCMSService.upsertSettings.mockResolvedValue({
        ...tenantASettings,
        settings_data: mergedResult,
      });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      const testResult = await exportImportService.importSettings(
        tenantA,
        modifiedTheme,
        'merge',
        adminA
      );

      // Verify changes applied
      expect(testResult.settings_data.colors.primary).toBe('#FF0000');
      // Verify other settings preserved
      expect(testResult.settings_data.typography).toEqual(
        tenantASettings.settings_data.typography
      );
    });

    it('Scenario 2: Admin shares export with another admin who imports it', async () => {
      // Admin A exports theme
      mockCMSService.getSettingsByTenantId.mockResolvedValue(tenantASettings);
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      const sharedTheme = await exportImportService.exportSettings(tenantA, adminA);

      // Admin B imports it (same tenant)
      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.validateSettings.mockReturnValue([]);
      mockCMSService.upsertSettings.mockResolvedValue(tenantASettings);
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      const result = await exportImportService.importSettings(
        tenantA,
        sharedTheme,
        'overwrite',
        adminB
      );

      expect(result.settings_data).toEqual(sharedTheme.settings);
      // Verify import audit log shows admin B performed the action
      expect(mockCMSService.upsertSettings).toHaveBeenCalledWith(
        tenantA,
        sharedTheme.settings,
        adminB
      );
    });

    it('Scenario 3: Emergency recovery - export good backup, import to replace broken theme', async () => {
      // Step 1: Good backup was exported previously
      const backupTheme = {
        version: '1.0' as const,
        exportedAt: '2024-01-01T00:00:00Z',
        exportedBy: adminA,
        metadata: { name: 'Good Backup 2024-01-01', description: 'Last known good state' },
        settings: baseSettings,
      };

      // Step 2: Current settings are broken (invalid)
      mockCMSService.getSettingsByTenantId.mockResolvedValue({
        ...tenantASettings,
        settings_data: { colors: { primary: 'invalid' } }, // Broken
      });

      // Step 3: Import backup with overwrite to recover
      mockCMSService.validateImportFile.mockReturnValue({
        valid: true,
        errors: [],
      });
      mockCMSService.validateSettings.mockReturnValue([]); // Backup is valid
      mockCMSService.upsertSettings.mockResolvedValue({
        ...tenantASettings,
        settings_data: backupTheme.settings,
      });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      const recoveredResult = await exportImportService.importSettings(
        tenantA,
        backupTheme,
        'overwrite',
        adminA
      );

      expect(recoveredResult.settings_data).toEqual(backupTheme.settings);
      // Verify audit log records recovery
      const mockInsert = (supabaseAdmin.from as jest.Mock).mock.results[0].value.insert;
      expect(mockInsert).toHaveBeenCalled();
    });
  });
});
