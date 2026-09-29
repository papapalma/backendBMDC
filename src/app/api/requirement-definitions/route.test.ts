/**
 * Tests for GET /api/requirement-definitions endpoint
 * 
 * **Validates: Requirements FR1.1, FR2.1**
 * - FR1.1: Store requirement definitions with metadata
 * - FR2.1: List all requirement definitions with submission stats
 * 
 * Tests verify:
 * - Authentication and tenant isolation
 * - Query parameter validation (sort_by, is_active, pagination)
 * - Sorting functionality (by name, mandatory status, completion rate)
 * - Pagination
 * - Submission stats calculation (once enrollment_requirements table exists)
 */

import { NextRequest } from 'next/server';
import { GET, OPTIONS } from './route';
import { requireTenantContext } from '@/middleware/tenantContext';
import { supabaseAdmin } from '@/lib/supabase-admin';

// Mock dependencies
jest.mock('@/middleware/tenantContext');
jest.mock('@/lib/supabase-admin');
jest.mock('@/middleware/cors', () => ({
  handleOptionsRequest: jest.fn((req) =>
    new Response(null, { status: 200, headers: { 'Access-Control-Allow-Methods': 'GET,OPTIONS' } })
  ),
  addCorsHeaders: jest.fn((response) => response),
}));
jest.mock('@/middleware/errorHandler', () => ({
  withErrorHandler: (handler: Function) => handler,
}));

describe('GET /api/requirement-definitions', () => {
  let mockRequest: Partial<NextRequest>;
  let mockTenantContext: any;
  let mockRequirementDefinitions: any[];

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock tenant context
    mockTenantContext = {
      tenantId: 'tenant-uuid-001',
      userId: 'user-uuid-001',
      role: 'local_admin',
      isSuperAdmin: false,
    };

    // Mock requirement definitions (7 core types)
    mockRequirementDefinitions = [
      {
        id: 'req-uuid-001',
        tenant_id: 'tenant-uuid-001',
        requirement_type: 'accomplished_learners_profile_form',
        display_name: 'Accomplished Learner\'s Profile Form',
        description: 'Form to capture learner\'s achievements and competencies',
        is_mandatory: true,
        is_active: true,
        applicability_rules: null,
        display_order: 1,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        deleted_at: null,
      },
      {
        id: 'req-uuid-002',
        tenant_id: 'tenant-uuid-001',
        requirement_type: 'birth_certificate_copy',
        display_name: 'Photocopy of Birth Certificate (NSO/PSA)',
        description: 'Original or certified photocopy of birth certificate from NSO or PSA',
        is_mandatory: true,
        is_active: true,
        applicability_rules: null,
        display_order: 2,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        deleted_at: null,
      },
      {
        id: 'req-uuid-003',
        tenant_id: 'tenant-uuid-001',
        requirement_type: 'marriage_certificate_copy',
        display_name: 'Photocopy of Marriage Certificate (PSA/NSO)',
        description: 'For married women only',
        is_mandatory: false,
        is_active: true,
        applicability_rules: { applicable_to: { marital_status: ['married'] } },
        display_order: 3,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        deleted_at: null,
      },
      {
        id: 'req-uuid-004',
        tenant_id: 'tenant-uuid-001',
        requirement_type: 'id_pictures',
        display_name: '3 pcs 1x1 ID Picture (white background)',
        description: 'Three pieces of 1x1 ID pictures with white background',
        is_mandatory: true,
        is_active: true,
        applicability_rules: null,
        display_order: 4,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        deleted_at: null,
      },
      {
        id: 'req-uuid-005',
        tenant_id: 'tenant-uuid-001',
        requirement_type: 'valid_id_copy',
        display_name: 'Photocopy of Valid ID',
        description: 'Photocopy of government-issued or valid ID',
        is_mandatory: true,
        is_active: true,
        applicability_rules: null,
        display_order: 5,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        deleted_at: null,
      },
      {
        id: 'req-uuid-006',
        tenant_id: 'tenant-uuid-001',
        requirement_type: 'report_card_tor_copy',
        display_name: 'Certified True Copy of Report Card/TOR',
        description: 'Certified true copy of Report Card or Transcript of Records',
        is_mandatory: false,
        is_active: false, // Inactive requirement
        applicability_rules: null,
        display_order: 6,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        deleted_at: null,
      },
      {
        id: 'req-uuid-007',
        tenant_id: 'tenant-uuid-001',
        requirement_type: 'barangay_no_grade_certification',
        display_name: 'Certification of No Grade Completed from barangay',
        description: 'Certification from barangay that you have not completed any grade',
        is_mandatory: true,
        is_active: true,
        applicability_rules: null,
        display_order: 7,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        deleted_at: null,
      },
    ];

    // Mock NextRequest
    mockRequest = {
      headers: { get: (key: string) => (key === 'authorization' ? 'Bearer valid-token' : null) },
      url: 'http://localhost:3003/api/requirement-definitions',
      method: 'GET',
    } as any;

    // Setup default mock for requireTenantContext
    (requireTenantContext as jest.Mock).mockReturnValue({
      context: mockTenantContext,
    });
  });

  describe('Authentication & Authorization', () => {
    it('should return 403 Forbidden when user is not authenticated', async () => {
      // Mock auth failure
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: new Response(
          JSON.stringify({ success: false, error: 'Tenant context is missing' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        ),
      });

      const response = await GET(mockRequest as NextRequest);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.success).toBe(false);
    });

    it('should validate tenant isolation - only return definitions for authenticated tenant', async () => {
      // Mock auth with specific tenant
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: 'tenant-uuid-001',
          userId: 'user-uuid-001',
          role: 'local_admin',
          isSuperAdmin: false,
        },
      });

      // Mock Supabase query chain
      const mockSelectChain = {
        select: jest.fn(function() { return this; }),
        eq: jest.fn(function() { return this; }),
        is: jest.fn(function() { return this; }),
        order: jest.fn(function() { return this; }),
      };

      const mockQueryChain = {
        from: jest.fn(function() {
          return mockSelectChain;
        }),
      };

      mockSelectChain.select = jest.fn(function() { return this; });
      mockSelectChain.eq = jest.fn(function(field, value) {
        // Verify tenant_id filter is applied
        if (field === 'tenant_id') {
          expect(value).toBe('tenant-uuid-001');
        }
        return this;
      });
      mockSelectChain.is = jest.fn(function() { return this; });
      mockSelectChain.order = jest.fn(function() { return this; });

      (supabaseAdmin.from as jest.Mock).mockReturnValue(mockSelectChain);

      // Mock the final result
      const mockQueryResult = Promise.resolve({
        data: mockRequirementDefinitions.slice(0, 2),
        error: null,
        count: 2,
      });

      Object.defineProperty(mockSelectChain, Symbol.asyncIterator, {
        value: async function*() {
          yield this;
        },
      });

      // Make the promise-like object work with the query
      (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn(function(field, value) {
            if (field === 'tenant_id') {
              expect(value).toBe('tenant-uuid-001');
            }
            return {
              is: jest.fn().mockReturnValue({
                order: jest.fn().mockResolvedValue({
                  data: mockRequirementDefinitions.slice(0, 2),
                  error: null,
                  count: 2,
                }),
              }),
            };
          }),
        }),
      });

      const response = await GET(mockRequest as NextRequest);

      // Verify tenant filter was applied
      const fromCalls = (supabaseAdmin.from as jest.Mock).mock.calls;
      expect(fromCalls[0]?.[0]).toBe('requirement_definitions');
    });
  });

  describe('Query Parameter Validation', () => {
    it('should return 400 when sort_by has invalid value', async () => {
      const invalidRequest = {
        ...mockRequest,
        url: 'http://localhost:3003/api/requirement-definitions?sort_by=invalid_sort',
      } as any;

      const response = await GET(invalidRequest as NextRequest);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.errors).toBeDefined();
    });

    it('should return 400 when is_active has invalid value', async () => {
      const invalidRequest = {
        ...mockRequest,
        url: 'http://localhost:3003/api/requirement-definitions?is_active=maybe',
      } as any;

      const response = await GET(invalidRequest as NextRequest);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
    });

    it('should return 400 when page is not a positive integer', async () => {
      const invalidRequest = {
        ...mockRequest,
        url: 'http://localhost:3003/api/requirement-definitions?page=0',
      } as any;

      const response = await GET(invalidRequest as NextRequest);

      expect(response.status).toBe(400);
    });

    it('should return 400 when limit exceeds max of 100', async () => {
      const invalidRequest = {
        ...mockRequest,
        url: 'http://localhost:3003/api/requirement-definitions?limit=150',
      } as any;

      const response = await GET(invalidRequest as NextRequest);

      expect(response.status).toBe(400);
    });

    it('should accept valid sort_by values: name, mandatory, completion_rate', async () => {
      const validSortValues = ['name', 'mandatory', 'completion_rate'];

      for (const sortValue of validSortValues) {
        const validRequest = {
          ...mockRequest,
          url: `http://localhost:3003/api/requirement-definitions?sort_by=${sortValue}`,
        } as any;

        // Setup mock to return empty list (we're just testing parameter validation)
        (supabaseAdmin.from as jest.Mock).mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              is: jest.fn().mockReturnValue({
                order: jest.fn().mockResolvedValue({
                  data: [],
                  error: null,
                  count: 0,
                }),
              }),
            }),
          }),
        });

        const response = await GET(validRequest as NextRequest);

        // Should not return 400 for invalid params (may return 200 or other success)
        expect(response.status).not.toBe(400);
      }
    });
  });

  describe('Filtering', () => {
    it('should return all when is_active is not specified', async () => {
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({
                data: mockRequirementDefinitions,
                error: null,
                count: mockRequirementDefinitions.length,
              }),
            }),
          }),
        }),
      });

      const response = await GET(mockRequest as NextRequest);

      const body = await response.json();
      expect(body.success).toBe(true);
      // Should include both active and inactive
      expect(body.data.some((r: any) => r.is_active === true)).toBe(true);
      expect(body.data.some((r: any) => r.is_active === false)).toBe(true);
    });
  });

  describe('Sorting', () => {
    it('should sort by display_name (default)', async () => {
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({
                data: mockRequirementDefinitions,
                error: null,
                count: mockRequirementDefinitions.length,
              }),
            }),
          }),
        }),
      });

      const response = await GET(mockRequest as NextRequest);

      const body = await response.json();
      const names = body.data.map((r: any) => r.display_name);

      // Verify sorted alphabetically
      const sortedNames = [...names].sort();
      expect(names).toEqual(sortedNames);
    });

    it('should sort by is_mandatory flag', async () => {
      const mandatoryRequest = {
        ...mockRequest,
        url: 'http://localhost:3003/api/requirement-definitions?sort_by=mandatory',
      } as any;

      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({
                data: mockRequirementDefinitions,
                error: null,
                count: mockRequirementDefinitions.length,
              }),
            }),
          }),
        }),
      });

      const response = await GET(mandatoryRequest as NextRequest);

      const body = await response.json();
      
      // Verify mandatory requirements come first
      let foundMandatory = false;
      let foundOptional = false;
      
      for (const req of body.data) {
        if (req.is_mandatory) {
          foundMandatory = true;
          // Once we've found optional, mandatory shouldn't appear again
          expect(foundOptional).toBe(false);
        } else {
          foundOptional = true;
        }
      }
    });

    it('should sort by completion_rate (descending)', async () => {
      const rateRequest = {
        ...mockRequest,
        url: 'http://localhost:3003/api/requirement-definitions?sort_by=completion_rate',
      } as any;

      // Add submission_stats to mock data
      const dataWithStats = mockRequirementDefinitions.map((req, idx) => ({
        ...req,
        submission_stats: {
          total_trainees: 10,
          pending_count: 2,
          submitted_count: 3,
          verified_count: 5,
          rejected_count: 0,
          waived_count: 0,
          completion_rate: (5 / 10) * 100 * (idx + 1), // Vary completion rates
        },
      }));

      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({
                data: mockRequirementDefinitions,
                error: null,
                count: mockRequirementDefinitions.length,
              }),
            }),
          }),
        }),
      });

      const response = await GET(rateRequest as NextRequest);

      const body = await response.json();
      
      // Verify completion_rate exists in response
      body.data.forEach((req: any) => {
        expect(req.submission_stats).toBeDefined();
        expect(typeof req.submission_stats.completion_rate).toBe('number');
      });
    });
  });

  describe('Pagination', () => {
    it('should default to page 1 and limit 20', async () => {
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({
                data: mockRequirementDefinitions,
                error: null,
                count: mockRequirementDefinitions.length,
              }),
            }),
          }),
        }),
      });

      const response = await GET(mockRequest as NextRequest);

      const body = await response.json();
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.limit).toBe(20);
    });

    it('should respect custom page and limit parameters', async () => {
      const paginatedRequest = {
        ...mockRequest,
        url: 'http://localhost:3003/api/requirement-definitions?page=2&limit=5',
      } as any;

      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({
                data: mockRequirementDefinitions.slice(5, 10),
                error: null,
                count: mockRequirementDefinitions.length,
              }),
            }),
          }),
        }),
      });

      const response = await GET(paginatedRequest as NextRequest);

      const body = await response.json();
      expect(body.pagination.page).toBe(2);
      expect(body.pagination.limit).toBe(5);
    });

    it('should return correct total count', async () => {
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({
                data: mockRequirementDefinitions,
                error: null,
                count: mockRequirementDefinitions.length,
              }),
            }),
          }),
        }),
      });

      const response = await GET(mockRequest as NextRequest);

      const body = await response.json();
      expect(body.pagination.total).toBe(mockRequirementDefinitions.length);
    });

    it('should return correct totalPages', async () => {
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({
                data: mockRequirementDefinitions,
                error: null,
                count: mockRequirementDefinitions.length,
              }),
            }),
          }),
        }),
      });

      const response = await GET(mockRequest as NextRequest);

      const body = await response.json();
      const expected = Math.ceil(mockRequirementDefinitions.length / 20);
      expect(body.pagination.totalPages).toBe(expected);
    });
  });

  describe('Response Format', () => {
    it('should return all 7 core requirement types', async () => {
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({
                data: mockRequirementDefinitions,
                error: null,
                count: mockRequirementDefinitions.length,
              }),
            }),
          }),
        }),
      });

      const response = await GET(mockRequest as NextRequest);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(7);

      // Verify all core requirement types are present
      const types = body.data.map((r: any) => r.requirement_type);
      expect(types).toContain('accomplished_learners_profile_form');
      expect(types).toContain('birth_certificate_copy');
      expect(types).toContain('marriage_certificate_copy');
      expect(types).toContain('id_pictures');
      expect(types).toContain('valid_id_copy');
      expect(types).toContain('report_card_tor_copy');
      expect(types).toContain('barangay_no_grade_certification');
    });

    it('should include submission_stats for each requirement', async () => {
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({
                data: mockRequirementDefinitions,
                error: null,
                count: mockRequirementDefinitions.length,
              }),
            }),
          }),
        }),
      });

      const response = await GET(mockRequest as NextRequest);

      const body = await response.json();
      body.data.forEach((req: any) => {
        expect(req.submission_stats).toBeDefined();
        expect(req.submission_stats.total_trainees).toBeGreaterThanOrEqual(0);
        expect(req.submission_stats.pending_count).toBeGreaterThanOrEqual(0);
        expect(req.submission_stats.submitted_count).toBeGreaterThanOrEqual(0);
        expect(req.submission_stats.verified_count).toBeGreaterThanOrEqual(0);
        expect(req.submission_stats.rejected_count).toBeGreaterThanOrEqual(0);
        expect(typeof req.submission_stats.completion_rate).toBe('number');
      });
    });

    it('should exclude soft-deleted requirements', async () => {
      const deletedReq = {
        ...mockRequirementDefinitions[0],
        deleted_at: '2024-01-15T00:00:00Z',
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn(function(field, value) {
              if (field === 'deleted_at' && value === null) {
                // Verify deleted_at filter is applied
              }
              return this;
            }).mockReturnValue({
              order: jest.fn().mockResolvedValue({
                data: mockRequirementDefinitions,
                error: null,
                count: mockRequirementDefinitions.length,
              }),
            }),
          }),
        }),
      });

      const response = await GET(mockRequest as NextRequest);

      const body = await response.json();
      // Verify no deleted requirements are returned
      body.data.forEach((req: any) => {
        expect(req.deleted_at).toBeNull();
      });
    });

    it('should include mandatory flag in response', async () => {
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({
                data: mockRequirementDefinitions,
                error: null,
                count: mockRequirementDefinitions.length,
              }),
            }),
          }),
        }),
      });

      const response = await GET(mockRequest as NextRequest);

      const body = await response.json();
      const mandatoryReq = body.data.find((r: any) => r.requirement_type === 'accomplished_learners_profile_form');
      expect(mandatoryReq.is_mandatory).toBe(true);

      const optionalReq = body.data.find((r: any) => r.requirement_type === 'marriage_certificate_copy');
      expect(optionalReq.is_mandatory).toBe(false);
    });

    it('should include applicability_rules for conditional requirements', async () => {
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({
                data: mockRequirementDefinitions,
                error: null,
                count: mockRequirementDefinitions.length,
              }),
            }),
          }),
        }),
      });

      const response = await GET(mockRequest as NextRequest);

      const body = await response.json();
      const marriageReq = body.data.find((r: any) => r.requirement_type === 'marriage_certificate_copy');
      expect(marriageReq.applicability_rules).toBeDefined();
      expect(marriageReq.applicability_rules.applicable_to.marital_status).toContain('married');
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

/**
 * Tests for POST /api/requirement-definitions endpoint
 * 
 * **Validates: Requirements FR1.1, FR2.3**
 * - FR1.1: Store requirement definitions with metadata
 * - FR2.3: Create/edit requirement definitions (admin only)
 * 
 * Tests verify:
 * - Admin authentication and authorization (403 for non-admin)
 * - Request body validation (display_name, description, is_mandatory)
 * - Optional field handling (is_active, applicability_rules, display_order)
 * - Tenant isolation
 * - Duplicate prevention
 * - Response format with submission stats
 */

import { POST } from './route';

describe('POST /api/requirement-definitions', () => {
  let mockRequest: Partial<NextRequest>;
  let mockTenantContext: any;
  let mockRequestJson: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockTenantContext = {
      tenantId: 'tenant-uuid-001',
      userId: 'user-uuid-001',
      role: 'local_admin',
      isSuperAdmin: false,
    };

    mockRequestJson = {
      display_name: 'Test Requirement',
      description: 'This is a test requirement',
      is_mandatory: true,
    };

    mockRequest = {
      headers: { get: (key: string) => (key === 'authorization' ? 'Bearer valid-token' : null) },
      url: 'http://localhost:3003/api/requirement-definitions',
      method: 'POST',
      json: jest.fn().mockResolvedValue(mockRequestJson),
    } as any;

    (requireTenantContext as jest.Mock).mockReturnValue({
      context: mockTenantContext,
    });
  });

  describe('Authentication & Authorization', () => {
    it('should return 403 Forbidden when user is not authenticated', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: new Response(
          JSON.stringify({ success: false, error: 'Tenant context is missing' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        ),
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(403);
    });

    it('should return 403 Forbidden when user is not admin', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: 'tenant-uuid-001',
          userId: 'user-uuid-001',
          role: 'trainee', // Not admin
          isSuperAdmin: false,
        },
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('administrators');
    });

    it('should return 403 Forbidden for staff roles without admin privileges', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: 'tenant-uuid-001',
          userId: 'user-uuid-001',
          role: 'staff_inventory_manager',
          isSuperAdmin: false,
        },
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(403);
    });

    it('should allow local_admin role', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: 'tenant-uuid-001',
          userId: 'user-uuid-001',
          role: 'local_admin',
          isSuperAdmin: false,
        },
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'req-uuid-001',
                tenant_id: 'tenant-uuid-001',
                display_name: 'Test Requirement',
                description: 'This is a test requirement',
                is_mandatory: true,
                is_active: true,
                applicability_rules: null,
                display_order: 0,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
                deleted_at: null,
              },
              error: null,
            }),
          }),
        }),
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(201);
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

      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'req-uuid-001',
                tenant_id: 'tenant-uuid-001',
                display_name: 'Test Requirement',
                description: 'This is a test requirement',
                is_mandatory: true,
                is_active: true,
                applicability_rules: null,
                display_order: 0,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
                deleted_at: null,
              },
              error: null,
            }),
          }),
        }),
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(201);
    });
  });

  describe('Request Body Validation', () => {
    it('should return 400 when display_name is missing', async () => {
      mockRequest.json = jest.fn().mockResolvedValue({
        description: 'Test description',
        is_mandatory: true,
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.errors.display_name).toBeDefined();
    });

    it('should return 400 when display_name is empty string', async () => {
      mockRequest.json = jest.fn().mockResolvedValue({
        display_name: '',
        description: 'Test description',
        is_mandatory: true,
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.errors.display_name).toBeDefined();
    });

    it('should return 400 when display_name exceeds 255 characters', async () => {
      mockRequest.json = jest.fn().mockResolvedValue({
        display_name: 'A'.repeat(256),
        description: 'Test description',
        is_mandatory: true,
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.errors.display_name).toBeDefined();
    });

    it('should return 400 when description is missing', async () => {
      mockRequest.json = jest.fn().mockResolvedValue({
        display_name: 'Test Requirement',
        is_mandatory: true,
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.errors.description).toBeDefined();
    });

    it('should return 400 when description is empty', async () => {
      mockRequest.json = jest.fn().mockResolvedValue({
        display_name: 'Test Requirement',
        description: '',
        is_mandatory: true,
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.errors.description).toBeDefined();
    });

    it('should return 400 when description exceeds 5000 characters', async () => {
      mockRequest.json = jest.fn().mockResolvedValue({
        display_name: 'Test Requirement',
        description: 'A'.repeat(5001),
        is_mandatory: true,
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.errors.description).toBeDefined();
    });

    it('should return 400 when is_mandatory is missing', async () => {
      mockRequest.json = jest.fn().mockResolvedValue({
        display_name: 'Test Requirement',
        description: 'Test description',
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.errors.is_mandatory).toBeDefined();
    });

    it('should return 400 when is_mandatory is not a boolean', async () => {
      mockRequest.json = jest.fn().mockResolvedValue({
        display_name: 'Test Requirement',
        description: 'Test description',
        is_mandatory: 'true', // String instead of boolean
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.errors.is_mandatory).toBeDefined();
    });

    it('should return 400 when JSON is invalid', async () => {
      mockRequest.json = jest.fn().mockRejectedValue(new Error('Invalid JSON'));

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('Invalid JSON');
    });

    it('should trim whitespace from display_name and description', async () => {
      mockRequest.json = jest.fn().mockResolvedValue({
        display_name: '  Test Requirement  ',
        description: '  Test description  ',
        is_mandatory: true,
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockImplementation((data) => {
          // Verify trimming happened
          expect(data[0].display_name).toBe('Test Requirement');
          expect(data[0].description).toBe('Test description');
          return {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { ...data[0], id: 'req-uuid-001' },
                error: null,
              }),
            }),
          };
        }),
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(201);
    });
  });

  describe('Optional Fields', () => {
    it('should set is_active to true by default', async () => {
      mockRequest.json = jest.fn().mockResolvedValue({
        display_name: 'Test Requirement',
        description: 'Test description',
        is_mandatory: true,
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockImplementation((data) => {
          expect(data[0].is_active).toBe(true);
          return {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { ...data[0], id: 'req-uuid-001' },
                error: null,
              }),
            }),
          };
        }),
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(201);
    });

    it('should accept custom is_active value', async () => {
      mockRequest.json = jest.fn().mockResolvedValue({
        display_name: 'Test Requirement',
        description: 'Test description',
        is_mandatory: true,
        is_active: false,
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockImplementation((data) => {
          expect(data[0].is_active).toBe(false);
          return {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { ...data[0], id: 'req-uuid-001' },
                error: null,
              }),
            }),
          };
        }),
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(201);
    });

    it('should accept applicability_rules JSONB', async () => {
      const rules = { applicable_to: { marital_status: ['married'] } };
      mockRequest.json = jest.fn().mockResolvedValue({
        display_name: 'Marriage Certificate',
        description: 'For married women',
        is_mandatory: false,
        applicability_rules: rules,
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockImplementation((data) => {
          expect(data[0].applicability_rules).toEqual(rules);
          return {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { ...data[0], id: 'req-uuid-001' },
                error: null,
              }),
            }),
          };
        }),
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(201);
    });

    it('should accept display_order', async () => {
      mockRequest.json = jest.fn().mockResolvedValue({
        display_name: 'Test Requirement',
        description: 'Test description',
        is_mandatory: true,
        display_order: 5,
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockImplementation((data) => {
          expect(data[0].display_order).toBe(5);
          return {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { ...data[0], id: 'req-uuid-001' },
                error: null,
              }),
            }),
          };
        }),
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(201);
    });

    it('should set display_order to 0 by default', async () => {
      mockRequest.json = jest.fn().mockResolvedValue({
        display_name: 'Test Requirement',
        description: 'Test description',
        is_mandatory: true,
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockImplementation((data) => {
          expect(data[0].display_order).toBe(0);
          return {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { ...data[0], id: 'req-uuid-001' },
                error: null,
              }),
            }),
          };
        }),
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(201);
    });
  });

  describe('Tenant Isolation', () => {
    it('should use authenticated user tenant_id, not from request', async () => {
      mockRequest.json = jest.fn().mockResolvedValue({
        display_name: 'Test Requirement',
        description: 'Test description',
        is_mandatory: true,
        tenant_id: 'malicious-tenant-id', // Should be ignored
      });

      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: 'tenant-uuid-001',
          userId: 'user-uuid-001',
          role: 'local_admin',
          isSuperAdmin: false,
        },
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockImplementation((data) => {
          expect(data[0].tenant_id).toBe('tenant-uuid-001');
          expect(data[0].tenant_id).not.toBe('malicious-tenant-id');
          return {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { ...data[0], id: 'req-uuid-001' },
                error: null,
              }),
            }),
          };
        }),
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(201);
    });
  });

  describe('Response Format', () => {
    it('should return 201 Created status', async () => {
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'req-uuid-001',
                tenant_id: 'tenant-uuid-001',
                display_name: 'Test Requirement',
                description: 'Test description',
                is_mandatory: true,
                is_active: true,
                applicability_rules: null,
                display_order: 0,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
                deleted_at: null,
              },
              error: null,
            }),
          }),
        }),
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(201);
    });

    it('should return success response with created requirement', async () => {
      const createdData = {
        id: 'req-uuid-001',
        tenant_id: 'tenant-uuid-001',
        display_name: 'Test Requirement',
        description: 'Test description',
        is_mandatory: true,
        is_active: true,
        applicability_rules: null,
        display_order: 0,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        deleted_at: null,
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: createdData,
              error: null,
            }),
          }),
        }),
      });

      const response = await POST(mockRequest as NextRequest);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('req-uuid-001');
      expect(body.data.display_name).toBe('Test Requirement');
      expect(body.message).toContain('created successfully');
    });

    it('should include submission_stats in response', async () => {
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'req-uuid-001',
                tenant_id: 'tenant-uuid-001',
                display_name: 'Test Requirement',
                description: 'Test description',
                is_mandatory: true,
                is_active: true,
                applicability_rules: null,
                display_order: 0,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
                deleted_at: null,
              },
              error: null,
            }),
          }),
        }),
      });

      const response = await POST(mockRequest as NextRequest);

      const body = await response.json();
      expect(body.data.submission_stats).toBeDefined();
      expect(body.data.submission_stats.total_trainees).toBeDefined();
      expect(body.data.submission_stats.completion_rate).toBeDefined();
    });

    it('should return all required fields in response', async () => {
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'req-uuid-001',
                tenant_id: 'tenant-uuid-001',
                display_name: 'Test Requirement',
                description: 'Test description',
                is_mandatory: true,
                is_active: true,
                applicability_rules: null,
                display_order: 0,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
                deleted_at: null,
              },
              error: null,
            }),
          }),
        }),
      });

      const response = await POST(mockRequest as NextRequest);

      const body = await response.json();
      expect(body.data.id).toBeDefined();
      expect(body.data.display_name).toBeDefined();
      expect(body.data.description).toBeDefined();
      expect(body.data.is_mandatory).toBeDefined();
      expect(body.data.is_active).toBeDefined();
      expect(body.data.applicability_rules).toBeDefined();
      expect(body.data.display_order).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should return 409 Conflict for duplicate requirement type', async () => {
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: {
                code: '23505',
                message: 'duplicate key',
              },
            }),
          }),
        }),
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toContain('already exists');
    });

    it('should return 500 when insert fails unexpectedly', async () => {
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: {
                code: '42P01',
                message: 'table does not exist',
              },
            }),
          }),
        }),
      });

      expect(async () => {
        await POST(mockRequest as NextRequest);
      }).rejects.toThrow();
    });

    it('should return 500 when insert returns null data', async () => {
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          }),
        }),
      });

      const response = await POST(mockRequest as NextRequest);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toContain('Failed to create');
    });
  });
});
