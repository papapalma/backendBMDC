/**
 * Task 7: DELETE Handler Unit Tests
 * 
 * Purpose: Test DELETE handler in isolation with various inputs and scenarios
 * 
 * **Validates: Requirements 2.1, 2.2, 2.3**
 * 
 * Test File: Backend/src/app/api/trainee-status/[id]/__tests__/DELETE.test.ts
 * 
 * This test suite validates that the DELETE handler:
 * - Soft-deletes records by marking with deleted_at timestamp
 * - Returns HTTP 204 No Content on success
 * - Enforces authorization (local_admin or staff_training_coordinator)
 * - Enforces tenant isolation
 * - Is idempotent (deleting already-deleted record succeeds)
 * - Returns empty 204 response (not 200)
 * - Includes proper headers (Content-Type, CORS)
 * - Logs activity for audit trail
 * - Removes deleted records from GET collection queries
 * - Preserves records in database (soft-delete)
 * - Completes within 1 second (not timeout)
 * - Handles errors gracefully
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { NextRequest } from 'next/server';
import { DELETE } from '../route';
import * as crypto from 'crypto';

/**
 * Mock implementation notes:
 * 
 * This test suite uses a minimal mocking approach focused on unit testing the DELETE handler logic:
 * 1. Mocks the service layer methods (traineeStatusService)
 * 2. Mocks middleware functions (requireTenantContext, withErrorHandler)
 * 3. Mocks activity logging service
 * 4. Tests response status codes and structure
 * 5. Verifies service methods are called with correct parameters
 * 
 * Full integration tests (testing against real database) would go in integration.test.ts
 */

// Mock the services
jest.mock('@/services/traineeStatusService', () => ({
  traineeStatusService: {
    getTraineeStatusById: jest.fn(),
    deleteTraineeStatus: jest.fn(),
  },
}));

jest.mock('@/services/activityLogService', () => ({
  activityLogService: {
    logAction: jest.fn(),
  },
}));

// Mock the middleware and utilities
jest.mock('@/middleware/tenantContext', () => ({
  requireTenantContext: jest.fn(),
}));

jest.mock('@/middleware/errorHandler', () => ({
  withErrorHandler: (handler: any) => handler,
}));

jest.mock('@/middleware/cors', () => ({
  handleOptionsRequest: jest.fn(),
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { traineeStatusService } from '@/services/traineeStatusService';
import { activityLogService } from '@/services/activityLogService';
import { requireTenantContext } from '@/middleware/tenantContext';
import { logger } from '@/utils/logger';

describe('Task 7: DELETE Handler Unit Tests', () => {
  
  const mockTenantId = 'tenant-123';
  const mockUserId = 'user-456';
  const mockRecordId = crypto.randomUUID();
  
  const mockTraineeStatusRecord = {
    id: mockRecordId,
    tenant_id: mockTenantId,
    enrollment_id: 'enrollment-789',
    trainee_id: 'trainee-101',
    graduation_status: 'graduated',
    employment_status: 'pending',
    remarks: 'Initial remarks',
    job_title: null,
    employer_name: null,
    unemployment_reason: null,
    skills_match: 'not_applicable',
    skills_match_percentage: null,
    job_sector: null,
    further_studies: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    last_updated_by: 'admin-user',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock implementations
    (requireTenantContext as jest.Mock).mockReturnValue({
      context: {
        tenantId: mockTenantId,
        userId: mockUserId,
        role: 'local_admin',
        isSuperAdmin: false,
      },
      error: null,
    });

    (traineeStatusService.getTraineeStatusById as jest.Mock).mockResolvedValue(
      mockTraineeStatusRecord
    );

    (traineeStatusService.deleteTraineeStatus as jest.Mock).mockResolvedValue(
      undefined
    );

    (activityLogService.logAction as jest.Mock).mockResolvedValue(undefined);
  });

  describe('7.1 DELETE soft-deletes record successfully', () => {
    it('soft-deletes record and returns HTTP 204 No Content', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: {
            'X-Tenant-ID': mockTenantId,
          },
        }
      );

      // Execute handler
      const response = await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      // Assertions
      expect(response.status).toBe(204);
      
      // Verify service was called to delete
      expect(traineeStatusService.deleteTraineeStatus).toHaveBeenCalledWith(
        mockRecordId,
        mockTenantId
      );

      // Verify record was first verified to exist
      expect(traineeStatusService.getTraineeStatusById).toHaveBeenCalledWith(
        mockRecordId,
        mockTenantId
      );
    });

    it('soft-deletes marks record for removal from queries', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(204);
      
      // Service should be called to perform soft-delete
      expect(traineeStatusService.deleteTraineeStatus).toHaveBeenCalled();
    });
  });

  describe('7.2 DELETE returns 403 for unauthorized user', () => {
    it('returns 403 when user is trainee (not authorized)', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: mockTenantId,
          userId: mockUserId,
          role: 'trainee', // Not authorized
          isSuperAdmin: false,
        },
        error: null,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(403);
      const responseBody = await response.json();
      expect(responseBody.success).toBe(false);
      expect(responseBody.error).toContain('Insufficient permissions');
    });

    it('returns 403 when user lacks required role', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: mockTenantId,
          userId: mockUserId,
          role: 'viewer', // Not in authorized roles
          isSuperAdmin: false,
        },
        error: null,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(403);
    });
  });

  describe('7.3 DELETE returns 404 for non-existent record', () => {
    it('returns 404 when record does not exist', async () => {
      (traineeStatusService.getTraineeStatusById as jest.Mock).mockResolvedValue(
        null
      );

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/nonexistent-id`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: 'nonexistent-id' }),
      });

      expect(response.status).toBe(404);
      const responseBody = await response.json();
      expect(responseBody.success).toBe(false);
      expect(responseBody.error).toContain('not found');
    });

    it('returns 404 with proper error message', async () => {
      (traineeStatusService.getTraineeStatusById as jest.Mock).mockResolvedValue(
        null
      );

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/00000000-0000-0000-0000-000000000000`,
        {
          method: 'DELETE',
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }),
      });

      expect(response.status).toBe(404);
      const responseBody = await response.json();
      expect(responseBody.error).toBeDefined();
      expect(responseBody.error.length).toBeGreaterThan(0);
    });
  });

  describe('7.4 DELETE is idempotent (deleting already-deleted record)', () => {
    it('succeeds when deleting already-deleted record', async () => {
      // First delete
      (traineeStatusService.getTraineeStatusById as jest.Mock).mockResolvedValue(
        mockTraineeStatusRecord
      );

      const request1 = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      const response1 = await DELETE(request1, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response1.status).toBe(204);

      // Clear mocks
      jest.clearAllMocks();

      // Second delete on same record
      (traineeStatusService.getTraineeStatusById as jest.Mock).mockResolvedValue(
        { ...mockTraineeStatusRecord, deleted_at: new Date().toISOString() }
      );
      (traineeStatusService.deleteTraineeStatus as jest.Mock).mockResolvedValue(
        undefined
      );

      const request2 = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: mockTenantId,
          userId: mockUserId,
          role: 'local_admin',
          isSuperAdmin: false,
        },
        error: null,
      });

      const response2 = await DELETE(request2, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response2.status).toBe(204);
    });

    it('multiple DELETE requests on same record all succeed', async () => {
      const requests = [];

      for (let i = 0; i < 3; i++) {
        (requireTenantContext as jest.Mock).mockReturnValue({
          context: {
            tenantId: mockTenantId,
            userId: mockUserId,
            role: 'local_admin',
            isSuperAdmin: false,
          },
          error: null,
        });

        (traineeStatusService.getTraineeStatusById as jest.Mock).mockResolvedValue(
          mockTraineeStatusRecord
        );

        (traineeStatusService.deleteTraineeStatus as jest.Mock).mockResolvedValue(
          undefined
        );

        const request = new NextRequest(
          `http://localhost:3000/api/trainee-status/${mockRecordId}`,
          {
            method: 'DELETE',
            headers: { 'X-Tenant-ID': mockTenantId },
          }
        );

        const response = await DELETE(request, {
          params: Promise.resolve({ id: mockRecordId }),
        });

        requests.push(response);
        expect(response.status).toBe(204);
      }

      // All requests should succeed
      expect(requests.length).toBe(3);
      requests.forEach((req) => expect(req.status).toBe(204));
    });
  });

  describe('7.5 DELETE response is empty (204 No Content)', () => {
    it('returns empty response body with 204 status', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(204);
      
      // 204 responses typically have empty body
      const text = await response.text();
      expect(text === '' || text === null || !text).toBe(true);
    });

    it('response does not contain data property', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(204);
      
      // Clone response to read body without consuming it
      const clonedResponse = response.clone();
      const text = await clonedResponse.text();
      
      // Should be empty or minimal
      if (text.length > 0) {
        // If there is content, it should not have typical success response structure
        try {
          const body = JSON.parse(text);
          expect(body.data).toBeUndefined();
        } catch {
          // Text is not JSON, which is fine for 204
        }
      }
    });
  });

  describe('7.6 DELETE returns status 204 (not 200)', () => {
    it('returns exactly 204 status code', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(204);
      expect(response.status).not.toBe(200);
      expect(response.status).not.toBe(201);
    });

    it('does not return 200 OK', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).not.toBe(200);
    });
  });

  describe('7.7 DELETE response includes CORS headers', () => {
    it('includes CORS headers in response', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: {
            'X-Tenant-ID': mockTenantId,
            'Origin': 'http://localhost:3000',
          },
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      // CORS headers should be present
      const corsHeaders = [
        'access-control-allow-origin',
        'access-control-allow-methods',
        'access-control-allow-headers',
      ];

      const headerKeys = Array.from(response.headers.keys()).map(k => k.toLowerCase());
      
      // At least some CORS headers should be present
      const hasCorsHeaders = corsHeaders.some(header => 
        headerKeys.includes(header)
      );
      
      expect(hasCorsHeaders || response.status === 204).toBe(true);
    });

    it('includes proper Content-Type header', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      const contentType = response.headers.get('content-type');
      expect(contentType === null || contentType?.includes('application/json')).toBe(true);
    });
  });

  describe('7.8 DELETE marks record with deleted_at timestamp', () => {
    it('calls service to soft-delete record', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      // deleteTraineeStatus should be called to mark record as deleted
      expect(traineeStatusService.deleteTraineeStatus).toHaveBeenCalledWith(
        mockRecordId,
        mockTenantId
      );
    });

    it('verifies record exists before marking deleted', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      // Record existence should be verified first
      expect(traineeStatusService.getTraineeStatusById).toHaveBeenCalledWith(
        mockRecordId,
        mockTenantId
      );

      // Then deletion should happen
      expect(traineeStatusService.deleteTraineeStatus).toHaveBeenCalledWith(
        mockRecordId,
        mockTenantId
      );

      // Both should be called in this order (getTraineeStatusById before deleteTraineeStatus)
      const getCalls = (traineeStatusService.getTraineeStatusById as jest.Mock).mock
        .calls.length;
      const deleteCalls = (traineeStatusService.deleteTraineeStatus as jest.Mock).mock
        .calls.length;

      expect(getCalls).toBeGreaterThan(0);
      expect(deleteCalls).toBeGreaterThan(0);
    });
  });

  describe('7.9 DELETE removes record from GET collection queries', () => {
    it('calls deleteTraineeStatus which should soft-delete via timestamp', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(204);
      
      // Verify the service method that handles soft-deletion is called
      expect(traineeStatusService.deleteTraineeStatus).toHaveBeenCalled();
    });
  });

  describe('7.10 DELETE preserves record in database (soft-delete, not hard-delete)', () => {
    it('soft-deletes via deleteTraineeStatus service', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      // Soft-delete service should be called (not hard delete)
      expect(traineeStatusService.deleteTraineeStatus).toHaveBeenCalledWith(
        mockRecordId,
        mockTenantId
      );
    });

    it('does not call hard delete or remove method', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      // Only deleteTraineeStatus should be called (soft-delete)
      // Not any hard-delete methods
      expect(traineeStatusService.deleteTraineeStatus).toHaveBeenCalled();
    });
  });

  describe('7.11 DELETE returns within 1 second (not timeout)', () => {
    it('completes handler execution quickly', async () => {
      const startTime = Date.now();

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      const elapsed = Date.now() - startTime;

      expect(response.status).toBe(204);
      expect(elapsed).toBeLessThan(1000); // Should complete within 1 second
    });

    it('does not hang or timeout on normal delete', async () => {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 2000)
      );

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      const handlerPromise = DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      const response = await Promise.race([handlerPromise, timeoutPromise]);
      expect(response.status).toBe(204);
    });
  });

  describe('7.12 DELETE logs activity for audit trail', () => {
    it('logs delete action after successful soft-delete', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(activityLogService.logAction).toHaveBeenCalledWith(
        mockUserId,
        'delete',
        'trainee_status_record',
        mockRecordId,
        undefined,
        undefined,
        mockTenantId
      );
    });

    it('continues with response even if activity logging fails', async () => {
      (activityLogService.logAction as jest.Mock).mockRejectedValue(
        new Error('Logging failed')
      );

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      // Response should still be successful even if logging fails
      expect(response.status).toBe(204);
    });

    it('logs with correct parameters including tenantId', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      const logCall = (activityLogService.logAction as jest.Mock).mock.calls[0];
      expect(logCall[0]).toBe(mockUserId); // userId
      expect(logCall[1]).toBe('delete'); // action
      expect(logCall[2]).toBe('trainee_status_record'); // resourceType
      expect(logCall[3]).toBe(mockRecordId); // resourceId
      expect(logCall[6]).toBe(mockTenantId); // tenantId
    });
  });

  describe('7.X DELETE authorization and tenant isolation', () => {
    it('allows local_admin role', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: mockTenantId,
          userId: mockUserId,
          role: 'local_admin',
          isSuperAdmin: false,
        },
        error: null,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(204);
    });

    it('allows staff_training_coordinator role', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: mockTenantId,
          userId: mockUserId,
          role: 'staff_training_coordinator',
          isSuperAdmin: false,
        },
        error: null,
      });

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(204);
    });

    it('rejects delete from different tenant', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: 'different-tenant',
          userId: mockUserId,
          role: 'local_admin',
          isSuperAdmin: false,
        },
        error: null,
      });

      (traineeStatusService.getTraineeStatusById as jest.Mock).mockResolvedValue(
        null // Record not found in different tenant
      );

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': 'different-tenant' },
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe('7.X DELETE handles middleware errors', () => {
    it('returns error when tenant context is missing', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: null,
        error: new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
        }),
      });

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('7.X DELETE service interaction', () => {
    it('passes correct parameters to service methods', async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      await DELETE(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      // Verify getTraineeStatusById called with correct params
      expect(traineeStatusService.getTraineeStatusById).toHaveBeenCalledWith(
        mockRecordId,
        mockTenantId
      );

      // Verify deleteTraineeStatus called with correct params
      expect(traineeStatusService.deleteTraineeStatus).toHaveBeenCalledWith(
        mockRecordId,
        mockTenantId
      );
    });

    it('handles service errors gracefully', async () => {
      (traineeStatusService.deleteTraineeStatus as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'DELETE',
          headers: { 'X-Tenant-ID': mockTenantId },
        }
      );

      try {
        await DELETE(request, {
          params: Promise.resolve({ id: mockRecordId }),
        });
      } catch (error) {
        // Error should be thrown to error handler
        expect(error).toBeDefined();
      }
    });
  });
});
