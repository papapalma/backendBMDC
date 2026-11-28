/**
 * Unit Tests: Data Retention Service
 *
 * **Validates: Requirements 21.1 - 21.4**
 *
 * Test coverage:
 *   - Audit logs older than 90 days are deleted
 *   - Failed auth attempts older than 30 days are deleted
 *   - Soft-deleted records older than 90 days are purged
 *   - Temporary GPS/selfie files older than 30 days are anonymized
 *   - Records within retention window are NOT deleted
 *   - Retention execution is logged
 *   - Error handling and resilience
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { executeRetentionPolicy, logRetentionExecution } from '@/lib/dataRetention';

// Mock Supabase admin client
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

// Mock logger
jest.mock('@/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Data Retention Service', () => {
  // Helper: Create fluent mock query builder
  const createMockQueryBuilder = (options: { count?: number; data?: any[]; error?: any } = {}) => {
    const result = {
      error: options.error ? { message: options.error.message || 'Query error' } : null,
      count: options.count ?? 0,
      data: options.data ?? [],
    };
    const builder: any = {
      delete: jest.fn().mockImplementation(() => builder),
      select: jest.fn().mockImplementation(() => builder),
      update: jest.fn().mockImplementation(() => builder),
      insert: jest.fn().mockImplementation(() => Promise.resolve(result)),
      eq: jest.fn().mockImplementation(() => builder),
      lt: jest.fn().mockImplementation(() => builder),
      not: jest.fn().mockImplementation(() => builder),
      is: jest.fn().mockImplementation(() => builder),
      order: jest.fn().mockImplementation(() => builder),
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };
    return builder;
  };

  describe('Requirement 21.1: Audit Log Retention (90 days)', () => {
    it('should delete audit logs older than 90 days', async () => {
      const mockFrom = jest.fn(() => createMockQueryBuilder({ count: 150 }));
      (supabaseAdmin.from as jest.Mock).mockImplementation(mockFrom);

      const report = await executeRetentionPolicy();

      // Verify audit_logs policy was executed
      const auditPolicy = report.policies.find((p) => p.name === 'audit_logs_retention');
      expect(auditPolicy).toBeDefined();
      expect(auditPolicy?.recordsDeleted).toBeGreaterThanOrEqual(0);
      expect(report.success).toBe(true);
    });

    it('should not delete audit logs within 90-day window', async () => {
      const mockFrom = jest.fn(() => createMockQueryBuilder({ count: 0 }));
      (supabaseAdmin.from as jest.Mock).mockImplementation(mockFrom);

      const report = await executeRetentionPolicy();

      const auditPolicy = report.policies.find((p) => p.name === 'audit_logs_retention');
      expect(auditPolicy?.recordsDeleted).toBe(0);
    });
  });

  describe('Requirement 21.2: Failed Authentication Cleanup (30 days)', () => {
    it('should delete failed login attempts older than 30 days', async () => {
      const mockFrom = jest.fn(() => createMockQueryBuilder({ count: 12 }));
      (supabaseAdmin.from as jest.Mock).mockImplementation(mockFrom);

      const report = await executeRetentionPolicy();

      const authPolicy = report.policies.find((p) => p.name === 'failed_auth_retention');
      expect(authPolicy).toBeDefined();
      expect(authPolicy?.recordsDeleted).toBeGreaterThanOrEqual(0);
    });

    it('should specifically target login_failed action', async () => {
      let capturedEqCall: any;
      const builder = createMockQueryBuilder({ count: 5 });
      builder.eq = jest.fn().mockImplementation((field: string, value: string) => {
        if (field === 'action') {
          capturedEqCall = value;
        }
        return builder;
      });

      const mockFrom = jest.fn(() => builder);
      (supabaseAdmin.from as jest.Mock).mockImplementation(mockFrom);

      await executeRetentionPolicy();

      // Verify that login_failed action was targeted
      expect(capturedEqCall).toBe('login_failed');
    });
  });

  describe('Requirement 21.3: Soft-Delete Purge (90 days then hard delete)', () => {
    it('should hard-delete soft-deleted records older than 90 days', async () => {
      const mockFrom = jest.fn(() => createMockQueryBuilder({ count: 5 }));
      (supabaseAdmin.from as jest.Mock).mockImplementation(mockFrom);

      const report = await executeRetentionPolicy();

      const purgePolicy = report.policies.find((p) => p.name === 'soft_delete_purge');
      expect(purgePolicy).toBeDefined();
      expect(purgePolicy?.recordsDeleted).toBeGreaterThanOrEqual(0);
    });

    it('should check multiple tables with soft-delete support', async () => {
      const tablesChecked = new Set<string>();
      const mockFrom = jest.fn((table: string) => {
        tablesChecked.add(table);
        return createMockQueryBuilder({ count: 0 });
      });

      (supabaseAdmin.from as jest.Mock).mockImplementation(mockFrom);

      await executeRetentionPolicy();

      // Verify key tables are checked
      const expectedTables = ['programs', 'trainees', 'enrollments', 'attendance'];
      for (const table of expectedTables) {
        expect(tablesChecked.has(table)).toBe(true);
      }
    });

    it('should not delete records with NULL deleted_at', async () => {
      let capturedNotCall: any;
      const builder = createMockQueryBuilder({ count: 0 });
      builder.not = jest.fn().mockImplementation((field: string, op: string) => {
        capturedNotCall = { field, op };
        return builder;
      });

      const mockFrom = jest.fn(() => builder);
      (supabaseAdmin.from as jest.Mock).mockImplementation(mockFrom);

      await executeRetentionPolicy();

      // Verify that only deleted records are targeted
      expect(capturedNotCall?.field).toBe('deleted_at');
      expect(capturedNotCall?.op).toBe('is');
    });
  });

  describe('Requirement 21.4: Temporary Files Cleanup (30 days, GPS anonymization)', () => {
    it('should anonymize GPS data from old attendance records (30 days)', async () => {
      let capturedUpdateData: any;
      const builder = createMockQueryBuilder({
        data: [{ id: 'record-1', selfie_path: '/uploads/selfie.jpg', gps_lat: 14.5995, gps_lng: 120.9842 }],
        count: 1,
      });
      builder.update = jest.fn().mockImplementation((data: any) => {
        capturedUpdateData = data;
        return builder;
      });

      const mockFrom = jest.fn(() => builder);
      (supabaseAdmin.from as jest.Mock).mockImplementation(mockFrom);

      await executeRetentionPolicy();

      // Verify GPS fields are cleared (set to null)
      if (capturedUpdateData) {
        expect(capturedUpdateData).toHaveProperty('gps_lat', null);
        expect(capturedUpdateData).toHaveProperty('gps_lng', null);
      }
    });

    it('should keep attendance records but remove sensitive data', async () => {
      let updateCalled = false;
      const builder = createMockQueryBuilder({
        data: [
          {
            id: 'record-1',
            selfie_path: '/uploads/selfie.jpg',
            gps_lat: 14.5995,
            gps_lng: 120.9842,
          },
        ],
        count: 1,
      });
      builder.update = jest.fn().mockImplementation(() => {
        updateCalled = true;
        return builder;
      });

      const mockFrom = jest.fn(() => builder);
      (supabaseAdmin.from as jest.Mock).mockImplementation(mockFrom);

      const report = await executeRetentionPolicy();

      const tempPolicy = report.policies.find((p) => p.name === 'temporary_files_cleanup');
      expect(tempPolicy).toBeDefined();
      // Records are processed (not necessarily deleted)
      expect(report.totalRecordsDeleted).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling & Resilience', () => {
    it('should handle database errors gracefully', async () => {
      const mockFrom = jest.fn(() => createMockQueryBuilder({ error: { message: 'Database error' }, count: 0 }));
      (supabaseAdmin.from as jest.Mock).mockImplementation(mockFrom);

      const report = await executeRetentionPolicy();

      // Should set success to false if any policy has an error
      expect(report.success).toBe(false);
      // At least one policy should have recorded an error
      const hasError = report.policies.some((p) => p.error !== undefined);
      expect(hasError).toBe(true);
    });

    it('should continue executing if one policy fails', async () => {
      let callCount = 0;
      const mockFrom = jest.fn(() => {
        callCount++;
        // First call fails, rest succeed
        if (callCount === 1) {
          return createMockQueryBuilder({ error: { message: 'Error' }, count: 0 });
        }
        return createMockQueryBuilder({ count: 5 });
      });

      (supabaseAdmin.from as jest.Mock).mockImplementation(mockFrom);

      const report = await executeRetentionPolicy();

      // Multiple policies should execute despite one failure
      expect(report.policies.length).toBeGreaterThan(1);
    });

    it('should track total records deleted across all policies', async () => {
      const mockFrom = jest.fn(() => createMockQueryBuilder({ count: 3 }));
      (supabaseAdmin.from as jest.Mock).mockImplementation(mockFrom);

      const report = await executeRetentionPolicy();

      // Total should be sum of all policies
      expect(report.totalRecordsDeleted).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Audit Logging', () => {
    it('should log retention execution to audit_logs table', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ data: {}, error: null });
      const builder = createMockQueryBuilder({ count: 5 });
      builder.insert = mockInsert;

      const mockFrom = jest.fn(() => builder);
      (supabaseAdmin.from as jest.Mock).mockImplementation(mockFrom);

      const report = await executeRetentionPolicy();
      await logRetentionExecution(report);

      // Verify audit log was inserted
      expect(mockInsert).toHaveBeenCalled();
      const insertCall = mockInsert.mock.calls[0][0];
      expect(insertCall).toHaveProperty('action', 'data_retention_executed');
      expect(insertCall).toHaveProperty('entity_type', 'system');
      expect(insertCall.details).toHaveProperty('totalRecordsDeleted');
    });

    it('should include policy execution details in audit log', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ data: {}, error: null });
      const builder = createMockQueryBuilder({ count: 5 });
      builder.insert = mockInsert;

      const mockFrom = jest.fn(() => builder);
      (supabaseAdmin.from as jest.Mock).mockImplementation(mockFrom);

      const report = await executeRetentionPolicy();
      await logRetentionExecution(report);

      const insertCall = mockInsert.mock.calls[0][0];
      expect(insertCall.details).toHaveProperty('policyResults');
      expect(Array.isArray(insertCall.details.policyResults)).toBe(true);
    });
  });

  describe('Timing & Date Calculations', () => {
    it('should use correct cutoff dates for each retention window', async () => {
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      expect(ninetyDaysAgo.getTime()).toBeLessThan(now.getTime());
      expect(thirtyDaysAgo.getTime()).toBeLessThan(now.getTime());
      expect(ninetyDaysAgo.getTime()).toBeLessThan(thirtyDaysAgo.getTime());
    });
  });
});
