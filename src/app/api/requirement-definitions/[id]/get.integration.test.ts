/**
 * Integration Tests for GET /api/requirement-definitions/{id} endpoint
 *
 * **Validates: Requirements FR1.1, FR2.2, NFR4 (Security)**
 * - FR1.1: Store requirement definitions with metadata
 * - FR2.2: View individual requirement details with submission stats
 * - NFR4: Security (tenant isolation, soft deletes)
 *
 * Tests verify:
 * - Successfully fetches requirement definition by ID
 * - Includes full details (display_name, description, is_mandatory, etc.)
 * - Includes submission_stats object with correct structure
 * - Tenant isolation: Returns 404 for cross-tenant access
 * - Returns 404 when requirement not found
 * - Returns 404 for soft-deleted requirements (deleted_at IS NOT NULL)
 * - Authentication required (401 if not authenticated)
 * - Response structure matches specification
 */

import { NextRequest } from 'next/server';
import { GET } from './route';
import { requireTenantContext } from '@/middleware/tenantContext';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { calculateSubmissionStats } from '../submission-stats';

// Mock dependencies
jest.mock('@/middleware/tenantContext');
jest.mock('@/lib/supabase-admin');
jest.mock('@/middleware/cors', () => ({
  handleOptionsRequest: jest.fn(),
  addCorsHeaders: jest.fn((response) => response),
}));
jest.mock('@/middleware/errorHandler', () => ({
  withErrorHandler: (handler: Function) => handler,
}));
jest.mock('../submission-stats', () => ({
  calculateSubmissionStats: jest.fn(),
}));

describe('GET /api/requirement-definitions/{id} - Integration Tests', () => {
  let mockRequest: Partial<NextRequest>;
  let mockTenantContext: any;
  let mockRequirement: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock authenticated tenant context
    mockTenantContext = {
      tenantId: 'tenant-uuid-001',
      userId: 'user-uuid-001',
      role: 'local_admin',
      isSuperAdmin: false,
    };

    // Mock a requirement definition
    mockRequirement = {
      id: 'req-uuid-001',
      tenant_id: 'tenant-uuid-001',
      requirement_type: 'birth_certificate_copy',
      display_name: 'Photocopy of Birth Certificate (NSO/PSA)',
      description: 'Original or certified photocopy from NSO or PSA',
      is_mandatory: true,
      is_active: true,
      applicability_rules: null,
      display_order: 2,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      deleted_at: null,
    };

    // Mock request
    mockRequest = {
      headers: { get: (key: string) => (key === 'authorization' ? 'Bearer valid-token' : null) },
      url: 'http://localhost:3003/api/requirement-definitions/req-uuid-001',
      method: 'GET',
    } as any;

    // Setup default mock responses
    (requireTenantContext as jest.Mock).mockReturnValue({
      context: mockTenantContext,
    });

    (calculateSubmissionStats as jest.Mock).mockResolvedValue({
      total_trainees: 100,
      pending_count: 40,
      submitted_count: 30,
      verified_count: 20,
      rejected_count: 5,
      waived_count: 5,
      completion_rate: 25.0,
    });
  });

  describe('Authentication', () => {
    it('should return 401 when user is not authenticated', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: new Response(
          JSON.stringify({ success: false, error: 'Unauthorized' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        ),
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(401);
    });

    it('should allow authenticated users (all roles can view)', async () => {
      // Trainees should be able to view requirement definitions
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: 'tenant-uuid-001',
          userId: 'user-uuid-001',
          role: 'trainee',
          isSuperAdmin: false,
        },
      });

      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockRequirement, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(200);
    });
  });

  describe('Success Cases', () => {
    it('should return 200 with requirement definition for valid request', async () => {
      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockRequirement, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
    });

    it('should include all required fields in response', async () => {
      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockRequirement, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      const body = await response.json();
      expect(body.data.id).toBe(mockRequirement.id);
      expect(body.data.requirement_type).toBe(mockRequirement.requirement_type);
      expect(body.data.display_name).toBe(mockRequirement.display_name);
      expect(body.data.description).toBe(mockRequirement.description);
      expect(body.data.is_mandatory).toBe(mockRequirement.is_mandatory);
      expect(body.data.is_active).toBe(mockRequirement.is_active);
    });

    it('should include full details from requirement_definitions table', async () => {
      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockRequirement, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      const body = await response.json();
      expect(body.data.applicability_rules).toBe(mockRequirement.applicability_rules);
      expect(body.data.display_order).toBe(mockRequirement.display_order);
    });

    it('should include submission_stats object with all required fields', async () => {
      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockRequirement, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      const body = await response.json();
      const stats = body.data.submission_stats;

      expect(stats).toBeDefined();
      expect(stats.total_trainees).toBe(100);
      expect(stats.pending_count).toBe(40);
      expect(stats.submitted_count).toBe(30);
      expect(stats.verified_count).toBe(20);
      expect(stats.rejected_count).toBe(5);
      expect(stats.waived_count).toBe(5);
      expect(stats.completion_rate).toBe(25.0);
    });

    it('should calculate submission_stats correctly', async () => {
      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockRequirement, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(calculateSubmissionStats).toHaveBeenCalledWith('req-uuid-001', 'tenant-uuid-001');
    });
  });

  describe('Tenant Isolation', () => {
    it('should filter by tenant_id in SELECT query', async () => {
      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockRequirement, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      // Verify tenant_id filter is applied
      expect(selectChain.eq).toHaveBeenCalledWith('tenant_id', 'tenant-uuid-001');
    });

    it('should return 404 when requirement belongs to different tenant', async () => {
      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('not found');
    });

    it('should not return requirement from cross-tenant access attempt', async () => {
      const otherTenantReq = { ...mockRequirement, tenant_id: 'other-tenant-uuid' };

      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(404);
    });
  });

  describe('404 Error Handling', () => {
    it('should return 404 when requirement not found', async () => {
      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'nonexistent-uuid' }) }
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Requirement definition not found');
    });

    it('should return 404 with correct error message', async () => {
      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-999' }) }
      );

      expect(response.status).toBe(404);
    });
  });

  describe('Soft Delete Handling', () => {
    it('should filter by deleted_at IS NULL in SELECT query', async () => {
      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockRequirement, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      // Verify soft delete filter is applied
      expect(selectChain.is).toHaveBeenCalledWith('deleted_at', null);
    });

    it('should return 404 when requirement is soft-deleted', async () => {
      const deletedRequirement = { ...mockRequirement, deleted_at: '2024-01-15T00:00:00Z' };

      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(404);
    });
  });

  describe('Response Format', () => {
    it('should return 200 status code on success', async () => {
      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockRequirement, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(200);
    });

    it('should return JSON response with success flag', async () => {
      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockRequirement, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it('should return requirement object in data field', async () => {
      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockRequirement, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      const body = await response.json();
      expect(body.data).toBeDefined();
      expect(typeof body.data).toBe('object');
    });

    it('should include Content-Type header', async () => {
      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockRequirement, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.headers.get('Content-Type')).toContain('application/json');
    });
  });

  describe('Query Validation', () => {
    it('should query requirement_definitions table', async () => {
      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockRequirement, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(supabaseAdmin.from).toHaveBeenCalledWith('requirement_definitions');
    });

    it('should select all fields from requirement definition', async () => {
      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockRequirement, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(selectChain.select).toHaveBeenCalledWith('*');
    });

    it('should filter by requirement ID', async () => {
      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockRequirement, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      // First eq call should be for ID
      const eqCalls = selectChain.eq.mock.calls;
      expect(eqCalls.some((call) => call[0] === 'id' && call[1] === 'req-uuid-001')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty requirement definition gracefully', async () => {
      const emptyReq = {
        ...mockRequirement,
        description: '',
        applicability_rules: null,
      };

      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: emptyReq, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.description).toBe('');
    });

    it('should handle requirement with complex applicability_rules', async () => {
      const complexReq = {
        ...mockRequirement,
        applicability_rules: {
          applicable_to: {
            marital_status: ['married'],
            age_range: { min: 18, max: 65 },
          },
        },
      };

      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: complexReq, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      const body = await response.json();
      expect(body.data.applicability_rules).toEqual(complexReq.applicability_rules);
    });

    it('should handle zero completion rate', async () => {
      (calculateSubmissionStats as jest.Mock).mockResolvedValue({
        total_trainees: 0,
        pending_count: 0,
        submitted_count: 0,
        verified_count: 0,
        rejected_count: 0,
        waived_count: 0,
        completion_rate: 0,
      });

      const selectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockRequirement, error: null }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(selectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-uuid-001' }) }
      );

      const body = await response.json();
      expect(body.data.submission_stats.completion_rate).toBe(0);
    });
  });
});
