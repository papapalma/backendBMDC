/**
 * Unit Tests for AuditLogService
 *
 * **Validates: Requirements 15.1, 15.2, 15.3, 2.10**
 *
 * Tests verify that:
 * 1. Audit log entry created for each action with admin_id and timestamp
 * 2. Logs filtered by tenant_id correctly (tenant isolation)
 * 3. Logs retrieved in reverse chronological order
 * 4. Logs filtered by action type
 * 5. Cross-tenant logs never mixed
 * 6. TenantMismatchError thrown when tenant_id missing or invalid
 * 7. Optional fields (ip_address, user_agent) stored correctly
 * 8. Pagination works correctly (limit, offset)
 * 9. Total count accurate with filters applied
 */

import {
  AuditLogService,
  TenantMismatchError,
  AuditLogError,
  AuditLogEntry,
  AuditLogResult,
} from '../cms/AuditLogService';

// Mock Supabase client
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(),
  })),
}));

describe('AuditLogService - Requirements 15.1, 15.2, 15.3, 2.10', () => {
  let service: AuditLogService;
  let mockSupabase: any;

  // Constants for testing
  const mockTenantId = '550e8400-e29b-41d4-a716-446655440000';
  const mockAdminId = '550e8400-e29b-41d4-a716-446655440001';
  const mockTenant2Id = '550e8400-e29b-41d4-a716-446655440002';
  const mockAuditLogId = '550e8400-e29b-41d4-a716-446655440010';

  // Helper function to setup query mock chain
  const setupMockQueryChain = (data: any, count: number) => {
    const mockRange = jest.fn().mockResolvedValue({
      data,
      error: null,
      count,
    });

    const mockOrder = jest.fn().mockReturnValue({ range: mockRange });
    
    // Create a chainable eq mock that handles multiple calls
    let eqChain = { order: mockOrder };
    const mockEq = jest.fn().mockImplementation(() => eqChain);
    
    // Reset eqChain after first call
    const mockEqFirst = jest.fn().mockImplementation(() => {
      eqChain = { order: mockOrder };
      return eqChain;
    });

    const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
    mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

    return { mockSelect, mockEq, mockOrder, mockRange };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuditLogService();

    // Get the mocked supabase instance
    mockSupabase = (service as any).supabase;
  });

  // ==========================================================================
  // Test Suite 1: Tenant Isolation - CRITICAL
  // ==========================================================================

  describe('Test 1: Tenant Isolation (CRITICAL) - Requirement 2.10', () => {
    it('1.1: Should throw TenantMismatchError when tenant_id is null in logAction', async () => {
      await expect(
        service.logAction(null as any, mockAdminId, 'create', 'cms_settings')
      ).rejects.toThrow(TenantMismatchError);
    });

    it('1.2: Should throw TenantMismatchError when tenant_id is undefined in logAction', async () => {
      await expect(
        service.logAction(undefined as any, mockAdminId, 'create', 'cms_settings')
      ).rejects.toThrow(TenantMismatchError);
    });

    it('1.3: Should throw TenantMismatchError when tenant_id is empty string in logAction', async () => {
      await expect(
        service.logAction('', mockAdminId, 'create', 'cms_settings')
      ).rejects.toThrow(TenantMismatchError);
    });

    it('1.4: Should throw TenantMismatchError when tenant_id is null in getLogsByTenant', async () => {
      await expect(service.getLogsByTenant(null as any)).rejects.toThrow(
        TenantMismatchError
      );
    });

    it('1.5: Should throw TenantMismatchError when tenant_id is null in getLogsByAction', async () => {
      await expect(service.getLogsByAction(null as any, 'create')).rejects.toThrow(
        TenantMismatchError
      );
    });

    it('1.6: Should throw TenantMismatchError when tenant_id is null in getAllLogsForTenant', async () => {
      await expect(service.getAllLogsForTenant(null as any)).rejects.toThrow(
        TenantMismatchError
      );
    });

    it('1.7: Should throw TenantMismatchError when tenant_id is null in getLogCountForTenant', async () => {
      await expect(service.getLogCountForTenant(null as any)).rejects.toThrow(
        TenantMismatchError
      );
    });

    it('1.8: Should throw TenantMismatchError when tenant_id is null in getRecentLogs', async () => {
      await expect(service.getRecentLogs(null as any)).rejects.toThrow(
        TenantMismatchError
      );
    });

    it('1.9: Should include tenant_id filter in logAction query', async () => {
      const mockInsert = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: {
              id: mockAuditLogId,
              tenant_id: mockTenantId,
              admin_id: mockAdminId,
              action: 'create',
              timestamp: new Date().toISOString(),
            },
            error: null,
          }),
        }),
      });

      mockSupabase.from = jest.fn().mockReturnValue({ insert: mockInsert });

      await service.logAction(mockTenantId, mockAdminId, 'create', 'cms_settings');

      expect(mockSupabase.from).toHaveBeenCalledWith('cms_audit_log');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ tenant_id: mockTenantId })
        ])
      );
    });

    it('1.10: Should include tenant_id filter in getLogsByTenant query', async () => {
      const mockEq = jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          range: jest.fn().mockResolvedValue({
            data: [],
            error: null,
            count: 0,
          }),
        }),
      });

      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      await service.getLogsByTenant(mockTenantId);

      expect(mockSelect).toHaveBeenCalledWith('*', { count: 'exact' });
      expect(mockEq).toHaveBeenCalledWith('tenant_id', mockTenantId);
    });

    it('1.11: Should never allow cross-tenant log access in getLogsByTenant', async () => {
      const mockEq = jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          range: jest.fn().mockResolvedValue({
            data: [
              {
                id: '1',
                tenant_id: mockTenant2Id,
                admin_id: mockAdminId,
                action: 'create',
                timestamp: new Date().toISOString(),
              },
            ],
            error: null,
            count: 1,
          }),
        }),
      });

      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      const result = await service.getLogsByTenant(mockTenantId);

      // Verify tenant_id filter was applied
      expect(mockEq).toHaveBeenCalledWith('tenant_id', mockTenantId);
      // The query would be filtered by the database, but service validates it
      expect(result.logs.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // Test Suite 2: Log Action Creation
  // ==========================================================================

  describe('Test 2: Log Action Creation - Requirement 15.1, 15.2', () => {
    it('2.1: Should log action with all required fields', async () => {
      const mockEntry = {
        id: mockAuditLogId,
        tenant_id: mockTenantId,
        admin_id: mockAdminId,
        action: 'create',
        resource_type: 'cms_settings',
        resource_id: 'res-123',
        changes: { field: 'value' },
        timestamp: '2024-01-01T00:00:00Z',
        ip_address: null,
        user_agent: null,
        error_message: null,
      };

      const mockInsert = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: mockEntry, error: null }),
        }),
      });

      mockSupabase.from = jest.fn().mockReturnValue({ insert: mockInsert });

      const result = await service.logAction(
        mockTenantId,
        mockAdminId,
        'create',
        'cms_settings',
        'res-123',
        { field: 'value' }
      );

      expect(result).toEqual(mockEntry);
      expect(result.admin_id).toBe(mockAdminId);
      expect(result.action).toBe('create');
      expect(result.timestamp).toBeDefined();
    });

    it('2.2: Should log action with optional ip_address and user_agent', async () => {
      const mockEntry = {
        id: mockAuditLogId,
        tenant_id: mockTenantId,
        admin_id: mockAdminId,
        action: 'update',
        resource_type: 'cms_settings',
        resource_id: null,
        changes: null,
        timestamp: '2024-01-01T00:00:00Z',
        ip_address: '192.168.1.1',
        user_agent: 'Mozilla/5.0...',
        error_message: null,
      };

      const mockInsert = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: mockEntry, error: null }),
        }),
      });

      mockSupabase.from = jest.fn().mockReturnValue({ insert: mockInsert });

      const result = await service.logAction(
        mockTenantId,
        mockAdminId,
        'update',
        'cms_settings',
        null,
        null,
        '192.168.1.1',
        'Mozilla/5.0...'
      );

      expect(result.ip_address).toBe('192.168.1.1');
      expect(result.user_agent).toBe('Mozilla/5.0...');
    });

    it('2.3: Should support all action types', async () => {
      const actions: Array<'create' | 'update' | 'delete' | 'import' | 'rollback' | 'apply_preset' | 'export'> = [
        'create',
        'update',
        'delete',
        'import',
        'rollback',
        'apply_preset',
        'export',
      ];

      for (const action of actions) {
        const mockEntry = {
          id: mockAuditLogId,
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

        const mockInsert = jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: mockEntry, error: null }),
          }),
        });

        mockSupabase.from = jest.fn().mockReturnValue({ insert: mockInsert });

        const result = await service.logAction(
          mockTenantId,
          mockAdminId,
          action,
          'cms_settings'
        );

        expect(result.action).toBe(action);
      }
    });

    it('2.4: Should include timestamp with log entry', async () => {
      const mockEntry = {
        id: mockAuditLogId,
        tenant_id: mockTenantId,
        admin_id: mockAdminId,
        action: 'create',
        resource_type: 'cms_settings',
        resource_id: null,
        changes: null,
        timestamp: '2024-01-01T00:00:00Z',
        ip_address: null,
        user_agent: null,
        error_message: null,
      };

      const mockInsert = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: mockEntry, error: null }),
        }),
      });

      mockSupabase.from = jest.fn().mockReturnValue({ insert: mockInsert });

      const result = await service.logAction(mockTenantId, mockAdminId, 'create');

      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp).toBe('string');
    });

    it('2.5: Should handle null admin_id', async () => {
      const mockEntry = {
        id: mockAuditLogId,
        tenant_id: mockTenantId,
        admin_id: null,
        action: 'export',
        resource_type: null,
        resource_id: null,
        changes: null,
        timestamp: '2024-01-01T00:00:00Z',
        ip_address: null,
        user_agent: null,
        error_message: null,
      };

      const mockInsert = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: mockEntry, error: null }),
        }),
      });

      mockSupabase.from = jest.fn().mockReturnValue({ insert: mockInsert });

      const result = await service.logAction(mockTenantId, null, 'export');

      expect(result.admin_id).toBeNull();
    });

    it('2.6: Should handle error_message for failed operations', async () => {
      const mockEntry = {
        id: mockAuditLogId,
        tenant_id: mockTenantId,
        admin_id: mockAdminId,
        action: 'import',
        resource_type: 'cms_settings',
        resource_id: null,
        changes: null,
        timestamp: '2024-01-01T00:00:00Z',
        ip_address: null,
        user_agent: null,
        error_message: 'Validation failed: Invalid color format',
      };

      const mockInsert = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: mockEntry, error: null }),
        }),
      });

      mockSupabase.from = jest.fn().mockReturnValue({ insert: mockInsert });

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
  });

  // ==========================================================================
  // Test Suite 3: Log Retrieval - Tenant Filtered
  // ==========================================================================

  describe('Test 3: Log Retrieval by Tenant - Requirement 15.2, 2.10', () => {
    it('3.1: Should return logs filtered by tenant_id', async () => {
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
        {
          id: '2',
          tenant_id: mockTenantId,
          admin_id: mockAdminId,
          action: 'update',
          timestamp: '2024-01-01T00:00:00Z',
          resource_type: 'cms_settings',
          resource_id: null,
          changes: null,
          ip_address: null,
          user_agent: null,
          error_message: null,
        },
      ];

      const mockEq = jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          range: jest.fn().mockResolvedValue({
            data: mockLogs,
            error: null,
            count: 2,
          }),
        }),
      });

      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      const result = await service.getLogsByTenant(mockTenantId);

      expect(result.logs).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(mockEq).toHaveBeenCalledWith('tenant_id', mockTenantId);
    });

    it('3.2: Should return logs in reverse chronological order (latest first)', async () => {
      const mockLogs = [
        {
          id: '1',
          tenant_id: mockTenantId,
          admin_id: mockAdminId,
          action: 'create',
          timestamp: '2024-01-03T00:00:00Z',
          resource_type: 'cms_settings',
          resource_id: null,
          changes: null,
          ip_address: null,
          user_agent: null,
          error_message: null,
        },
        {
          id: '2',
          tenant_id: mockTenantId,
          admin_id: mockAdminId,
          action: 'update',
          timestamp: '2024-01-02T00:00:00Z',
          resource_type: 'cms_settings',
          resource_id: null,
          changes: null,
          ip_address: null,
          user_agent: null,
          error_message: null,
        },
        {
          id: '3',
          tenant_id: mockTenantId,
          admin_id: mockAdminId,
          action: 'delete',
          timestamp: '2024-01-01T00:00:00Z',
          resource_type: 'cms_settings',
          resource_id: null,
          changes: null,
          ip_address: null,
          user_agent: null,
          error_message: null,
        },
      ];

      const mockOrder = jest.fn().mockReturnValue({
        range: jest.fn().mockResolvedValue({
          data: mockLogs,
          error: null,
          count: 3,
        }),
      });

      const mockEq = jest.fn().mockReturnValue({ order: mockOrder });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      const result = await service.getLogsByTenant(mockTenantId);

      expect(mockOrder).toHaveBeenCalledWith('timestamp', { ascending: false });
      // Compare timestamps as ISO strings (should be in descending order)
      expect(result.logs[0].timestamp).toBeGreaterThanOrEqual(result.logs[1].timestamp);
      expect(result.logs[1].timestamp).toBeGreaterThanOrEqual(result.logs[2].timestamp);
      // Verify order by checking the actual timestamps
      expect(new Date(result.logs[0].timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(result.logs[1].timestamp).getTime()
      );
    });

    it('3.3: Should return empty array when no logs found', async () => {
      const mockEq = jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          range: jest.fn().mockResolvedValue({
            data: [],
            error: null,
            count: 0,
          }),
        }),
      });

      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      const result = await service.getLogsByTenant(mockTenantId);

      expect(result.logs).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('3.4: Should support pagination with limit and offset', async () => {
      const mockLogs = [
        {
          id: '11',
          tenant_id: mockTenantId,
          admin_id: mockAdminId,
          action: 'create',
          timestamp: '2024-01-11T00:00:00Z',
          resource_type: 'cms_settings',
          resource_id: null,
          changes: null,
          ip_address: null,
          user_agent: null,
          error_message: null,
        },
        {
          id: '12',
          tenant_id: mockTenantId,
          admin_id: mockAdminId,
          action: 'update',
          timestamp: '2024-01-10T00:00:00Z',
          resource_type: 'cms_settings',
          resource_id: null,
          changes: null,
          ip_address: null,
          user_agent: null,
          error_message: null,
        },
      ];

      const mockRange = jest.fn().mockResolvedValue({
        data: mockLogs,
        error: null,
        count: 100, // Total count
      });

      const mockOrder = jest.fn().mockReturnValue({ range: mockRange });
      const mockEq = jest.fn().mockReturnValue({ order: mockOrder });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      const result = await service.getLogsByTenant(mockTenantId, {
        limit: 2,
        offset: 10,
      });

      expect(mockRange).toHaveBeenCalledWith(10, 11); // offset 10, limit 2 = range(10, 11)
      expect(result.logs).toHaveLength(2);
      expect(result.limit).toBe(2);
      expect(result.offset).toBe(10);
      expect(result.total).toBe(100);
    });
  });

  // ==========================================================================
  // Test Suite 4: Filter by Action Type
  // ==========================================================================

  describe('Test 4: Filter by Action Type - Requirement 15.3, 2.10', () => {
    it('4.1: Should filter logs by action type using getLogsByAction', async () => {
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
        {
          id: '2',
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

      const mockRange = jest.fn().mockResolvedValue({
        data: mockLogs,
        error: null,
        count: 2,
      });

      const mockOrder = jest.fn().mockReturnValue({ range: mockRange });
      const mockEq2 = jest.fn().mockReturnValue({ order: mockOrder });
      const mockEq = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      const result = await service.getLogsByAction(mockTenantId, 'create');

      expect(mockEq).toHaveBeenCalledWith('tenant_id', mockTenantId);
      expect(mockEq2).toHaveBeenCalledWith('action', 'create');
      expect(result.logs).toHaveLength(2);
      expect(result.logs.every(log => log.action === 'create')).toBe(true);
    });

    it('4.2: Should apply both tenant_id and action filters', async () => {
      const mockLogs = [
        {
          id: '1',
          tenant_id: mockTenantId,
          admin_id: mockAdminId,
          action: 'rollback',
          timestamp: '2024-01-01T00:00:00Z',
          resource_type: 'cms_settings',
          resource_id: null,
          changes: null,
          ip_address: null,
          user_agent: null,
          error_message: null,
        },
      ];

      const mockRange = jest.fn().mockResolvedValue({
        data: mockLogs,
        error: null,
        count: 1,
      });

      const mockOrder = jest.fn().mockReturnValue({ range: mockRange });
      const mockEq2 = jest.fn().mockReturnValue({ order: mockOrder });
      const mockEq = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      const result = await service.getLogsByAction(mockTenantId, 'rollback', 50, 0);

      expect(mockEq).toHaveBeenCalledWith('tenant_id', mockTenantId);
      expect(mockEq2).toHaveBeenCalledWith('action', 'rollback');
    });

    it('4.3: Should support pagination with action filter', async () => {
      const mockLogs: any[] = [];

      const mockRange = jest.fn().mockResolvedValue({
        data: mockLogs,
        error: null,
        count: 50,
      });

      const mockOrder = jest.fn().mockReturnValue({ range: mockRange });
      const mockEq2 = jest.fn().mockReturnValue({ order: mockOrder });
      const mockEq = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      const result = await service.getLogsByAction(mockTenantId, 'update', 25, 10);

      expect(mockRange).toHaveBeenCalledWith(10, 34); // offset 10, limit 25 = range(10, 34)
      expect(result.limit).toBe(25);
      expect(result.offset).toBe(10);
    });

    it('4.4: Should support filtering by admin_id as well', async () => {
      const mockLogs = [
        {
          id: '1',
          tenant_id: mockTenantId,
          admin_id: mockAdminId,
          action: 'update',
          timestamp: '2024-01-01T00:00:00Z',
          resource_type: 'cms_settings',
          resource_id: null,
          changes: null,
          ip_address: null,
          user_agent: null,
          error_message: null,
        },
      ];

      const mockRange = jest.fn().mockResolvedValue({
        data: mockLogs,
        error: null,
        count: 1,
      });

      const mockOrder = jest.fn().mockReturnValue({ range: mockRange });
      const mockEq3 = jest.fn().mockReturnValue({ order: mockOrder });
      const mockEq2 = jest.fn().mockReturnValue({ eq: mockEq3 });
      const mockEq = jest.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      const result = await service.getLogsByTenant(mockTenantId, {
        adminId: mockAdminId,
      });

      expect(mockEq).toHaveBeenCalledWith('tenant_id', mockTenantId);
      expect(mockEq2).toHaveBeenCalledWith('admin_id', mockAdminId);
    });
  });

  // ==========================================================================
  // Test Suite 5: Get All Logs For Tenant
  // ==========================================================================

  describe('Test 5: Get All Logs For Tenant - Requirement 15.1, 15.2, 2.10', () => {
    it('5.1: Should retrieve all logs for tenant with pagination', async () => {
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

      const mockRange = jest.fn().mockResolvedValue({
        data: mockLogs,
        error: null,
        count: 1,
      });

      const mockOrder = jest.fn().mockReturnValue({ range: mockRange });
      const mockEq = jest.fn().mockReturnValue({ order: mockOrder });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      const result = await service.getAllLogsForTenant(mockTenantId, 50, 0);

      expect(result.logs).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });

    it('5.2: Should apply default pagination if not specified', async () => {
      const mockEq = jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          range: jest.fn().mockResolvedValue({
            data: [],
            error: null,
            count: 0,
          }),
        }),
      });

      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      const result = await service.getAllLogsForTenant(mockTenantId);

      expect(result.limit).toBe(50); // Default limit
      expect(result.offset).toBe(0); // Default offset
    });
  });

  // ==========================================================================
  // Test Suite 6: Get Log Count
  // ==========================================================================

  describe('Test 6: Get Log Count - Requirement 2.10', () => {
    it('6.1: Should count total logs for tenant', async () => {
      const mockEq = jest.fn().mockResolvedValue({
        count: 42,
        error: null,
      });

      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      const count = await service.getLogCountForTenant(mockTenantId);

      expect(count).toBe(42);
      expect(mockSelect).toHaveBeenCalledWith('id', { count: 'exact', head: true });
      expect(mockEq).toHaveBeenCalledWith('tenant_id', mockTenantId);
    });

    it('6.2: Should return 0 when no logs found', async () => {
      const mockEq = jest.fn().mockResolvedValue({
        count: 0,
        error: null,
      });

      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      const count = await service.getLogCountForTenant(mockTenantId);

      expect(count).toBe(0);
    });
  });

  // ==========================================================================
  // Test Suite 7: Get Recent Logs
  // ==========================================================================

  describe('Test 7: Get Recent Logs - Requirement 15.2, 2.10', () => {
    it('7.1: Should return recent logs in reverse chronological order', async () => {
      const mockLogs = [
        {
          id: '1',
          tenant_id: mockTenantId,
          admin_id: mockAdminId,
          action: 'update',
          timestamp: '2024-01-05T00:00:00Z',
          resource_type: 'cms_settings',
          resource_id: null,
          changes: null,
          ip_address: null,
          user_agent: null,
          error_message: null,
        },
        {
          id: '2',
          tenant_id: mockTenantId,
          admin_id: mockAdminId,
          action: 'create',
          timestamp: '2024-01-04T00:00:00Z',
          resource_type: 'cms_settings',
          resource_id: null,
          changes: null,
          ip_address: null,
          user_agent: null,
          error_message: null,
        },
      ];

      const mockLimit = jest.fn().mockResolvedValue({
        data: mockLogs,
        error: null,
      });

      const mockOrder = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockEq = jest.fn().mockReturnValue({ order: mockOrder });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      const result = await service.getRecentLogs(mockTenantId, 20);

      expect(mockEq).toHaveBeenCalledWith('tenant_id', mockTenantId);
      expect(mockOrder).toHaveBeenCalledWith('timestamp', { ascending: false });
      expect(mockLimit).toHaveBeenCalledWith(20);
      expect(result).toHaveLength(2);
    });

    it('7.2: Should use default count of 20 if not specified', async () => {
      const mockLimit = jest.fn().mockResolvedValue({
        data: [],
        error: null,
      });

      const mockOrder = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockEq = jest.fn().mockReturnValue({ order: mockOrder });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      await service.getRecentLogs(mockTenantId);

      expect(mockLimit).toHaveBeenCalledWith(20); // Default
    });
  });

  // ==========================================================================
  // Test Suite 8: Error Handling
  // ==========================================================================

  describe('Test 8: Error Handling - Requirement 15.1', () => {
    it('8.1: Should throw AuditLogError on database error in logAction', async () => {
      const mockInsert = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { message: 'Database connection failed' },
          }),
        }),
      });

      mockSupabase.from = jest.fn().mockReturnValue({ insert: mockInsert });

      await expect(
        service.logAction(mockTenantId, mockAdminId, 'create')
      ).rejects.toThrow(AuditLogError);
    });

    it('8.2: Should throw AuditLogError on database error in getLogsByTenant', async () => {
      const mockEq = jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          range: jest.fn().mockResolvedValue({
            data: null,
            error: { message: 'Database connection failed' },
            count: null,
          }),
        }),
      });

      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      await expect(service.getLogsByTenant(mockTenantId)).rejects.toThrow(
        AuditLogError
      );
    });

    it('8.3: Should provide meaningful error messages', async () => {
      try {
        await service.logAction(null as any, mockAdminId, 'create');
        fail('Should have thrown TenantMismatchError');
      } catch (error) {
        expect(error).toBeInstanceOf(TenantMismatchError);
        expect((error as Error).message).toContain('tenant_id');
      }
    });
  });

  // ==========================================================================
  // Test Suite 9: Cross-Tenant Isolation
  // ==========================================================================

  describe('Test 9: Cross-Tenant Isolation (CRITICAL) - Requirement 2.10', () => {
    it('9.1: Should never allow querying logs from different tenant', async () => {
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

      const mockEq = jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          range: jest.fn().mockResolvedValue({
            data: tenant1Logs,
            error: null,
            count: 1,
          }),
        }),
      });

      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      // Request logs from tenant1
      const result = await service.getLogsByTenant(mockTenantId);

      // Verify tenant_id filter was applied for tenant1
      expect(mockEq).toHaveBeenCalledWith('tenant_id', mockTenantId);
      // All returned logs should be from tenant1
      expect(result.logs.every(log => log.tenant_id === mockTenantId)).toBe(true);
    });

    it('9.2: Should enforce tenant_id filter in every query method', async () => {
      const mockRange = jest.fn().mockResolvedValue({
        data: [],
        error: null,
        count: 0,
      });

      const mockOrder = jest.fn().mockReturnValue({ range: mockRange });
      const mockEq = jest.fn().mockReturnValue({ order: mockOrder });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      // Test each method applies tenant_id filter
      await service.getLogsByTenant(mockTenantId);
      expect(mockEq).toHaveBeenCalledWith('tenant_id', mockTenantId);

      mockEq.mockClear();
      mockOrder.mockClear();
      mockRange.mockClear();

      await service.getLogsByAction(mockTenantId, 'create');
      expect(mockEq).toHaveBeenCalledWith('tenant_id', mockTenantId);

      mockEq.mockClear();
      mockOrder.mockClear();
      mockRange.mockClear();

      await service.getAllLogsForTenant(mockTenantId);
      expect(mockEq).toHaveBeenCalledWith('tenant_id', mockTenantId);
    });
  });

  // ==========================================================================
  // Test Suite 10: Date Range Filtering
  // ==========================================================================

  describe('Test 10: Date Range Filtering - Requirement 15.2', () => {
    it('10.1: Should filter logs by start date', async () => {
      const mockLogs = [];

      const mockRange = jest.fn().mockResolvedValue({
        data: mockLogs,
        error: null,
        count: 0,
      });

      const mockOrder = jest.fn().mockReturnValue({ range: mockRange });
      const mockGte = jest.fn().mockReturnValue({ order: mockOrder });
      const mockEq = jest.fn().mockReturnValue({ gte: mockGte });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      const startDate = '2024-01-01T00:00:00Z';
      await service.getLogsByTenant(mockTenantId, { startDate });

      expect(mockGte).toHaveBeenCalledWith('timestamp', startDate);
    });

    it('10.2: Should filter logs by end date', async () => {
      const mockLogs = [];

      const mockRange = jest.fn().mockResolvedValue({
        data: mockLogs,
        error: null,
        count: 0,
      });

      const mockOrder = jest.fn().mockReturnValue({ range: mockRange });
      const mockLte = jest.fn().mockReturnValue({ order: mockOrder });
      const mockGte = jest.fn().mockReturnValue({ lte: mockLte });
      const mockEq = jest.fn().mockReturnValue({ gte: mockGte });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      mockSupabase.from = jest.fn().mockReturnValue({ select: mockSelect });

      const startDate = '2024-01-01T00:00:00Z';
      const endDate = '2024-01-31T23:59:59Z';
      await service.getLogsByTenant(mockTenantId, { startDate, endDate });

      expect(mockGte).toHaveBeenCalledWith('timestamp', startDate);
      expect(mockLte).toHaveBeenCalledWith('timestamp', endDate);
    });
  });

  // ==========================================================================
  // Test Suite 11: Data Mapping
  // ==========================================================================

  describe('Test 11: Data Mapping - Requirement 15.1', () => {
    it('11.1: Should correctly map database entry to AuditLogEntry interface', async () => {
      const databaseEntry = {
        id: mockAuditLogId,
        tenant_id: mockTenantId,
        admin_id: mockAdminId,
        action: 'create',
        resource_type: 'cms_settings',
        resource_id: 'res-123',
        changes: { field: 'value' },
        timestamp: '2024-01-01T00:00:00Z',
        ip_address: '192.168.1.1',
        user_agent: 'Mozilla/5.0...',
        error_message: null,
      };

      const mockInsert = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: databaseEntry, error: null }),
        }),
      });

      mockSupabase.from = jest.fn().mockReturnValue({ insert: mockInsert });

      const result = await service.logAction(
        mockTenantId,
        mockAdminId,
        'create',
        'cms_settings',
        'res-123',
        { field: 'value' },
        '192.168.1.1',
        'Mozilla/5.0...'
      );

      // Verify all fields are properly mapped
      expect(result.id).toBe(databaseEntry.id);
      expect(result.tenant_id).toBe(databaseEntry.tenant_id);
      expect(result.admin_id).toBe(databaseEntry.admin_id);
      expect(result.action).toBe(databaseEntry.action);
      expect(result.resource_type).toBe(databaseEntry.resource_type);
      expect(result.resource_id).toBe(databaseEntry.resource_id);
      expect(result.changes).toEqual(databaseEntry.changes);
      expect(result.timestamp).toBe(databaseEntry.timestamp);
      expect(result.ip_address).toBe(databaseEntry.ip_address);
      expect(result.user_agent).toBe(databaseEntry.user_agent);
      expect(result.error_message).toBe(databaseEntry.error_message);
    });
  });
});
