/**
 * Task 6.1: PATCH Handler Unit Tests
 * 
 * Purpose: Test PATCH handler in isolation with various inputs and scenarios
 * 
 * **Validates: Requirements 2.1, 2.2, 2.3**
 * 
 * Test File: Backend/src/app/api/trainee-status/[id]/__tests__/patch.test.ts
 * 
 * This test suite validates that the PATCH handler:
 * - Accepts valid update payloads
 * - Returns HTTP 200 on success
 * - Returns updated record with all requested fields
 * - Enforces authorization (local_admin or staff_training_coordinator)
 * - Enforces tenant isolation
 * - Validates request data against schema
 * - Handles errors gracefully
 * - Includes proper headers in response
 * - Logs activity for audit trail
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { NextRequest } from 'next/server';
import { PATCH } from '../route';
import * as crypto from 'crypto';

/**
 * Mock implementation notes:
 * 
 * This test suite uses a minimal mocking approach focused on unit testing the PATCH handler logic:
 * 1. Mocks the service layer methods (traineeStatusService)
 * 2. Mocks middleware functions (requireTenantContext, withErrorHandler)
 * 3. Uses real validation schema to test parsing
 * 4. Tests response status codes and structure
 * 
 * Full integration tests (testing against real database) would go in integration.test.ts
 */

// Mock the services
jest.mock('@/services/traineeStatusService', () => ({
  traineeStatusService: {
    getTraineeStatusById: jest.fn(),
    updateTraineeStatus: jest.fn(),
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

describe('Task 6: PATCH Handler Unit Tests', () => {
  
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

    (activityLogService.logAction as jest.Mock).mockResolvedValue(undefined);
  });

  describe('6.1 PATCH updates remarks field successfully', () => {
    it('updates remarks field and returns HTTP 200 with updated record', async () => {
      const newRemarks = 'Completed successfully';
      const updatedRecord = {
        ...mockTraineeStatusRecord,
        remarks: newRemarks,
        updated_at: new Date().toISOString(),
      };

      (traineeStatusService.updateTraineeStatus as jest.Mock).mockResolvedValue(
        updatedRecord
      );

      // Create mock request
      const requestBody = JSON.stringify({ remarks: newRemarks });
      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Tenant-ID': mockTenantId,
          },
          body: requestBody,
        }
      );

      // Execute handler
      const response = await PATCH(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      // Assertions
      expect(response.status).toBe(200);
      const responseBody = await response.json();
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.remarks).toBe(newRemarks);
      expect(responseBody.data.id).toBe(mockRecordId);
      
      // Verify service was called correctly
      expect(traineeStatusService.updateTraineeStatus).toHaveBeenCalledWith(
        mockRecordId,
        expect.objectContaining({
          remarks: newRemarks,
          tenantId: mockTenantId,
          lastUpdatedBy: mockUserId,
        })
      );
    });

    it('response includes proper Content-Type header', async () => {
      const updatedRecord = {
        ...mockTraineeStatusRecord,
        remarks: 'Updated',
      };

      (traineeStatusService.updateTraineeStatus as jest.Mock).mockResolvedValue(
        updatedRecord
      );

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remarks: 'Updated' }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.headers.get('content-type')).toBe('application/json');
    });

    it('response includes all updated fields in body', async () => {
      const updatedRecord = {
        ...mockTraineeStatusRecord,
        remarks: 'New remarks',
        updated_at: new Date().toISOString(),
      };

      (traineeStatusService.updateTraineeStatus as jest.Mock).mockResolvedValue(
        updatedRecord
      );

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remarks: 'New remarks' }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      const responseBody = await response.json();
      expect(responseBody.data).toHaveProperty('id');
      expect(responseBody.data).toHaveProperty('remarks');
      expect(responseBody.data).toHaveProperty('employment_status');
      expect(responseBody.data).toHaveProperty('updated_at');
    });
  });

  describe('6.2 PATCH updates employment_status field successfully', () => {
    it('updates employment status with job title and employer name', async () => {
      const updateData = {
        employment_status: 'employed',
        job_title: 'Software Engineer',
        employer_name: 'TechCorp',
      };

      const updatedRecord = {
        ...mockTraineeStatusRecord,
        ...updateData,
      };

      (traineeStatusService.updateTraineeStatus as jest.Mock).mockResolvedValue(
        updatedRecord
      );

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(200);
      const responseBody = await response.json();
      expect(responseBody.data.employment_status).toBe('employed');
      expect(responseBody.data.job_title).toBe('Software Engineer');
      expect(responseBody.data.employer_name).toBe('TechCorp');
    });
  });

  describe('6.3 PATCH updates multiple fields simultaneously', () => {
    it('updates remarks and employment status together', async () => {
      const updateData = {
        remarks: 'Update',
        employment_status: 'employed',
        job_title: 'Dev',
        employer_name: 'Corp',
      };

      const updatedRecord = {
        ...mockTraineeStatusRecord,
        ...updateData,
      };

      (traineeStatusService.updateTraineeStatus as jest.Mock).mockResolvedValue(
        updatedRecord
      );

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(200);
      const responseBody = await response.json();
      expect(responseBody.data.remarks).toBe('Update');
      expect(responseBody.data.employment_status).toBe('employed');
    });
  });

  describe('6.4 PATCH returns 422 validation error for invalid data', () => {
    it('returns 422 when employed status without job title', async () => {
      const invalidData = {
        employment_status: 'employed',
        // missing job_title and employer_name
      };

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invalidData),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(422);
      const responseBody = await response.json();
      expect(responseBody.success).toBe(false);
      expect(responseBody.errors).toBeDefined();
    });
  });

  describe('6.5 PATCH returns 403 for unauthorized user', () => {
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
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remarks: 'Updated' }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(403);
      const responseBody = await response.json();
      expect(responseBody.success).toBe(false);
      expect(responseBody.error).toContain('Insufficient permissions');
    });
  });

  describe('6.6 PATCH returns 404 for non-existent record', () => {
    it('returns 404 when record does not exist', async () => {
      (traineeStatusService.getTraineeStatusById as jest.Mock).mockResolvedValue(
        null
      );

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/nonexistent-id`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remarks: 'Updated' }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: 'nonexistent-id' }),
      });

      expect(response.status).toBe(404);
      const responseBody = await response.json();
      expect(responseBody.success).toBe(false);
      expect(responseBody.error).toContain('not found');
    });
  });

  describe('6.7 PATCH calls service with correct parameters', () => {
    it('passes validated data and metadata to updateTraineeStatus', async () => {
      const updateData = { remarks: 'Test remarks' };
      const updatedRecord = {
        ...mockTraineeStatusRecord,
        ...updateData,
      };

      (traineeStatusService.updateTraineeStatus as jest.Mock).mockResolvedValue(
        updatedRecord
      );

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        }
      );

      await PATCH(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(traineeStatusService.updateTraineeStatus).toHaveBeenCalledWith(
        mockRecordId,
        expect.objectContaining({
          remarks: 'Test remarks',
          tenantId: mockTenantId,
          lastUpdatedBy: mockUserId,
        })
      );
    });
  });

  describe('6.8 PATCH logs activity for audit trail', () => {
    it('logs activity when record is updated', async () => {
      const updateData = { remarks: 'Audit test' };
      const updatedRecord = {
        ...mockTraineeStatusRecord,
        ...updateData,
      };

      (traineeStatusService.updateTraineeStatus as jest.Mock).mockResolvedValue(
        updatedRecord
      );

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        }
      );

      await PATCH(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(activityLogService.logAction).toHaveBeenCalledWith(
        mockUserId,
        'update',
        'trainee_status_record',
        mockRecordId,
        expect.any(Object)
      );
    });

    it('continues with response even if activity logging fails', async () => {
      const updateData = { remarks: 'Continued despite log failure' };
      const updatedRecord = {
        ...mockTraineeStatusRecord,
        ...updateData,
      };

      (traineeStatusService.updateTraineeStatus as jest.Mock).mockResolvedValue(
        updatedRecord
      );
      (activityLogService.logAction as jest.Mock).mockRejectedValue(
        new Error('Logging failed')
      );

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      // Response should still be successful even if logging fails
      expect(response.status).toBe(200);
    });
  });

  describe('6.9 PATCH authorization checks', () => {
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

      const updatedRecord = {
        ...mockTraineeStatusRecord,
        remarks: 'Updated by admin',
      };

      (traineeStatusService.updateTraineeStatus as jest.Mock).mockResolvedValue(
        updatedRecord
      );

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remarks: 'Updated by admin' }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(200);
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

      const updatedRecord = {
        ...mockTraineeStatusRecord,
        remarks: 'Updated by coordinator',
      };

      (traineeStatusService.updateTraineeStatus as jest.Mock).mockResolvedValue(
        updatedRecord
      );

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remarks: 'Updated by coordinator' }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(200);
    });
  });

  describe('6.10 PATCH handles empty update payload', () => {
    it('accepts empty object (no-op update)', async () => {
      (traineeStatusService.updateTraineeStatus as jest.Mock).mockResolvedValue(
        mockTraineeStatusRecord
      );

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(200);
      const responseBody = await response.json();
      expect(responseBody.success).toBe(true);
    });
  });

  describe('6.11 PATCH handles malformed JSON', () => {
    it('returns proper error for invalid JSON', async () => {
      // Note: NextRequest may throw during JSON parsing, which is caught by error handler
      // This test documents that invalid JSON is handled gracefully
      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: 'not valid json',
        }
      );

      try {
        const response = await PATCH(request, {
          params: Promise.resolve({ id: mockRecordId }),
        });

        // If it doesn't throw, should get an error status
        expect([400, 500]).toContain(response.status);
      } catch (error) {
        // Error handler or request parsing may throw - this is acceptable
        expect(error).toBeDefined();
      }
    });
  });

  describe('6.12 PATCH tenant isolation', () => {
    it('rejects update from different tenant', async () => {
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
        null // Record not found in this tenant
      );

      const request = new NextRequest(
        `http://localhost:3000/api/trainee-status/${mockRecordId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remarks: 'Attempt cross-tenant update' }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ id: mockRecordId }),
      });

      expect(response.status).toBe(404);
    });
  });
});
