/**
 * Unit Tests for Permission Verification Endpoint
 * POST /api/programs/{programId}/verify-access
 *
 * Tests permission checking, enrollment validation, capacity checking,
 * and error handling for the verify-access endpoint.
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5
 */

import { NextRequest } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { programService } from '@/services/programService';
import { handleOptionsRequest } from '@/middleware/cors';
import { activityLogService } from '@/services/activityLogService';

jest.mock('@/middleware/tenantContext');
jest.mock('@/lib/supabase-admin');
jest.mock('@/services/programService');
jest.mock('@/middleware/cors');
jest.mock('@/services/activityLogService');
jest.mock('@/middleware/errorHandler', () => ({
  withErrorHandler: (fn: any) => fn,
}));

import { POST, OPTIONS } from './route';

// Helper function to create a chainable mock query builder
const createMockQueryBuilder = () => ({
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
});

describe('Permission Verification Endpoint - POST /api/programs/{programId}/verify-access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // REQUEST VALIDATION - Requirement 10.1: Input Validation
  // ============================================================================

describe('Request Validation', () => {
    it('should return 400 when trainee_id is missing in request body', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = { json: jest.fn().mockResolvedValue({}) } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('trainee_id');
    });

    it('should return 400 when trainee_id is not a valid UUID format', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({ trainee_id: 'invalid-uuid' }),
      } as any;

      const response = await POST(mockRequest, mockContext);

      expect(response.status).toBe(400);
    });

    it('should return 400 when request body is invalid JSON', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(response.status).toBe(400);
    });

    it('should return 401 when authentication context is missing', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
          status: 401,
        }),
        context: null,
      });

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({ trainee_id: 'trainee-1' }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      expect(response.status).toBe(401);
    });
  });;

  // ============================================================================
  // REQUIREMENT 10.1: PROGRAM VALIDATION AND TENANT ISOLATION
  // Validates program exists in correct tenant and is active
  // ============================================================================

  describe('Requirement 10.1: Program Validation and Tenant Isolation', () => {
    it('should return 404 when program does not exist', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValue(createMockQueryBuilder());

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({ 
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6' 
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toContain('Program not found');
    });

    it('should deny access when program is not active (cancelled status)', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'cancelled', enrollment_limit: 30 },
            error: null,
          })
          .mockResolvedValue({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(body.data.can_access).toBe(false);
      expect(body.data.reason).toContain('not currently active');
    });

    it('should allow access when program is active and valid', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: 30 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);
      (programService.getCurrentEnrollmentCount as jest.Mock).mockResolvedValue(10);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.can_access).toBe(true);
    });
  });;

  // ============================================================================
  // REQUIREMENT 10.2: DUPLICATE ENROLLMENT PREVENTION
  // Checks for existing enrollment and prevents duplicates
  // ============================================================================

  describe('Requirement 10.2: Trainee Validation and Duplicate Enrollment Prevention', () => {
    it('should return 404 when trainee does not exist', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: 30 },
            error: null,
          })
          .mockResolvedValueOnce({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toContain('Trainee not found');
    });

    it('should deny access when trainee already enrolled (active status)', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: 30 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'enrollment-1', status: 'active' },
            error: null,
          }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(body.data.can_access).toBe(false);
      expect(body.data.has_enrolled).toBe(true);
      expect(body.data.reason).toContain('already enrolled');
      expect(body.data.details.existing_enrollment).toBe(true);
    });

    it('should deny access when trainee already enrolled (completed status)', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: 30 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'enrollment-1', status: 'completed' },
            error: null,
          }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(body.data.has_enrolled).toBe(true);
      expect(body.data.reason).toContain('already enrolled');
    });

    it('should return meaningful error message with enrollment status', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: 30 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'enrollment-1', status: 'pending_approval' },
            error: null,
          }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(body.data.reason).toContain('pending_approval');
    });
  });;

  // ============================================================================
  // REQUIREMENT 10.3: PROGRAM CAPACITY LIMITS ENFORCEMENT
  // Prevents enrollment when program capacity is reached
  // ============================================================================

  describe('Requirement 10.3: Program Capacity Limits Enforcement', () => {
    it('should deny access when program is at enrollment capacity', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: 10 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);
      (programService.getCurrentEnrollmentCount as jest.Mock).mockResolvedValue(10);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(body.data.can_access).toBe(false);
      expect(body.data.reason).toContain('at capacity');
      expect(body.data.details.capacity_available).toBe(false);
    });

    it('should include capacity information in denial message', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: 20 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);
      (programService.getCurrentEnrollmentCount as jest.Mock).mockResolvedValue(20);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(body.data.reason).toContain('20/20');
    });

    it('should allow access when capacity is available', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: 30 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);
      (programService.getCurrentEnrollmentCount as jest.Mock).mockResolvedValue(15);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(body.data.can_access).toBe(true);
      expect(body.data.details.capacity_available).toBe(true);
    });

    it('should allow access when program has no enrollment limit (null)', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: null },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(body.data.can_access).toBe(true);
    });
  });;

  // ============================================================================
  // REQUIREMENT 10.4: PREREQUISITES CHECKING
  // Verifies prerequisites (placeholder for future enhancement)
  // ============================================================================

  describe('Requirement 10.4: Prerequisites Checking', () => {
    it('should include prerequisites_met in response details', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: 30 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);
      (programService.getCurrentEnrollmentCount as jest.Mock).mockResolvedValue(10);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(body.data.details.prerequisites_met).toBeDefined();
      expect(body.data.details.prerequisites_met).toBe(true);
    });
  });;

  // ============================================================================
  // SUCCESS CASES - All Conditions Met
  // ============================================================================

  describe('Success Cases - All Conditions Met', () => {
    it('should grant access when all validations pass', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: 50 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);
      (programService.getCurrentEnrollmentCount as jest.Mock).mockResolvedValue(25);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.can_access).toBe(true);
      expect(body.data.has_enrolled).toBe(false);
      expect(body.data.reason).toBeUndefined();
      expect(body.data.details).toEqual({
        existing_enrollment: false,
        prerequisites_met: true,
        capacity_available: true,
        permission_denied: false,
      });
    });

    it('should return correct response structure', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: 100 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);
      (programService.getCurrentEnrollmentCount as jest.Mock).mockResolvedValue(50);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('can_access');
      expect(body.data).toHaveProperty('has_enrolled');
      expect(body.data).toHaveProperty('details');
    });
  });;

  // ============================================================================
  // ERROR MESSAGES AND DENIAL REASONS
  // Tests that meaningful error messages are returned for denied access
  // ============================================================================

  describe('Meaningful Error Messages for Denied Access', () => {
    it('should provide clear error message when program is inactive', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'completed', enrollment_limit: 30 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(body.data.can_access).toBe(false);
      expect(body.data.reason).toBe('Program is not currently active');
    });

    it('should provide error message with existing enrollment status', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: 30 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'enrollment-1', status: 'dropped' },
            error: null,
          }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(body.data.reason).toContain('dropped');
      expect(body.data.reason).toContain('already enrolled');
    });

    it('should provide clear capacity error with current enrollment numbers', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: 25 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);
      (programService.getCurrentEnrollmentCount as jest.Mock).mockResolvedValue(25);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(body.data.reason).toContain('25/25');
      expect(body.data.reason).toContain('at capacity');
    });

    it('should provide user-friendly message without technical jargon', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: 30 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);
      (programService.getCurrentEnrollmentCount as jest.Mock).mockResolvedValue(30);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      // Error message should be clear and user-friendly
      expect(body.data.reason).not.toContain('null');
      expect(body.data.reason).not.toContain('undefined');
      expect(body.data.reason).toMatch(/[A-Z]/); // Should start with capital letter
    });

    it('should include capacity details in response even when denied', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'trainee' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: 20 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);
      (programService.getCurrentEnrollmentCount as jest.Mock).mockResolvedValue(20);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(body.data.details).toHaveProperty('capacity_available');
      expect(body.data.details.capacity_available).toBe(false);
    });
  });;

  // ============================================================================
  // REQUIREMENT 10.5: AUDIT LOGGING - Permission Checks Logged for Audit
  // ============================================================================

  describe('Requirement 10.5: Audit Logging - Permission Checks Logged', () => {
    it('should log permission check when trainee access is granted', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'staff_training_coordinator' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: 50 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);
      (programService.getCurrentEnrollmentCount as jest.Mock).mockResolvedValue(25);
      (activityLogService.logAction as jest.Mock).mockResolvedValue(undefined);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      expect(response.status).toBe(200);

      // Verify audit log was created
      expect(activityLogService.logAction).toHaveBeenCalled();
      const logCall = (activityLogService.logAction as jest.Mock).mock.calls[0];
      expect(logCall[0]).toBe('user-1'); // userId
      expect(logCall[1]).toBe('permission_check'); // action
      expect(logCall[2]).toContain('program'); // resource type
    });

    it('should log permission check when trainee access is denied', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'staff_training_coordinator' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'cancelled', enrollment_limit: 30 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);
      (activityLogService.logAction as jest.Mock).mockResolvedValue(undefined);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(body.data.can_access).toBe(false);

      // Verify audit log was created for denied access
      expect(activityLogService.logAction).toHaveBeenCalled();
    });

    it('should log audit trail including denial reason', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'staff_training_coordinator' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: 10 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);
      (programService.getCurrentEnrollmentCount as jest.Mock).mockResolvedValue(10);
      (activityLogService.logAction as jest.Mock).mockResolvedValue(undefined);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(body.data.can_access).toBe(false);
      expect(body.data.reason).toContain('at capacity');

      // Verify audit log includes denial reason
      expect(activityLogService.logAction).toHaveBeenCalled();
      const logCall = (activityLogService.logAction as jest.Mock).mock.calls[0];
      // Metadata should include reason
      expect(logCall[4]).toHaveProperty('reason');
    });

    it('should log audit trail with duplicate enrollment detection', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'staff_training_coordinator' },
      });

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn()
          .mockResolvedValueOnce({
            data: { id: 'program-1', status: 'active', enrollment_limit: 30 },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'trainee-1', status: 'active' },
            error: null,
          })
          .mockResolvedValueOnce({
            data: { id: 'enrollment-1', status: 'active' },
            error: null,
          }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockQueryBuilder);
      (activityLogService.logAction as jest.Mock).mockResolvedValue(undefined);

      const mockContext = { params: Promise.resolve({ id: 'program-1' }) };
      const mockRequest = {
        json: jest.fn().mockResolvedValue({
          trainee_id: 'a1b2c3d4-e5f6-4718-b9d0-c1a2b3c4d5e6',
        }),
      } as any;

      const response = await POST(mockRequest, mockContext);
      const body = await response.json();

      expect(body.data.has_enrolled).toBe(true);

      // Verify audit log recorded duplicate enrollment attempt
      expect(activityLogService.logAction).toHaveBeenCalled();
    });
  });;

  // ============================================================================
  // CORS - OPTIONS Request
  // ============================================================================

  describe('CORS Support', () => {
    it('should handle OPTIONS preflight request', async () => {
      (handleOptionsRequest as jest.Mock).mockReturnValue(new Response(null, { status: 204 }));

      const mockRequest = {} as any;
      const response = await OPTIONS(mockRequest);
      expect(response.status).toBe(204);
    });
  });
});
