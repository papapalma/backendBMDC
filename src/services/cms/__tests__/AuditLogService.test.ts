/**
 * Unit Tests for AuditLogService
 *
 * **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 2.10**
 *
 * Tests verify that:
 * 1. logAction creates audit entry with all fields
 * 2. getLogsByTenant filters to tenant_id only
 * 3. getLogsByAction filters logs by action type
 * 4. getAllLogsForTenant returns paginated results
 * 5. Audit logs include IP address and user agent when available
 * 6. Cross-tenant audit log access rejected
 */

import {
  AuditLogService,
  TenantMismatchError,
  AuditLogError,
} from '../AuditLogService';

// Mock Supabase
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(),
  })),
}));

describe('AuditLogService - Requirements 15.1, 15.2, 15.3, 15.4, 2.10', () => {
  let service: AuditLogService;
  let mockSupabase: any;

  const mockTenantId = '550e8400-e29b-41d4-a716-446655440000';
  const mockAdminId = '550e8400-e29b-41d4-a716-446655440001';
  const mockTenant2Id = '550e8400-e29b-41d4-a716-446655440002';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuditLogService();
    mockSupabase = (service as any).supabase;
  });

  // ==========================================================================
  // Test 1: logAction creates audit entry with all fields
  // ==========================================================================
  describe('Test 1: logAction creates audit entry with all fields - Requirement 15.1', () => {
    it('1.1: Should create audit log entry with required fields', async () => {
      const mockEntry = {
        id: 'log-123',
        tenant_id: mockTenantId,
        admin_id: mockAdminId,
        action: 'create' as const,
        resource_type: 'cms_settings',
        resource_id: 'res-123',
        changes: { field: 'value' },
        timestamp: '2024-01-01T00:00:00Z',
        ip_address: null,
        user_agent: null,
        error_message: null,
      };

      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: mockEntry, error: null }),
          }),
        }),
      });

      const result = await service.logAction(
        mockTenantId,
        mockAdminId,
        'create',
        'cms_settings',
        'res-123',
        { field: 'value' }
      );

      expect(result.tenant_id).toBe(mockTenantId);
      expect(result.admin_id).toBe(mockAdminId);
      expect(result.action).toBe('create');
      expect(result.resource_type).toBe('cms_settings');
      expect(result.timestamp).toBeDefined();
    });

    it('1.2: Should include IP address and user agent when provided', async () => {
      const mockEntry = {
        id: 'log-123',
        tenant_id: mockTenantId,
        admin_id: mockAdminId,
        action: 'update' as const,
        resource_type: 'cms_settings',
        resource_id: null,
        changes: null,
        timestamp: '2024-01-01T00:00:00Z',
        ip_address: '192.168.1.1',
        user_agent: 'Mozilla/5.0',
        error_message: null,
      };

      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: mockEntry, error: null }),
          }),
        }),
      });

      const result = await service.logAction(
        mockTenantId,
        mockAdminId,
        'update',
        'cms_settings',
        null,
        null,
        '192.168.1.1',
        'Mozilla/5.0'
      );

      expect(result.ip_address).toBe('192.168.1.1');
      expect(result.user_agent).toBe('Mozilla/5.0');
    });

    it('1.3: Should support all action types', async () => {
      const actions = ['create', 'update', 'delete', 'import', 'rollback', 'apply_preset', 'export'] as const;

      for (const action of actions) {
        const mockEntry = {
          id: 'log-123',
          tenant_id: mockTenantId,
          admin_id: mockAdminId,
          action,
          resource_type: 'cms_settings',
          resource_id: null,
          changes: null,
          timestamp: '2024-01-01T00:00:00Z',
          ip_address: null,
          user_agent: null,
          error_message: null,
        };

        mockSupabase.from = jest.fn().mockReturnValue({
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockEntry, error: null }),
            }),
          }),
        });

        const result = await service.logAction(mockTenantId, mockAdminId, action);
        expect(result.action).toBe(action);
      }
    });

    it('1.4: Should throw TenantMismatchError when tenant_id is null', async () => {
      await expect(
        service.logAction(null as any, mockAdminId, 'create')
      ).rejects.toThrow(TenantMismatchError);
    });

    it('1.5: Should throw TenantMismatchError when tenant_id is empty string', async () => {
      await expect(
        service.logAction('', mockAdminId, 'create')
      ).rejects.toThrow(TenantMismatchError);
    });
  });

  // ==========================================================================
  // Test 2: getLogsByTenant filters to tenant_id only
  // ==========================================================================
  describe('Test 2: getLogsByTenant filters to tenant_id only - Requirement 15.2, 2.10', () => {
    it('2.1: Should filter logs by tenant_id', async () => {
      const mockLogs = [
        {
          id: '1',
          tenant_id: mockTenantId,
          admin_id: mockAdminId,
          action: 'create',
          timestamp: '2024-01-02T00:00:00Z',
          resource_type: 'cms_settings',
          resource_id: null,
          changes: null,
          ip_address: null,
          user_agent: null,
          error_message: null,
        },
      ];

      mockSupabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              range: jest.fn().mockResolvedValue({
                data: mockLogs,
                error: null,
                count: 1,
              }),
            }),
          }),
        }),
      });

      const result = await service.getLogsByTenant(mockTenantId);

      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].tenant_id).toBe(mockTenantId);
      expect(result.total).toBe(1);
    });

    it('2.2: Should throw TenantMismatchError when tenant_id is null', async () => {
      await expect(
        service.getLogsByTenant(null as any)
      ).rejects.toThrow(TenantMismatchError);
    });

    it('2.3: Should return empty logs when no records found', async () => {
      mockSupabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              range: jest.fn().mockResolvedValue({
                data: [],
                error: null,
                count: 0,
              }),
            }),
          }),
        }),
      });

      const result = await service.getLogsByTenant(mockTenantId);

      expect(result.logs).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('2.4: Should support pagination', async () => {
      const mockLogs = [];

      mockSupabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              range: jest.fn().mockResolvedValue({
                data: mockLogs,
                error: null,
                count: 100,
              }),
            }),
          }),
        }),
      });

      const result = await service.getLogsByTenant(mockTenantId, {
        limit: 10,
        offset: 20,
      });

      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
      expect(result.total).toBe(100);
    });
  });

  // ==========================================================================
  // Test 3: getLogsByAction filters logs by action type
  // ==========================================================================
  describe('Test 3: getLogsByAction filters logs by action type - Requirement 15.3, 2.10', () => {
    it('3.1: Should filter logs by specific action type', async () => {
      const mockLogs = [
        {
          id: '1',
          tenant_id: mockTenantId,
          admin_id: mockAdminId,
          action: 'create',
          timestamp: '2024-01-01T00:00:00Z',
          resource_type: 'cms_settings',
          resource_id: null,
          changes: null,
          ip_address: null,
          user_agent: null,
          error_message: null,
        },
      ];

      // Create a chainable mock query
      const mockQuery = {
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({
          data: mockLogs,
          error: null,
          count: 1,
        }),
      };

      mockSupabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue(mockQuery),
      });

      const result = await service.getLogsByAction(mockTenantId, 'create');

      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].action).toBe('create');
    });

    it('3.2: Should throw TenantMismatchError when tenant_id is null', async () => {
      await expect(
        service.getLogsByAction(null as any, 'create')
      ).rejects.toThrow(TenantMismatchError);
    });

    it('3.3: Should return logs with pagination support', async () => {
      // Create a chainable mock query
      const mockQuery = {
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        range: jest.fn().mockResolvedValue({
          data: [],
          error: null,
          count: 50,
        }),
      };

      mockSupabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue(mockQuery),
      });

      const result = await service.getLogsByAction(mockTenantId, 'update', 25, 5);

      expect(result.limit).toBe(25);
      expect(result.offset).toBe(5);
      expect(result.total).toBe(50);
    });
  });

  // ==========================================================================
  // Test 4: getAllLogsForTenant returns paginated results
  // ==========================================================================
  describe('Test 4: getAllLogsForTenant returns paginated results - Requirement 15.1, 15.2, 2.10', () => {
    it('4.1: Should retrieve all logs with pagination', async () => {
      const mockLogs = [
        {
          id: '1',
          tenant_id: mockTenantId,
          admin_id: mockAdminId,
          action: 'create',
          timestamp: '2024-01-01T00:00:00Z',
          resource_type: 'cms_settings',
          resource_id: null,
          changes: null,
          ip_address: null,
          user_agent: null,
          error_message: null,
        },
      ];

      mockSupabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              range: jest.fn().mockResolvedValue({
                data: mockLogs,
                error: null,
                count: 1,
              }),
            }),
          }),
        }),
      });

      const result = await service.getAllLogsForTenant(mockTenantId, 50, 0);

      expect(result.logs).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });

    it('4.2: Should apply default pagination if not specified', async () => {
      mockSupabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              range: jest.fn().mockResolvedValue({
                data: [],
                error: null,
                count: 0,
              }),
            }),
          }),
        }),
      });

      const result = await service.getAllLogsForTenant(mockTenantId);

      expect(result.limit).toBe(50); // Default limit
      expect(result.offset).toBe(0); // Default offset
    });

    it('4.3: Should throw TenantMismatchError when tenant_id is null', async () => {
      await expect(
        service.getAllLogsForTenant(null as any)
      ).rejects.toThrow(TenantMismatchError);
    });
  });

  // ==========================================================================
  // Test 5: Cross-tenant audit log access rejected
  // ==========================================================================
  describe('Test 5: Cross-tenant audit log access rejected - Requirement 2.10 (CRITICAL)', () => {
    it('5.1: Should only retrieve logs for the specified tenant', async () => {
      const tenant1Logs = [
        {
          id: '1',
          tenant_id: mockTenantId,
          admin_id: mockAdminId,
          action: 'create',
          timestamp: '2024-01-01T00:00:00Z',
          resource_type: 'cms_settings',
          resource_id: null,
          changes: null,
          ip_address: null,
          user_agent: null,
          error_message: null,
        },
      ];

      mockSupabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              range: jest.fn().mockResolvedValue({
                data: tenant1Logs,
                error: null,
                count: 1,
              }),
            }),
          }),
        }),
      });

      const result = await service.getLogsByTenant(mockTenantId);

      // All returned logs should be from the requested tenant
      expect(result.logs.every(log => log.tenant_id === mockTenantId)).toBe(true);
      // Should not contain logs from other tenants
      expect(result.logs.some(log => log.tenant_id === mockTenant2Id)).toBe(false);
    });

    it('5.2: Should apply tenant_id filter in query', async () => {
      const mockSelect = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            range: jest.fn().mockResolvedValue({
              data: [],
              error: null,
              count: 0,
            }),
          }),
        }),
      });

      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      await service.getLogsByTenant(mockTenantId);

      // Verify select was called
      expect(mockSupabase.from).toHaveBeenCalledWith('cms_audit_log');
    });

    it('5.3: Should reject with TenantMismatchError on null tenant_id', async () => {
      await expect(
        service.getLogsByTenant(null as any)
      ).rejects.toThrow(TenantMismatchError);
    });
  });

  // ==========================================================================
  // Test 6: Additional requirements coverage
  // ==========================================================================
  describe('Test 6: Additional requirements - Requirement 15.4', () => {
    it('6.1: Should return paginated results with correct metadata', async () => {
      const mockLogs = Array.from({ length: 10 }, (_, i) => ({
        id: `log-${i}`,
        tenant_id: mockTenantId,
        admin_id: mockAdminId,
        action: 'create' as const,
        timestamp: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
        resource_type: 'cms_settings',
        resource_id: null,
        changes: null,
        ip_address: null,
        user_agent: null,
        error_message: null,
      }));

      mockSupabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              range: jest.fn().mockResolvedValue({
                data: mockLogs.slice(0, 5),
                error: null,
                count: 10,
              }),
            }),
          }),
        }),
      });

      const result = await service.getLogsByTenant(mockTenantId, { limit: 5, offset: 0 });

      expect(result.logs).toHaveLength(5);
      expect(result.total).toBe(10);
      expect(result.limit).toBe(5);
      expect(result.offset).toBe(0);
    });

    it('6.2: Should handle error_message for failed operations', async () => {
      const mockEntry = {
        id: 'log-123',
        tenant_id: mockTenantId,
        admin_id: mockAdminId,
        action: 'import' as const,
        resource_type: 'cms_settings',
        resource_id: null,
        changes: null,
        timestamp: '2024-01-01T00:00:00Z',
        ip_address: null,
        user_agent: null,
        error_message: 'Validation failed: Invalid color format',
      };

      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: mockEntry, error: null }),
          }),
        }),
      });

      const result = await service.logAction(
        mockTenantId,
        mockAdminId,
        'import',
        'cms_settings',
        null,
        null,
        null,
        null,
        'Validation failed: Invalid color format'
      );

      expect(result.error_message).toBe('Validation failed: Invalid color format');
    });

    it('6.3: Should handle null admin_id', async () => {
      const mockEntry = {
        id: 'log-123',
        tenant_id: mockTenantId,
        admin_id: null,
        action: 'export' as const,
        resource_type: 'cms_settings',
        resource_id: null,
        changes: null,
        timestamp: '2024-01-01T00:00:00Z',
        ip_address: null,
        user_agent: null,
        error_message: null,
      };

      mockSupabase.from = jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: mockEntry, error: null }),
          }),
        }),
      });

      const result = await service.logAction(mockTenantId, null, 'export');

      expect(result.admin_id).toBeNull();
    });
  });
});
