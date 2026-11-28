import { ThemePresetService, ThemePreset } from './ThemePresetService';
import { CMSSettingsService, TenantMismatchError } from './CMSSettingsService';
import { DatabaseError } from '@/lib/db';
import { supabaseAdmin } from '@/lib/supabase-admin';

// Mock supabaseAdmin and CMSSettingsService
jest.mock('@/lib/supabase-admin');
jest.mock('./CMSSettingsService');

describe('ThemePresetService', () => {
  let service: ThemePresetService;
  let mockCmsService: jest.Mocked<CMSSettingsService>;
  let mockSupabaseAdmin: jest.Mocked<any>;

  // Test data
  const mockPreset1: ThemePreset = {
    id: 'preset-1',
    name: 'Modern Minimal',
    description: 'Clean and contemporary design',
    category: 'modern',
    preset_data: {
      colors: { primary: '#1F2937', secondary: '#10B981', accent: '#F59E0B' },
      typography: { headings: { fontFamily: 'Poppins', fontSize: { h1: 48 } } },
    },
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    is_active: true,
  };

  const mockPreset2: ThemePreset = {
    id: 'preset-2',
    name: 'Corporate',
    description: 'Professional corporate design',
    category: 'corporate',
    preset_data: {
      colors: { primary: '#003A70', secondary: '#FFFFFF' },
    },
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    is_active: true,
  };

  const inactivePreset: ThemePreset = {
    id: 'preset-inactive',
    name: 'Old Preset',
    description: 'Inactive preset',
    category: 'deprecated',
    preset_data: { colors: { primary: '#999999' } },
    created_at: '2023-01-01T00:00:00Z',
    updated_at: '2023-01-01T00:00:00Z',
    is_active: false,
  };

  const mockCmsSettings = {
    id: 'cms-settings-1',
    tenant_id: 'tenant-123',
    settings_data: mockPreset1.preset_data,
    created_at: '2024-01-01T10:00:00Z',
    updated_at: '2024-01-01T10:00:00Z',
    updated_by_admin_id: 'admin-123',
  };

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock CMS service
    mockCmsService = jest.mocked(new CMSSettingsService());
    mockCmsService.upsertSettings = jest
      .fn()
      .mockResolvedValue(mockCmsSettings);

    // Create service with mocked CMS service
    service = new ThemePresetService(mockCmsService);

    // Mock supabaseAdmin
    mockSupabaseAdmin = supabaseAdmin as jest.Mocked<any>;
  });

  // ============================================================================
  // getAllActivePresets() Tests
  // ============================================================================

  describe('getAllActivePresets()', () => {
    it('should return all active presets sorted by creation date descending', async () => {
      // Arrange
      const mockResponse = {
        data: [mockPreset2, mockPreset1], // Newer first
        error: null,
      };

      mockSupabaseAdmin.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue(mockResponse),
          }),
        }),
      });

      // Act
      const result = await service.getAllActivePresets();

      // Assert
      expect(result).toEqual([mockPreset2, mockPreset1]);
      expect(result.length).toBe(2);
      expect(result[0].name).toBe('Corporate');
      expect(result[1].name).toBe('Modern Minimal');

      // Verify correct query was made
      expect(mockSupabaseAdmin.from).toHaveBeenCalledWith('theme_presets');
    });

    it('should filter by is_active = true', async () => {
      // Arrange
      const mockResponse = { data: [mockPreset1], error: null };
      const mockSelect = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          order: jest.fn().mockResolvedValue(mockResponse),
        }),
      });

      mockSupabaseAdmin.from.mockReturnValue({
        select: mockSelect,
      });

      // Act
      await service.getAllActivePresets();

      // Assert - Verify is_active = true filter was applied
      const eqCall = mockSelect.mock.results[0].value.eq;
      expect(eqCall).toHaveBeenCalledWith('is_active', true);
    });

    it('should return empty array if no active presets found', async () => {
      // Arrange
      const mockResponse = { data: [], error: null };
      mockSupabaseAdmin.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue(mockResponse),
          }),
        }),
      });

      // Act
      const result = await service.getAllActivePresets();

      // Assert
      expect(result).toEqual([]);
    });

    it('should throw DatabaseError if query fails', async () => {
      // Arrange
      const mockError = { message: 'Database connection failed', code: 'DB_ERROR' };
      mockSupabaseAdmin.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({
              data: null,
              error: mockError,
            }),
          }),
        }),
      });

      // Act & Assert
      await expect(service.getAllActivePresets()).rejects.toThrow(DatabaseError);
    });

    it('should handle unexpected errors gracefully', async () => {
      // Arrange
      mockSupabaseAdmin.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockRejectedValue(new Error('Unexpected error')),
          }),
        }),
      });

      // Act & Assert
      await expect(service.getAllActivePresets()).rejects.toThrow(DatabaseError);
    });
  });

  // ============================================================================
  // getPresetById() Tests
  // ============================================================================

  describe('getPresetById()', () => {
    it('should return a specific preset by ID if active', async () => {
      // Arrange
      const mockResponse = { data: mockPreset1, error: null };
      const mockMaybeSingle = jest.fn().mockResolvedValue(mockResponse);
      const mockEq2 = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });

      mockSupabaseAdmin.from.mockReturnValue({ select: mockSelect });

      // Act
      const result = await service.getPresetById('preset-1');

      // Assert
      expect(result).toEqual(mockPreset1);
      expect(result?.name).toBe('Modern Minimal');
    });

    it('should filter by both id and is_active = true', async () => {
      // Arrange
      const mockResponse = { data: mockPreset1, error: null };
      const mockMaybeSingle = jest.fn().mockResolvedValue(mockResponse);
      const mockEq2 = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });

      mockSupabaseAdmin.from.mockReturnValue({ select: mockSelect });

      // Act
      await service.getPresetById('preset-1');

      // Assert - Verify filters applied
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq1).toHaveBeenCalledWith('id', 'preset-1');
      expect(mockEq2).toHaveBeenCalledWith('is_active', true);
    });

    it('should return null if preset is inactive', async () => {
      // Arrange
      const mockResponse = { data: null, error: null };
      const mockMaybeSingle = jest.fn().mockResolvedValue(mockResponse);
      const mockEq2 = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });

      mockSupabaseAdmin.from.mockReturnValue({ select: mockSelect });

      // Act
      const result = await service.getPresetById('preset-inactive');

      // Assert
      expect(result).toBeNull();
    });

    it('should return null if preset not found', async () => {
      // Arrange
      const mockResponse = { data: null, error: null };
      const mockMaybeSingle = jest.fn().mockResolvedValue(mockResponse);
      const mockEq2 = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });

      mockSupabaseAdmin.from.mockReturnValue({ select: mockSelect });

      // Act
      const result = await service.getPresetById('nonexistent-preset');

      // Assert
      expect(result).toBeNull();
    });

    it('should throw DatabaseError if preset_id is invalid', async () => {
      // Act & Assert
      await expect(service.getPresetById('')).rejects.toThrow(DatabaseError);
      await expect(service.getPresetById(null as any)).rejects.toThrow(DatabaseError);
      await expect(service.getPresetById(undefined as any)).rejects.toThrow(DatabaseError);
    });

    it('should throw DatabaseError if query fails', async () => {
      // Arrange
      const mockError = { message: 'Database connection failed', code: 'DB_ERROR' };
      mockSupabaseAdmin.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest
            .fn()
            .mockReturnValueOnce({
              eq: jest.fn().mockResolvedValue({
                data: null,
                error: mockError,
              }),
            }),
        }),
      });

      // Act & Assert
      await expect(service.getPresetById('preset-1')).rejects.toThrow(DatabaseError);
    });
  });

  // ============================================================================
  // applyPreset() Tests - Tenant Isolation & Independence
  // ============================================================================

  describe('applyPreset()', () => {
    it('should apply preset as tenant-specific customization', async () => {
      // Arrange
      const tenantId = 'tenant-123';
      const adminId = 'admin-456';

      // Act
      const result = await service.applyPreset(tenantId, mockPreset1.preset_data, adminId);

      // Assert
      expect(mockCmsService.upsertSettings).toHaveBeenCalledWith(
        tenantId,
        mockPreset1.preset_data,
        adminId
      );
      expect(result).toEqual(mockCmsSettings);
    });

    it('should call CMSSettingsService.upsertSettings which enforces tenant isolation', async () => {
      // Arrange
      const tenantId = 'tenant-abc';
      const adminId = 'admin-xyz';
      const presetData = { colors: { primary: '#FF0000' } };

      // Act
      await service.applyPreset(tenantId, presetData, adminId);

      // Assert
      // Verify CMSSettingsService.upsertSettings was called with tenant_id
      // This service creates/updates cms_settings with UNIQUE constraint on tenant_id
      // ensuring each tenant gets their own isolated copy
      expect(mockCmsService.upsertSettings).toHaveBeenCalledWith(
        tenantId,
        presetData,
        adminId
      );
    });

    it('should handle multiple tenants applying same preset independently', async () => {
      // Arrange
      const tenant1Settings = {
        id: 'cms-1',
        tenant_id: 'tenant-1',
        settings_data: mockPreset1.preset_data,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        updated_by_admin_id: 'admin-1',
      };

      const tenant2Settings = {
        id: 'cms-2',
        tenant_id: 'tenant-2',
        settings_data: mockPreset1.preset_data,
        created_at: '2024-01-01T01:00:00Z',
        updated_at: '2024-01-01T01:00:00Z',
        updated_by_admin_id: 'admin-2',
      };

      // Setup mock to return different settings for different tenants
      mockCmsService.upsertSettings = jest
        .fn()
        .mockResolvedValueOnce(tenant1Settings)
        .mockResolvedValueOnce(tenant2Settings);

      // Act - Tenant 1 applies preset
      const result1 = await service.applyPreset('tenant-1', mockPreset1.preset_data, 'admin-1');

      // Act - Tenant 2 applies same preset
      const result2 = await service.applyPreset('tenant-2', mockPreset1.preset_data, 'admin-2');

      // Assert
      // Each tenant has their own CMS settings record
      expect(result1.tenant_id).toBe('tenant-1');
      expect(result2.tenant_id).toBe('tenant-2');

      // But both have the same customization data (independent copies)
      expect(result1.settings_data).toEqual(result2.settings_data);

      // Verify upsertSettings was called twice with different tenant IDs
      expect(mockCmsService.upsertSettings).toHaveBeenCalledTimes(2);
      expect(mockCmsService.upsertSettings).toHaveBeenNthCalledWith(
        1,
        'tenant-1',
        mockPreset1.preset_data,
        'admin-1'
      );
      expect(mockCmsService.upsertSettings).toHaveBeenNthCalledWith(
        2,
        'tenant-2',
        mockPreset1.preset_data,
        'admin-2'
      );
    });

    it('should throw TenantMismatchError if tenant_id is missing', async () => {
      // Reset mock before test
      jest.clearAllMocks();
      
      // Act & Assert
      // Empty string should be caught
      try {
        await service.applyPreset('', mockPreset1.preset_data, 'admin-123');
        throw new Error('Should have thrown TenantMismatchError');
      } catch (error) {
        expect(error).toBeInstanceOf(TenantMismatchError);
      }
      
      // Null should be caught
      try {
        await service.applyPreset(null as any, mockPreset1.preset_data, 'admin-123');
        throw new Error('Should have thrown TenantMismatchError');
      } catch (error) {
        expect(error).toBeInstanceOf(TenantMismatchError);
      }
      
      // Undefined should be caught
      try {
        await service.applyPreset(undefined as any, mockPreset1.preset_data, 'admin-123');
        throw new Error('Should have thrown TenantMismatchError');
      } catch (error) {
        expect(error).toBeInstanceOf(TenantMismatchError);
      }
      
      // Verify CMSSettingsService was never called for invalid tenants
      expect(mockCmsService.upsertSettings).not.toHaveBeenCalled();
    });

    it('should throw TenantMismatchError if admin_id is invalid', async () => {
      // Reset mock before test
      jest.clearAllMocks();
      
      // Act & Assert
      // Empty string should be caught
      try {
        await service.applyPreset('tenant-123', mockPreset1.preset_data, '');
        throw new Error('Should have thrown TenantMismatchError');
      } catch (error) {
        expect(error).toBeInstanceOf(TenantMismatchError);
      }
      
      // Null should be caught
      try {
        await service.applyPreset('tenant-123', mockPreset1.preset_data, null as any);
        throw new Error('Should have thrown TenantMismatchError');
      } catch (error) {
        expect(error).toBeInstanceOf(TenantMismatchError);
      }
      
      // Undefined should be caught
      try {
        await service.applyPreset('tenant-123', mockPreset1.preset_data, undefined as any);
        throw new Error('Should have thrown TenantMismatchError');
      } catch (error) {
        expect(error).toBeInstanceOf(TenantMismatchError);
      }
      
      // Verify CMSSettingsService was never called for invalid admin
      expect(mockCmsService.upsertSettings).not.toHaveBeenCalled();
    });

    it('should throw DatabaseError if preset_data is invalid', async () => {
      // Act & Assert
      await expect(service.applyPreset('tenant-123', null as any, 'admin-123')).rejects.toThrow(
        DatabaseError
      );
      await expect(
        service.applyPreset('tenant-123', undefined as any, 'admin-123')
      ).rejects.toThrow(DatabaseError);
      await expect(service.applyPreset('tenant-123', 'not-an-object' as any, 'admin-123')).rejects.toThrow(
        DatabaseError
      );
    });

    it('should propagate TenantMismatchError from CMSSettingsService', async () => {
      // Reset mock before test
      jest.clearAllMocks();
      
      // Arrange
      mockCmsService.upsertSettings.mockRejectedValueOnce(
        new TenantMismatchError('Tenant context validation failed')
      );

      // Act & Assert
      try {
        await service.applyPreset('tenant-123', mockPreset1.preset_data, 'admin-123');
        throw new Error('Should have thrown TenantMismatchError');
      } catch (error) {
        expect(error).toBeInstanceOf(TenantMismatchError);
      }
      
      // Verify CMSSettingsService was called before the error
      expect(mockCmsService.upsertSettings).toHaveBeenCalledWith(
        'tenant-123',
        mockPreset1.preset_data,
        'admin-123'
      );
    });

    it('should propagate DatabaseError from CMSSettingsService', async () => {
      // Arrange
      mockCmsService.upsertSettings.mockRejectedValue(
        new DatabaseError('Failed to upsert settings')
      );

      // Act & Assert
      await expect(
        service.applyPreset('tenant-123', mockPreset1.preset_data, 'admin-123')
      ).rejects.toThrow(DatabaseError);
    });

    it('should handle unexpected errors from CMSSettingsService', async () => {
      // Arrange
      mockCmsService.upsertSettings.mockRejectedValue(new Error('Unexpected error'));

      // Act & Assert
      await expect(
        service.applyPreset('tenant-123', mockPreset1.preset_data, 'admin-123')
      ).rejects.toThrow(DatabaseError);
    });
  });

  // ============================================================================
  // Property-Based Tests
  // ============================================================================

  describe('Property-Based Tests', () => {
    /**
     * **Validates: Requirements 10.1, 10.2**
     *
     * Property: Preset Retrieval Consistency
     * All fetched presets are active (is_active = true)
     */
    it('should only return active presets (Property: Preset Activity Consistency)', async () => {
      // Arrange
      const mockResponse = {
        data: [mockPreset1, mockPreset2],
        error: null,
      };

      mockSupabaseAdmin.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue(mockResponse),
          }),
        }),
      });

      // Act
      const result = await service.getAllActivePresets();

      // Assert - All presets must be active
      result.forEach((preset) => {
        expect(preset.is_active).toBe(true);
      });
    });

    /**
     * **Validates: Requirements 10.3, 10.4, 2.8**
     *
     * Property: Tenant Isolation on Preset Application
     * When Tenant A applies a preset, Tenant B's existing customizations are unaffected.
     * Each application is independent and creates separate records.
     */
    it('should maintain tenant isolation when multiple tenants apply presets', async () => {
      // Arrange - Setup tenants with existing settings
      const tenant1 = 'tenant-alpha';
      const tenant2 = 'tenant-beta';
      const admin1 = 'admin-1';
      const admin2 = 'admin-2';

      const tenant1SettingsBefore = {
        id: 'cms-alpha',
        tenant_id: tenant1,
        settings_data: { colors: { primary: '#OLD1111' } },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        updated_by_admin_id: admin1,
      };

      const tenant2SettingsBefore = {
        id: 'cms-beta',
        tenant_id: tenant2,
        settings_data: { colors: { primary: '#OLD2222' } },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        updated_by_admin_id: admin2,
      };

      const tenant1SettingsAfterPreset = {
        ...tenant1SettingsBefore,
        settings_data: mockPreset1.preset_data,
        updated_at: '2024-01-01T10:00:00Z',
      };

      const tenant2SettingsUnchanged = tenant2SettingsBefore; // Not affected

      // Setup mock responses
      mockCmsService.upsertSettings = jest
        .fn()
        .mockResolvedValueOnce(tenant1SettingsAfterPreset);

      // Act - Only Tenant 1 applies preset
      await service.applyPreset(tenant1, mockPreset1.preset_data, admin1);

      // Assert - Verify Tenant 1 was affected
      expect(mockCmsService.upsertSettings).toHaveBeenCalledWith(
        tenant1,
        mockPreset1.preset_data,
        admin1
      );

      // Assert - Verify Tenant 2 was never called (remaining unaffected)
      expect(mockCmsService.upsertSettings).toHaveBeenCalledTimes(1);
    });

    /**
     * **Validates: Requirements 10.3, 10.4**
     *
     * Property: Preset Application Determinism
     * Applying the same preset multiple times with same tenant/admin produces consistent results.
     * The preset_data remains unchanged (deterministic application).
     */
    it('should apply preset deterministically (same preset = same result)', async () => {
      // Arrange
      const tenantId = 'tenant-det';
      const adminId = 'admin-det';
      const presetData = mockPreset1.preset_data;

      const expectedResult1 = {
        ...mockCmsSettings,
        tenant_id: tenantId,
        settings_data: presetData,
      };

      const expectedResult2 = {
        ...mockCmsSettings,
        tenant_id: tenantId,
        settings_data: presetData,
        updated_at: '2024-01-01T11:00:00Z', // Later timestamp but same data
      };

      mockCmsService.upsertSettings = jest
        .fn()
        .mockResolvedValueOnce(expectedResult1)
        .mockResolvedValueOnce(expectedResult2);

      // Act - Apply same preset twice
      const result1 = await service.applyPreset(tenantId, presetData, adminId);
      const result2 = await service.applyPreset(tenantId, presetData, adminId);

      // Assert - Both results have same preset data
      expect(result1.settings_data).toEqual(result2.settings_data);
      expect(result1.settings_data).toEqual(presetData);
      expect(result2.settings_data).toEqual(presetData);
    });
  });
});
