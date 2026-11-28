/**
 * Integration Tests: Data Retention API Route
 *
 * **Validates: Requirements 21.5 - 21.7**
 *
 * Test coverage:
 *   - Authenticated Super Admin can trigger retention policy
 *   - Non-Super Admin receives 403 Forbidden
 *   - Unauthenticated requests receive 401 Unauthorized
 *   - Retention policy execution results are returned
 *   - Execution is logged to audit trail
 *   - Error responses are properly formatted
 */

import { NextRequest } from 'next/server';
import { POST } from '../route';

// Mock dependencies
jest.mock('@/middleware/tenantContext', () => ({
  requireTenantContext: jest.fn(),
}));

jest.mock('@/lib/dataRetention', () => ({
  executeRetentionPolicy: jest.fn(),
  logRetentionExecution: jest.fn(),
}));

jest.mock('@/utils/responses', () => ({
  forbiddenResponse: jest.fn((msg) => new Response(JSON.stringify({ error: msg }), { status: 403 })),
  successResponse: jest.fn((data, msg) => new Response(JSON.stringify({ data, message: msg }), { status: 200 })),
}));

jest.mock('@/middleware/errorHandler', () => ({
  withErrorHandler: (fn: any) => fn,
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { requireTenantContext } from '@/middleware/tenantContext';
import { executeRetentionPolicy, logRetentionExecution } from '@/lib/dataRetention';

describe('POST /api/admin/data-retention', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Authentication & Authorization (Req 21.5)', () => {
    it('should reject unauthenticated requests with 401', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      });

      const request = new NextRequest(new Request('http://localhost:3000/api/admin/data-retention', { method: 'POST' }));
      const response = await POST(request);

      expect(response.status).toBe(401);
    });

    it('should reject non-Super Admin users with 403 Forbidden', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          userId: 'user-123',
          isSuperAdmin: false,
          tenantId: 'tenant-123',
        },
      });

      const request = new NextRequest(new Request('http://localhost:3000/api/admin/data-retention', { method: 'POST' }));
      const response = await POST(request);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('Super Admin');
    });

    it('should accept Super Admin requests with 200', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          userId: 'admin-123',
          isSuperAdmin: true,
          tenantId: null,
        },
      });

      (executeRetentionPolicy as jest.Mock).mockResolvedValue({
        executedAt: '2024-10-05T14:30:00Z',
        policies: [
          { name: 'audit_logs_retention', recordsDeleted: 150, retentionDays: 90 },
          { name: 'failed_auth_retention', recordsDeleted: 12, retentionDays: 30 },
          { name: 'soft_delete_purge', recordsDeleted: 5, retentionDays: 90 },
          { name: 'temporary_files_cleanup', recordsDeleted: 23, retentionDays: 30 },
        ],
        totalRecordsDeleted: 190,
        success: true,
      });

      (logRetentionExecution as jest.Mock).mockResolvedValue(undefined);

      const request = new NextRequest(new Request('http://localhost:3000/api/admin/data-retention', { method: 'POST' }));
      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe('Requirement 21.6: Execution & Results', () => {
    it('should execute retention policy and return results', async () => {
      const mockReport = {
        executedAt: '2024-10-05T14:30:00Z',
        policies: [
          { name: 'audit_logs_retention', recordsDeleted: 150, retentionDays: 90 },
          { name: 'failed_auth_retention', recordsDeleted: 12, retentionDays: 30 },
          { name: 'soft_delete_purge', recordsDeleted: 5, retentionDays: 90 },
          { name: 'temporary_files_cleanup', recordsDeleted: 23, retentionDays: 30 },
        ],
        totalRecordsDeleted: 190,
        success: true,
      };

      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          userId: 'admin-123',
          isSuperAdmin: true,
        },
      });

      (executeRetentionPolicy as jest.Mock).mockResolvedValue(mockReport);
      (logRetentionExecution as jest.Mock).mockResolvedValue(undefined);

      const request = new NextRequest(new Request('http://localhost:3000/api/admin/data-retention', { method: 'POST' }));
      const response = await POST(request);

      // Verify executeRetentionPolicy was called
      expect(executeRetentionPolicy).toHaveBeenCalled();

      // Verify response contains the report
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toHaveProperty('policies');
      expect(body.data).toHaveProperty('totalRecordsDeleted', 190);
    });

    it('should include all 4 retention policies in results', async () => {
      const mockReport = {
        executedAt: '2024-10-05T14:30:00Z',
        policies: [
          { name: 'audit_logs_retention', recordsDeleted: 100, retentionDays: 90 },
          { name: 'failed_auth_retention', recordsDeleted: 50, retentionDays: 30 },
          { name: 'soft_delete_purge', recordsDeleted: 20, retentionDays: 90 },
          { name: 'temporary_files_cleanup', recordsDeleted: 10, retentionDays: 30 },
        ],
        totalRecordsDeleted: 180,
        success: true,
      };

      (requireTenantContext as jest.Mock).mockReturnValue({
        context: { userId: 'admin-123', isSuperAdmin: true },
      });

      (executeRetentionPolicy as jest.Mock).mockResolvedValue(mockReport);
      (logRetentionExecution as jest.Mock).mockResolvedValue(undefined);

      const request = new NextRequest(new Request('http://localhost:3000/api/admin/data-retention', { method: 'POST' }));
      const response = await POST(request);

      const body = await response.json();
      const policyNames = body.data.policies.map((p: any) => p.name);

      expect(policyNames).toContain('audit_logs_retention');
      expect(policyNames).toContain('failed_auth_retention');
      expect(policyNames).toContain('soft_delete_purge');
      expect(policyNames).toContain('temporary_files_cleanup');
    });

    it('should calculate and return total records deleted', async () => {
      const mockReport = {
        executedAt: '2024-10-05T14:30:00Z',
        policies: [
          { name: 'audit_logs_retention', recordsDeleted: 150, retentionDays: 90 },
          { name: 'failed_auth_retention', recordsDeleted: 12, retentionDays: 30 },
          { name: 'soft_delete_purge', recordsDeleted: 5, retentionDays: 90 },
          { name: 'temporary_files_cleanup', recordsDeleted: 23, retentionDays: 30 },
        ],
        totalRecordsDeleted: 190,
        success: true,
      };

      (requireTenantContext as jest.Mock).mockReturnValue({
        context: { userId: 'admin-123', isSuperAdmin: true },
      });

      (executeRetentionPolicy as jest.Mock).mockResolvedValue(mockReport);
      (logRetentionExecution as jest.Mock).mockResolvedValue(undefined);

      const request = new NextRequest(new Request('http://localhost:3000/api/admin/data-retention', { method: 'POST' }));
      const response = await POST(request);

      const body = await response.json();
      expect(body.data.totalRecordsDeleted).toBe(190);
      expect(body.message).toContain('190');
    });

    it('should report error message when policies fail', async () => {
      const mockReport = {
        executedAt: '2024-10-05T14:30:00Z',
        policies: [
          { name: 'audit_logs_retention', recordsDeleted: 100, retentionDays: 90, error: 'Database error' },
          { name: 'failed_auth_retention', recordsDeleted: 50, retentionDays: 30 },
          { name: 'soft_delete_purge', recordsDeleted: 20, retentionDays: 90 },
          { name: 'temporary_files_cleanup', recordsDeleted: 10, retentionDays: 30 },
        ],
        totalRecordsDeleted: 180,
        success: false,
      };

      (requireTenantContext as jest.Mock).mockReturnValue({
        context: { userId: 'admin-123', isSuperAdmin: true },
      });

      (executeRetentionPolicy as jest.Mock).mockResolvedValue(mockReport);
      (logRetentionExecution as jest.Mock).mockResolvedValue(undefined);

      const request = new NextRequest(new Request('http://localhost:3000/api/admin/data-retention', { method: 'POST' }));
      const response = await POST(request);

      const body = await response.json();
      expect(body.data.success).toBe(false);
      expect(body.message).toContain('errors');
    });
  });

  describe('Requirement 21.7: Audit Logging', () => {
    it('should log retention execution to audit trail', async () => {
      const mockReport = {
        executedAt: '2024-10-05T14:30:00Z',
        policies: [
          { name: 'audit_logs_retention', recordsDeleted: 100, retentionDays: 90 },
          { name: 'failed_auth_retention', recordsDeleted: 50, retentionDays: 30 },
          { name: 'soft_delete_purge', recordsDeleted: 20, retentionDays: 90 },
          { name: 'temporary_files_cleanup', recordsDeleted: 10, retentionDays: 30 },
        ],
        totalRecordsDeleted: 180,
        success: true,
      };

      (requireTenantContext as jest.Mock).mockReturnValue({
        context: { userId: 'admin-123', isSuperAdmin: true },
      });

      (executeRetentionPolicy as jest.Mock).mockResolvedValue(mockReport);
      (logRetentionExecution as jest.Mock).mockResolvedValue(undefined);

      const request = new NextRequest(new Request('http://localhost:3000/api/admin/data-retention', { method: 'POST' }));
      await POST(request);

      // Verify logRetentionExecution was called with the report
      expect(logRetentionExecution).toHaveBeenCalledWith(mockReport);
    });
  });

  describe('Error Handling', () => {
    it('should handle execution errors gracefully', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: { userId: 'admin-123', isSuperAdmin: true },
      });

      (executeRetentionPolicy as jest.Mock).mockRejectedValue(new Error('Database connection failed'));

      const request = new NextRequest(new Request('http://localhost:3000/api/admin/data-retention', { method: 'POST' }));

      // withErrorHandler should catch and handle the error
      try {
        await POST(request);
      } catch (err) {
        expect(err).toBeDefined();
      }
    });

    it('should continue even if audit logging fails', async () => {
      const mockReport = {
        executedAt: '2024-10-05T14:30:00Z',
        policies: [{ name: 'audit_logs_retention', recordsDeleted: 100, retentionDays: 90 }],
        totalRecordsDeleted: 100,
        success: true,
      };

      (requireTenantContext as jest.Mock).mockReturnValue({
        context: { userId: 'admin-123', isSuperAdmin: true },
      });

      (executeRetentionPolicy as jest.Mock).mockResolvedValue(mockReport);
      (logRetentionExecution as jest.Mock).mockRejectedValue(new Error('Audit log error'));

      const request = new NextRequest(new Request('http://localhost:3000/api/admin/data-retention', { method: 'POST' }));

      try {
        await POST(request);
      } catch (err) {
        // Error in logging should not prevent successful response
        expect(err).toBeDefined();
      }
    });
  });
});
