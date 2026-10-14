/**
 * Tests for PATCH /api/requirement-definitions/{id} endpoint
 *
 * **Validates: Requirements FR1.1, FR2.3**
 * - FR1.1: Store requirement definitions with metadata
 * - FR2.3: Edit requirement definitions
 *
 * Tests verify:
 * - Authentication and authorization (admin role required)
 * - Tenant isolation
 * - Field validation (display_name, description, is_mandatory, is_active)
 * - Partial updates (optional fields)
 * - Successful update response format
 * - Error handling (401, 403, 404, 400)
 */

import { NextRequest } from 'next/server';
import { PATCH, OPTIONS } from './route';
import { requireTenantContext } from '@/middleware/tenantContext';
import { supabaseAdmin } from '@/lib/supabase-admin';

// Mock dependencies
jest.mock('@/middleware/tenantContext');
jest.mock('@/lib/supabase-admin');
jest.mock('@/middleware/cors', () => ({
  handleOptionsRequest: jest.fn((req) =>
    new Response(null, { status: 200, headers: { 'Access-Control-Allow-Methods': 'PATCH,OPTIONS' } })
  ),
}));
jest.mock('@/middleware/errorHandler', () => ({
  withErrorHandler: (handler: Function) => handler,
}));
jest.mock('../submission-stats', () => ({
  calculateSubmissionStats: jest.fn().mockResolvedValue({
    total_trainees: 0,
    pending_count: 0,
    submitted_count: 0,
    verified_count: 0,
    rejected_count: 0,
    waived_count: 0,
    completion_rate: 0,
  }),
}));

describe('PATCH /api/requirement-definitions/{id}', () => {
  let mockRequest: Partial<NextRequest>;
  let mockTenantContext: any;
  let mockExistingRequirement: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock tenant context - admin role
    mockTenantContext = {
      tenantId: 'tenant-uuid-001',
      userId: 'user-uuid-001',
      role: 'admin',
      isSuperAdmin: false,
    };

    // Mock existing requirement definition
    mockExistingRequirement = {
      id: 'req-uuid-001',
      tenant_id: 'tenant-uuid-001',
      requirement_type: 'birth_certificate_copy',
      display_name: 'Photocopy of Birth Certificate (NSO/PSA)',
      description: 'Original or certified photocopy of birth certificate from NSO or PSA',
      is_mandatory: true,
      is_active: true,
      applicability_rules: null,
      display_order: 1,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      deleted_at: null,
    };

    // Mock NextRequest
    mockRequest = {
      headers: { get: (key: string) => (key === 'authorization' ? 'Bearer valid-token' : null) },
      url: 'http://localhost:3003/api/requirement-definitions/req-uuid-001',
      method: 'PATCH',
      json: jest.fn().mockResolvedValue({
        display_name: 'Updated Birth Certificate',
      }),
    } as any;

    // Setup default mock for requireTenantContext
    (requireTenantContext as jest.Mock).mockReturnValue({
      context: mockTenantContext,
    });
  });

  describe('Authentication & Authorization', () => {
    it('should return 401 when user is not authenticated', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: new Response(
          JSON.stringify({ success: false, error: 'Unauthorized' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        ),
      });

      const response = await PATCH(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(401);
    });

    it('should return 403 Forbidden when user is not admin', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: 'tenant-uuid-001',
          userId: 'user-uuid-001',
          role: 'trainee', // Non-admin role
          isSuperAdmin: false,
        },
      });

      const response = await PATCH(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('admin');
    });

    it('should allow super_admin role', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: 'tenant-uuid-001',
          userId: 'user-uuid-001',
          role: 'super_admin',
          isSuperAdmin: true,
        },
      });

      // Mock database query to return existing requirement
      const mockSelectChain = {
        select: jest.fn(function() { return this; }),
        eq: jest.fn(function() { return this; }),
        is: jest.fn(function() { return this; }),
        single: jest.fn().mockResolvedValue({ data: mockExistingRequirement, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockExistingRequirement, error: null }),
            }),
          }),
        }),
      });

      // Mock update query
      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { ...mockExistingRequirement, display_name: 'Updated' },
                error: null,
              }),
            }),
          }),
        }),
      });

      const response = await PATCH(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(200);
    });
  });

  describe('Request Body Validation', () => {
    it('should reject request with invalid JSON', async () => {
      const invalidRequest = {
        ...mockRequest,
        json: jest.fn().mockRejectedValue(new SyntaxError('Invalid JSON')),
      } as any;

      const response = await PATCH(
        invalidRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(400);
    });

    it('should reject display_name longer than 255 characters', async () => {
      const longName = 'a'.repeat(256);
      const invalidRequest = {
        ...mockRequest,
        json: jest.fn().mockResolvedValue({ display_name: longName }),
      } as any;

      const response = await PATCH(
        invalidRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.errors).toBeDefined();
    });

    it('should reject description longer than 5000 characters', async () => {
      const longDesc = 'a'.repeat(5001);
      const invalidRequest = {
        ...mockRequest,
        json: jest.fn().mockResolvedValue({ description: longDesc }),
      } as any;

      const response = await PATCH(
        invalidRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.success).toBe(false);
    });

    it('should reject unknown fields in request body', async () => {
      const invalidRequest = {
        ...mockRequest,
        json: jest.fn().mockResolvedValue({
          display_name: 'Updated',
          unknown_field: 'should not be here',
        }),
      } as any;

      const response = await PATCH(
        invalidRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.success).toBe(false);
    });

    it('should accept valid display_name field', async () => {
      const validRequest = {
        ...mockRequest,
        json: jest.fn().mockResolvedValue({ display_name: 'Updated Birth Certificate' }),
      } as any;

      // Mock database queries
      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockExistingRequirement, error: null }),
            }),
          }),
        }),
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { ...mockExistingRequirement, display_name: 'Updated Birth Certificate' },
                error: null,
              }),
            }),
          }),
        }),
      });

      const response = await PATCH(
        validRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(200);
    });

    it('should accept valid description field', async () => {
      const validRequest = {
        ...mockRequest,
        json: jest.fn().mockResolvedValue({ description: 'Updated description' }),
      } as any;

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockExistingRequirement, error: null }),
            }),
          }),
        }),
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { ...mockExistingRequirement, description: 'Updated description' },
                error: null,
              }),
            }),
          }),
        }),
      });

      const response = await PATCH(
        validRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(200);
    });

    it('should accept valid is_mandatory boolean field', async () => {
      const validRequest = {
        ...mockRequest,
        json: jest.fn().mockResolvedValue({ is_mandatory: false }),
      } as any;

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockExistingRequirement, error: null }),
            }),
          }),
        }),
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { ...mockExistingRequirement, is_mandatory: false },
                error: null,
              }),
            }),
          }),
        }),
      });

      const response = await PATCH(
        validRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(200);
    });

    it('should accept valid is_active boolean field', async () => {
      const validRequest = {
        ...mockRequest,
        json: jest.fn().mockResolvedValue({ is_active: false }),
      } as any;

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockExistingRequirement, error: null }),
            }),
          }),
        }),
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { ...mockExistingRequirement, is_active: false },
                error: null,
              }),
            }),
          }),
        }),
      });

      const response = await PATCH(
        validRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(200);
    });

    it('should accept all fields together', async () => {
      const validRequest = {
        ...mockRequest,
        json: jest.fn().mockResolvedValue({
          display_name: 'Updated Name',
          description: 'Updated description',
          is_mandatory: false,
          is_active: false,
        }),
      } as any;

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockExistingRequirement, error: null }),
            }),
          }),
        }),
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  ...mockExistingRequirement,
                  display_name: 'Updated Name',
                  description: 'Updated description',
                  is_mandatory: false,
                  is_active: false,
                },
                error: null,
              }),
            }),
          }),
        }),
      });

      const response = await PATCH(
        validRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(200);
    });

    it('should accept empty request body (no updates)', async () => {
      const emptyRequest = {
        ...mockRequest,
        json: jest.fn().mockResolvedValue({}),
      } as any;

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockExistingRequirement, error: null }),
            }),
          }),
        }),
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: mockExistingRequirement,
                error: null,
              }),
            }),
          }),
        }),
      });

      const response = await PATCH(
        emptyRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(200);
    });
  });

  describe('Requirement Lookup & Tenant Isolation', () => {
    it('should return 404 when requirement does not exist', async () => {
      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      });

      const response = await PATCH(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'nonexistent-uuid' }) }
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('not found');
    });

    it('should return 404 when requirement exists but in different tenant', async () => {
      const otherTenantReq = { ...mockExistingRequirement, tenant_id: 'other-tenant-uuid' };

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn(function(field, value) {
            if (field === 'tenant_id' && value !== 'tenant-uuid-001') {
              return { is: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: null }) }) };
            }
            return this;
          }).mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      });

      const response = await PATCH(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(404);
    });

    it('should return 404 when requirement is soft-deleted', async () => {
      const deletedReq = { ...mockExistingRequirement, deleted_at: '2024-01-15T00:00:00Z' };

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      });

      const response = await PATCH(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(404);
    });

    it('should verify tenant_id in both SELECT and UPDATE queries', async () => {
      const updateRequest = {
        ...mockRequest,
        json: jest.fn().mockResolvedValue({ display_name: 'Updated' }),
      } as any;

      const selectChain = {
        select: jest.fn().mockReturnValue(selectChain),
        eq: jest.fn().mockReturnValue(selectChain),
        is: jest.fn().mockReturnValue(selectChain),
        single: jest.fn().mockResolvedValue({ data: mockExistingRequirement, error: null }),
      };

      const updateChain = {
        update: jest.fn().mockReturnValue(updateChain),
        eq: jest.fn().mockReturnValue(updateChain),
        select: jest.fn().mockReturnValue(updateChain),
        single: jest.fn().mockResolvedValue({ data: { ...mockExistingRequirement, display_name: 'Updated' }, error: null }),
      };

      (supabaseAdmin.from as jest.Mock)
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce(updateChain);

      const response = await PATCH(
        updateRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(200);
      
      // Verify eq was called with tenant_id
      expect(selectChain.eq).toHaveBeenCalledWith('tenant_id', 'tenant-uuid-001');
      expect(updateChain.eq).toHaveBeenCalledWith('tenant_id', 'tenant-uuid-001');
    });
  });

  describe('Update Operation', () => {
    it('should update only provided fields', async () => {
      const updateRequest = {
        ...mockRequest,
        json: jest.fn().mockResolvedValue({ display_name: 'New Name' }),
      } as any;

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockExistingRequirement, error: null }),
            }),
          }),
        }),
      });

      const updateChain = {
        update: jest.fn(function(payload) {
          // Verify only display_name is in payload
          expect(payload.display_name).toBe('New Name');
          expect(payload.description).toBeUndefined();
          expect(payload.is_mandatory).toBeUndefined();
          expect(payload.is_active).toBeUndefined();
          return this;
        }).mockReturnValue(updateChain),
        eq: jest.fn().mockReturnValue(updateChain),
        select: jest.fn().mockReturnValue(updateChain),
        single: jest.fn().mockResolvedValue({
          data: { ...mockExistingRequirement, display_name: 'New Name' },
          error: null,
        }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce(updateChain);

      const response = await PATCH(
        updateRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(200);
      expect(updateChain.update).toHaveBeenCalled();
    });

    it('should set updated_at timestamp', async () => {
      const updateRequest = {
        ...mockRequest,
        json: jest.fn().mockResolvedValue({ display_name: 'New Name' }),
      } as any;

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockExistingRequirement, error: null }),
            }),
          }),
        }),
      });

      const updateChain = {
        update: jest.fn(function(payload) {
          expect(payload.updated_at).toBeDefined();
          expect(typeof payload.updated_at).toBe('string');
          return this;
        }).mockReturnValue(updateChain),
        eq: jest.fn().mockReturnValue(updateChain),
        select: jest.fn().mockReturnValue(updateChain),
        single: jest.fn().mockResolvedValue({
          data: { ...mockExistingRequirement, display_name: 'New Name' },
          error: null,
        }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce(updateChain);

      const response = await PATCH(
        updateRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(updateChain.update).toHaveBeenCalled();
    });
  });

  describe('Response Format', () => {
    it('should return 200 with updated requirement', async () => {
      const updateRequest = {
        ...mockRequest,
        json: jest.fn().mockResolvedValue({ display_name: 'Updated Name' }),
      } as any;

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockExistingRequirement, error: null }),
            }),
          }),
        }),
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { ...mockExistingRequirement, display_name: 'Updated Name' },
                error: null,
              }),
            }),
          }),
        }),
      });

      const response = await PATCH(
        updateRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
    });

    it('should return updated requirement data', async () => {
      const updateRequest = {
        ...mockRequest,
        json: jest.fn().mockResolvedValue({ display_name: 'Updated Name', is_active: false }),
      } as any;

      const updatedData = {
        ...mockExistingRequirement,
        display_name: 'Updated Name',
        is_active: false,
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockExistingRequirement, error: null }),
            }),
          }),
        }),
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: updatedData, error: null }),
            }),
          }),
        }),
      });

      const response = await PATCH(
        updateRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      const body = await response.json();
      expect(body.data.id).toBe(updatedData.id);
      expect(body.data.requirement_type).toBe(updatedData.requirement_type);
      expect(body.data.display_name).toBe('Updated Name');
      expect(body.data.is_active).toBe(false);
    });

    it('should include submission_stats in response', async () => {
      const updateRequest = {
        ...mockRequest,
        json: jest.fn().mockResolvedValue({ display_name: 'Updated Name' }),
      } as any;

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockExistingRequirement, error: null }),
            }),
          }),
        }),
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { ...mockExistingRequirement, display_name: 'Updated Name' },
                error: null,
              }),
            }),
          }),
        }),
      });

      const response = await PATCH(
        updateRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      const body = await response.json();
      expect(body.data.submission_stats).toBeDefined();
      expect(body.data.submission_stats.completion_rate).toBeDefined();
    });

    it('should include all required fields in response', async () => {
      const updateRequest = {
        ...mockRequest,
        json: jest.fn().mockResolvedValue({ display_name: 'Updated Name' }),
      } as any;

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockExistingRequirement, error: null }),
            }),
          }),
        }),
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { ...mockExistingRequirement, display_name: 'Updated Name' },
                error: null,
              }),
            }),
          }),
        }),
      });

      const response = await PATCH(
        updateRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      const body = await response.json();
      expect(body.data.id).toBeDefined();
      expect(body.data.requirement_type).toBeDefined();
      expect(body.data.display_name).toBeDefined();
      expect(body.data.description).toBeDefined();
      expect(body.data.is_mandatory).toBeDefined();
      expect(body.data.is_active).toBeDefined();
      expect(body.data.submission_stats).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle database error on requirement lookup', async () => {
      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: null,
                error: new Error('Database connection error'),
              }),
            }),
          }),
        }),
      });

      const response = await PATCH(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      // Should return 404 (not found) since error means requirement doesn't exist
      expect(response.status).toBe(404);
    });

    it('should handle database error on update', async () => {
      const updateRequest = {
        ...mockRequest,
        json: jest.fn().mockResolvedValue({ display_name: 'Updated Name' }),
      } as any;

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockExistingRequirement, error: null }),
            }),
          }),
        }),
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockRejectedValue(new Error('Database error')),
            }),
          }),
        }),
      });

      const response = await PATCH(
        updateRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect([400, 500]).toContain(response.status);
    });
  });

  describe('OPTIONS endpoint', () => {
    it('should handle OPTIONS request', async () => {
      const optionsRequest = {
        ...mockRequest,
        method: 'OPTIONS',
      } as any;

      const response = await OPTIONS(optionsRequest as NextRequest);

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Methods')).toBeDefined();
    });
  });
});
