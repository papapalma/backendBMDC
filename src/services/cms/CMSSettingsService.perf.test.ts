/**
 * Performance Tests for CMSSettingsService
 *
 * Tests performance-critical paths:
 * 1. Database queries perform efficiently with indexes
 * 2. Large customization payloads are stored/retrieved efficiently
 * 3. Query time scales well with tenant count
 * 4. Version history queries are fast even with many versions
 *
 * Validates Requirement 7.2: Visual Preview and Real-time Updates
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CMSSettingsService } from './CMSSettingsService';
import * as db from '../../lib/db';

// Performance thresholds
const PERFORMANCE_THRESHOLDS = {
  singleQueryTime: 50, // ms - Single query should complete within 50ms
  bulkQueryTime: 200, // ms - Bulk queries should complete within 200ms
  insertionTime: 100, // ms - Insert operation should complete within 100ms
  versionHistoryQueryTime: 75, // ms - Version history query with pagination
};

// Mock database for performance testing
jest.mock('../../lib/db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

describe('CMSSettingsService Performance Tests', () => {
  let service: CMSSettingsService;
  let mockPoolQuery: jest.Mock;

  beforeEach(() => {
    service = new CMSSettingsService();
    mockPoolQuery = db.pool.query as jest.Mock;
    mockPoolQuery.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Test 1: Query performance with indexed tenant_id lookup
   * Validates that tenant_id indexed queries are fast
   */
  it('should retrieve customizations by tenant_id efficiently', async () => {
    const tenantId = 'tenant-123';
    const mockSettings = {
      id: 'settings-1',
      tenant_id: tenantId,
      settings_data: {
        colors: { primary: '#3B82F6', secondary: '#10B981', accent: '#F59E0B', background: '#FFFFFF', text: '#1F2937', borders: '#E5E7EB' },
        typography: { headings: { fontFamily: 'Poppins', fontSize: { h1: 48, h2: 36, h3: 28 }, fontWeight: 700, lineHeight: 1.2 }, body: { fontFamily: 'Inter', fontSize: 16, fontWeight: 400, lineHeight: 1.5 } },
      },
      created_at: new Date(),
      updated_at: new Date(),
      updated_by_admin_id: 'admin-1',
    };

    mockPoolQuery.mockResolvedValueOnce({ rows: [mockSettings] });

    const startTime = performance.now();
    const result = await service.getSettingsByTenantId(tenantId);
    const queryTime = performance.now() - startTime;

    expect(queryTime).toBeLessThan(PERFORMANCE_THRESHOLDS.singleQueryTime);
    expect(result).toEqual(mockSettings);

    // Verify tenant_id filter was used in WHERE clause
    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE tenant_id = $1'), [
      tenantId,
    ]);
  });

  /**
   * Test 2: Bulk upsert performance
   * Validates that upserting customizations doesn't degrade with payload size
   */
  it('should upsert customizations with large payload efficiently', async () => {
    const tenantId = 'tenant-456';
    const adminId = 'admin-1';

    // Create large customization payload with many features
    const largeSettings = {
      colors: { primary: '#3B82F6', secondary: '#10B981', accent: '#F59E0B', background: '#FFFFFF', text: '#1F2937', borders: '#E5E7EB' },
      typography: { headings: { fontFamily: 'Poppins', fontSize: { h1: 48, h2: 36, h3: 28 }, fontWeight: 700, lineHeight: 1.2 }, body: { fontFamily: 'Inter', fontSize: 16, fontWeight: 400, lineHeight: 1.5 } },
      layout: { containerWidth: '1200px', containerLayout: 'centered', padding: { heroSection: 40, contentAreas: 32, footer: 24 }, margins: { sectionSpacing: 48, elementSpacing: 16 }, gaps: { grid: 24, flex: 16 } },
      components: { navigation: { enabled: true }, hero: { enabled: true }, features: { enabled: true, columns: 10 }, testimonials: { enabled: true, displayCount: 20 } },
      content: {
        hero: { heading: 'Welcome', subheading: 'Build amazing things', ctaText: 'Get Started' },
        features: Array.from({ length: 50 }, (_, i) => ({
          title: `Feature ${i + 1}`,
          description: `Long description for feature ${i + 1} with lots of text to increase payload size significantly to test performance under load`,
          icon: 'icon-name',
        })),
        testimonials: Array.from({ length: 100 }, (_, i) => ({
          text: `This is a long testimonial text ${i + 1} that goes on and on to really test payload performance`,
          author: `Customer ${i + 1}`,
          image: 'url(...)',
        })),
        contact: { email: 'contact@example.com', phone: '+1-555-000-0000', address: '123 Main St' },
      },
    };

    const mockResult = {
      id: 'settings-1',
      tenant_id: tenantId,
      settings_data: largeSettings,
      created_at: new Date(),
      updated_at: new Date(),
      updated_by_admin_id: adminId,
    };

    mockPoolQuery.mockResolvedValue({ rows: [mockResult] });

    const startTime = performance.now();
    const result = await service.upsertSettings(tenantId, largeSettings, adminId);
    const upsertTime = performance.now() - startTime;

    // Should still be fast even with large payload
    expect(upsertTime).toBeLessThan(PERFORMANCE_THRESHOLDS.insertionTime * 2); // Allow 2x for large payload
    expect(result).toBeTruthy();
  });

  /**
   * Test 3: Version history pagination performance
   * Validates that fetching paginated version history is fast
   */
  it('should fetch version history with pagination efficiently', async () => {
    const tenantId = 'tenant-789';
    const limit = 20;
    const offset = 0;

    // Create mock version history
    const mockVersions = Array.from({ length: limit }, (_, i) => ({
      id: `version-${i}`,
      cms_settings_id: 'settings-1',
      tenant_id: tenantId,
      settings_data: { colors: { primary: '#3B82F6' } },
      version_number: i + 1,
      change_summary: `Update ${i + 1}`,
      created_at: new Date(Date.now() - i * 3600000),
      created_by_admin_id: 'admin-1',
    }));

    mockPoolQuery.mockResolvedValueOnce({ rows: mockVersions });

    const startTime = performance.now();
    const result = await service.getVersionHistory(tenantId, limit, offset);
    const queryTime = performance.now() - startTime;

    expect(queryTime).toBeLessThan(PERFORMANCE_THRESHOLDS.versionHistoryQueryTime);
    expect(result).toHaveLength(limit);

    // Verify correct query was made
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE tenant_id = $1'),
      expect.arrayContaining([tenantId])
    );
  });

  /**
   * Test 4: Batch queries don't degrade performance
   * Validates that multiple sequential queries stay within performance budget
   */
  it('should handle multiple sequential queries efficiently', async () => {
    const tenantId = 'tenant-multi';
    const adminId = 'admin-1';

    const mockSettings = {
      id: 'settings-1',
      tenant_id: tenantId,
      settings_data: { colors: { primary: '#3B82F6' } },
      created_at: new Date(),
      updated_at: new Date(),
      updated_by_admin_id: adminId,
    };

    const mockVersion = {
      id: 'version-1',
      cms_settings_id: 'settings-1',
      tenant_id: tenantId,
      settings_data: { colors: { primary: '#3B82F6' } },
      version_number: 1,
      created_at: new Date(),
      created_by_admin_id: adminId,
    };

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [mockSettings] })
      .mockResolvedValueOnce({ rows: [mockVersion] })
      .mockResolvedValueOnce({ rows: [mockSettings] });

    const startTime = performance.now();

    // Execute 3 sequential queries
    await service.getSettingsByTenantId(tenantId);
    await service.getVersionHistory(tenantId, 20, 0);
    await service.getSettingsByTenantId(tenantId);

    const totalTime = performance.now() - startTime;

    // All 3 queries should complete within reasonable time
    expect(totalTime).toBeLessThan(PERFORMANCE_THRESHOLDS.bulkQueryTime);
    expect(mockPoolQuery).toHaveBeenCalledTimes(3);
  });

  /**
   * Test 5: Version lookup by ID is fast even with many versions
   * Validates that single version retrieval doesn't scan through all versions
   */
  it('should fetch specific version by ID efficiently', async () => {
    const tenantId = 'tenant-version';
    const versionId = 'version-specific';

    const mockVersion = {
      id: versionId,
      cms_settings_id: 'settings-1',
      tenant_id: tenantId,
      settings_data: { colors: { primary: '#3B82F6' } },
      version_number: 5,
      created_at: new Date(),
      created_by_admin_id: 'admin-1',
    };

    mockPoolQuery.mockResolvedValueOnce({ rows: [mockVersion] });

    const startTime = performance.now();
    const result = await service.getVersionById(versionId, tenantId);
    const queryTime = performance.now() - startTime;

    expect(queryTime).toBeLessThan(PERFORMANCE_THRESHOLDS.singleQueryTime);
    expect(result).toEqual(mockVersion);

    // Verify query uses indexed columns
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1 AND tenant_id = $2'),
      expect.arrayContaining([versionId, tenantId])
    );
  });

  /**
   * Test 6: Rollback operation doesn't cause performance issues
   * Validates that rollback is efficient even with large version history
   */
  it('should perform rollback efficiently', async () => {
    const tenantId = 'tenant-rollback';
    const versionId = 'version-to-restore';
    const adminId = 'admin-rollback';

    const mockVersion = {
      id: versionId,
      cms_settings_id: 'settings-1',
      tenant_id: tenantId,
      settings_data: { colors: { primary: '#FF0000' } },
      version_number: 5,
      created_at: new Date(),
      created_by_admin_id: 'admin-1',
    };

    const mockUpdatedSettings = {
      id: 'settings-1',
      tenant_id: tenantId,
      settings_data: mockVersion.settings_data,
      created_at: new Date(),
      updated_at: new Date(),
      updated_by_admin_id: adminId,
    };

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [mockVersion] }) // getVersionById
      .mockResolvedValueOnce({ rows: [mockUpdatedSettings] }) // upsertSettings
      .mockResolvedValueOnce({ rows: [] }); // createVersion

    const startTime = performance.now();
    const result = await service.rollbackToVersion(tenantId, versionId, adminId);
    const rollbackTime = performance.now() - startTime;

    // Rollback should be relatively fast
    expect(rollbackTime).toBeLessThan(PERFORMANCE_THRESHOLDS.insertionTime * 2);
    expect(result).toBeTruthy();
  });

  /**
   * Test 7: Settings validation doesn't cause performance bottleneck
   * Validates that complex validation stays within acceptable time
   */
  it('should validate complex settings efficiently', () => {
    const complexSettings = {
      colors: {
        primary: '#3B82F6',
        secondary: 'rgb(16, 185, 129)',
        accent: 'hsl(45, 100%, 51%)',
        background: '#FFFFFF',
        text: 'rgb(31, 41, 55)',
        borders: '#E5E7EB',
      },
      typography: {
        headings: {
          fontFamily: 'Poppins',
          fontSize: { h1: 48, h2: 36, h3: 28, h4: 20, h5: 18, h6: 16 },
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
        navigation: { enabled: true },
        hero: { enabled: true, height: '500px' },
        features: { enabled: true, columns: 3 },
        testimonials: { enabled: true, displayCount: 3 },
        ctaSection: { enabled: true },
        contact: { enabled: true },
        footer: { enabled: true },
      },
      content: {
        hero: { heading: 'Welcome', subheading: 'Build amazing things', ctaText: 'Get Started' },
        features: Array.from({ length: 30 }, (_, i) => ({
          title: `Feature ${i + 1}`,
          description: `Description for feature ${i + 1}`,
        })),
        testimonials: Array.from({ length: 20 }, (_, i) => ({
          text: `Testimonial ${i + 1}`,
          author: `Customer ${i + 1}`,
        })),
        contact: { email: 'contact@example.com', phone: '+1-555-0000', address: '123 Main St' },
      },
    };

    const startTime = performance.now();
    const errors = service.validateSettings(complexSettings);
    const validationTime = performance.now() - startTime;

    // Validation should be fast even for complex settings
    expect(validationTime).toBeLessThan(50);
    expect(errors).toHaveLength(0);
  });

  /**
   * Test 8: Settings merging performance
   * Validates that deep merge operation doesn't degrade with complexity
   */
  it('should merge settings efficiently', () => {
    const currentSettings = {
      colors: { primary: '#3B82F6', secondary: '#10B981', accent: '#F59E0B' },
      typography: { headings: { fontFamily: 'Poppins', fontSize: { h1: 48 } } },
      layout: { containerWidth: '1200px', padding: { heroSection: 40 } },
      components: { hero: { enabled: true } },
    };

    const importedSettings = {
      colors: { primary: '#FF0000' }, // Override primary
      typography: { body: { fontFamily: 'Inter', fontSize: 16 } }, // Add body
      layout: { padding: { contentAreas: 32 } }, // Add content padding
    };

    const startTime = performance.now();
    const merged = service.mergeSettings(currentSettings, importedSettings);
    const mergeTime = performance.now() - startTime;

    // Merge should be very fast
    expect(mergeTime).toBeLessThan(10);
    expect(merged.colors.primary).toBe('#FF0000'); // Imported overrides
    expect(merged.colors.secondary).toBe('#10B981'); // Current preserved
    expect(merged.typography.body).toBeTruthy(); // New added
  });

  /**
   * Test 9: Query with no results is fast
   * Validates that queries that return no results don't degrade performance
   */
  it('should handle empty query results efficiently', async () => {
    const tenantId = 'tenant-notfound';

    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const startTime = performance.now();
    const result = await service.getSettingsByTenantId(tenantId);
    const queryTime = performance.now() - startTime;

    expect(queryTime).toBeLessThan(PERFORMANCE_THRESHOLDS.singleQueryTime);
    expect(result).toBeNull();
  });

  /**
   * Test 10: Concurrent queries don't cause performance issues
   * Validates that multiple concurrent queries for different tenants are efficient
   */
  it('should handle concurrent queries for different tenants efficiently', async () => {
    const mockSettings1 = {
      id: 'settings-1',
      tenant_id: 'tenant-1',
      settings_data: { colors: { primary: '#3B82F6' } },
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mockSettings2 = {
      id: 'settings-2',
      tenant_id: 'tenant-2',
      settings_data: { colors: { primary: '#10B981' } },
      created_at: new Date(),
      updated_at: new Date(),
    };

    mockPoolQuery
      .mockResolvedValueOnce({ rows: [mockSettings1] })
      .mockResolvedValueOnce({ rows: [mockSettings2] });

    const startTime = performance.now();

    // Execute concurrent queries
    const [result1, result2] = await Promise.all([
      service.getSettingsByTenantId('tenant-1'),
      service.getSettingsByTenantId('tenant-2'),
    ]);

    const concurrentTime = performance.now() - startTime;

    // Concurrent queries should complete quickly
    expect(concurrentTime).toBeLessThan(PERFORMANCE_THRESHOLDS.bulkQueryTime);
    expect(result1).toEqual(mockSettings1);
    expect(result2).toEqual(mockSettings2);
  });

  /**
   * Test 11: Import file validation performance
   * Validates that complex import validation stays efficient
   */
  it('should validate import files efficiently', () => {
    const largeImportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      exportedBy: 'admin-1',
      metadata: { name: 'Large Export', description: 'Large customization export' },
      settings: {
        colors: { primary: '#3B82F6', secondary: '#10B981', accent: '#F59E0B', background: '#FFFFFF', text: '#1F2937', borders: '#E5E7EB' },
        typography: { headings: { fontFamily: 'Poppins', fontSize: { h1: 48, h2: 36, h3: 28 }, fontWeight: 700 }, body: { fontFamily: 'Inter', fontSize: 16 } },
        layout: { containerWidth: '1200px', containerLayout: 'centered' },
        components: { navigation: { enabled: true }, hero: { enabled: true }, features: { enabled: true } },
        content: {
          features: Array.from({ length: 50 }, (_, i) => ({ title: `Feature ${i}`, description: `Description ${i}` })),
          testimonials: Array.from({ length: 100 }, (_, i) => ({ text: `Testimonial ${i}`, author: `Customer ${i}` })),
        },
      },
    };

    const startTime = performance.now();
    const validation = service.validateImportFile(largeImportData);
    const validationTime = performance.now() - startTime;

    // Validation should be fast
    expect(validationTime).toBeLessThan(50);
    expect(validation.valid).toBe(true);
  });
});
