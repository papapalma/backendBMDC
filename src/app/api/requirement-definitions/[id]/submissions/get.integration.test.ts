/**
 * Real Integration Tests for GET /api/requirement-definitions/{id}/submissions
 * 
 * **Validates: Requirements FR2.2, FR3.2, NFR4**
 * - FR2.2: View individual requirement details with submission list
 * - FR3.2: Track submission status per requirement per trainee
 * - NFR4: Security (tenant isolation, authorization)
 * 
 * These tests verify end-to-end functionality with realistic data scenarios.
 */

import { NextRequest } from 'next/server';
import { GET } from './route';
import { requireTenantContext } from '@/middleware/tenantContext';
import { supabaseAdmin } from '@/lib/supabase-admin';

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

describe('GET /api/requirement-definitions/{id}/submissions - Real Integration Tests', () => {
  let mockRequest: Partial<NextRequest>;
  let mockTenantContext: any;

  const mockRequirementDef = {
    id: 'req-001',
    tenant_id: 'tenant-001',
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

  const mockEnrollmentRequirements = [
    {
      id: 'sub-001',
      enrollment_id: 'enr-001',
      requirement_id: 'req-001',
      tenant_id: 'tenant-001',
      submission_status: 'verified',
      document_url: 'https://storage.example.com/docs/birth-cert-1.pdf',
      submitted_at: '2024-01-15T10:00:00Z',
      verified_at: '2024-01-16T14:30:00Z',
      verified_by: 'admin-001',
      rejection_reason: null,
      created_at: '2024-01-15T09:00:00Z',
      deleted_at: null,
      enrollments: { id: 'enr-001' },
      trainee_status_records: {
        trainee_id: 'tsr-001',
        trainees: {
          id: 'trainee-001',
          first_name: 'Maria',
          last_name: 'Santos',
          email: 'maria.santos@example.com',
        },
      },
    },
    {
      id: 'sub-002',
      enrollment_id: 'enr-002',
      requirement_id: 'req-001',
      tenant_id: 'tenant-001',
      submission_status: 'submitted',
      document_url: 'https://storage.example.com/docs/birth-cert-2.pdf',
      submitted_at: '2024-01-14T09:30:00Z',
      verified_at: null,
      verified_by: null,
      rejection_reason: null,
      created_at: '2024-01-14T09:00:00Z',
      deleted_at: null,
      enrollments: { id: 'enr-002' },
      trainee_status_records: {
        trainee_id: 'tsr-002',
        trainees: {
          id: 'trainee-002',
          first_name: 'Juan',
          last_name: 'Dela Cruz',
          email: 'juan.delacruz@example.com',
        },
      },
    },
    {
      id: 'sub-003',
      enrollment_id: 'enr-003',
      requirement_id: 'req-001',
      tenant_id: 'tenant-001',
      submission_status: 'rejected',
      document_url: 'https://storage.example.com/docs/birth-cert-3.pdf',
      submitted_at: '2024-01-12T11:00:00Z',
      verified_at: '2024-01-13T15:45:00Z',
      verified_by: 'admin-001',
      rejection_reason: 'Document appears to be photocopy of a photocopy. Please submit original or certified true copy.',
      created_at: '2024-01-12T10:00:00Z',
      deleted_at: null,
      enrollments: { id: 'enr-003' },
      trainee_status_records: {
        trainee_id: 'tsr-003',
        trainees: {
          id: 'trainee-003',
          first_name: 'Ana',
          last_name: 'Garcia',
          email: 'ana.garcia@example.com',
        },
      },
    },
    {
      id: 'sub-004',
      enrollment_id: 'enr-004',
      requirement_id: 'req-001',
      tenant_id: 'tenant-001',
      submission_status: 'pending',
      document_url: null,
      submitted_at: null,
      verified_at: null,
      verified_by: null,
      rejection_reason: null,
      created_at: '2024-01-10T08:00:00Z',
      deleted_at: null,
      enrollments: { id: 'enr-004' },
      trainee_status_records: {
        trainee_id: 'tsr-004',
        trainees: {
          id: 'trainee-004',
          first_name: 'Pedro',
          last_name: 'Reyes',
          email: 'pedro.reyes@example.com',
        },
      },
    },
    {
      id: 'sub-005',
      enrollment_id: 'enr-005',
      requirement_id: 'req-001',
      tenant_id: 'tenant-001',
      submission_status: 'waived',
      document_url: null,
      submitted_at: null,
      verified_at: '2024-01-09T13:20:00Z',
      verified_by: 'admin-002',
      rejection_reason: null,
      created_at: '2024-01-09T08:00:00Z',
      deleted_at: null,
      enrollments: { id: 'enr-005' },
      trainee_status_records: {
        trainee_id: 'tsr-005',
        trainees: {
          id: 'trainee-005',
          first_name: 'Rosa',
          last_name: 'Lopez',
          email: 'rosa.lopez@example.com',
        },
      },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    mockTenantContext = {
      tenantId: 'tenant-001',
      userId: 'user-001',
      role: 'local_admin',
    };

    mockRequest = {
      headers: { get: (key: string) => (key === 'authorization' ? 'Bearer token' : null) },
      url: 'http://localhost:3000/api/requirement-definitions/req-001/submissions',
      method: 'GET',
    } as any;

    (requireTenantContext as jest.Mock).mockReturnValue({
      context: mockTenantContext,
    });
  });

  describe('Successful Retrieval with All Statuses', () => {
    it('should successfully retrieve all submissions for a requirement', async () => {
      const requirementSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: mockRequirementDef,
          error: null,
        }),
      };

      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      let callCount = 0;
      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return requirementSelectChain;
        } else {
          callCount++;
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({
        data: mockEnrollmentRequirements,
        error: null,
        count: mockEnrollmentRequirements.length,
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(5);
      expect(body.pagination.total).toBe(5);
      expect(body.pagination.totalPages).toBe(1);
    });

    it('should include all required fields for each submission', async () => {
      const requirementSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: mockRequirementDef,
          error: null,
        }),
      };

      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return requirementSelectChain;
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({
        data: [mockEnrollmentRequirements[0]],
        error: null,
        count: 1,
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      const submission = body.data[0];

      expect(submission).toHaveProperty('enrollment_id');
      expect(submission).toHaveProperty('trainee_name');
      expect(submission).toHaveProperty('trainee_email');
      expect(submission).toHaveProperty('submission_status');
      expect(submission).toHaveProperty('document_url');
      expect(submission).toHaveProperty('submitted_at');
      expect(submission).toHaveProperty('verified_at');
      expect(submission).toHaveProperty('verified_by');
      expect(submission).toHaveProperty('rejection_reason');
      expect(submission).toHaveProperty('created_at');
    });

    it('should correctly transform nested trainee data', async () => {
      const requirementSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: mockRequirementDef,
          error: null,
        }),
      };

      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return requirementSelectChain;
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({
        data: [mockEnrollmentRequirements[0]],
        error: null,
        count: 1,
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      const submission = body.data[0];

      expect(submission.trainee_name).toBe('Maria Santos');
      expect(submission.trainee_email).toBe('maria.santos@example.com');
    });

    it('should handle all submission statuses correctly', async () => {
      const requirementSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: mockRequirementDef,
          error: null,
        }),
      };

      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return requirementSelectChain;
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({
        data: mockEnrollmentRequirements,
        error: null,
        count: mockEnrollmentRequirements.length,
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      const statuses = new Set(body.data.map((s: any) => s.submission_status));

      expect(statuses).toContain('verified');
      expect(statuses).toContain('submitted');
      expect(statuses).toContain('rejected');
      expect(statuses).toContain('pending');
      expect(statuses).toContain('waived');
    });
  });

  describe('Status Filtering', () => {
    it('should filter by pending status', async () => {
      const requirementSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: mockRequirementDef,
          error: null,
        }),
      };

      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return requirementSelectChain;
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({
        data: [mockEnrollmentRequirements[3]], // pending
        error: null,
        count: 1,
      });

      mockRequest.url = 'http://localhost:3000/api/requirement-definitions/req-001/submissions?status=pending';

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].submission_status).toBe('pending');
    });

    it('should filter by verified status', async () => {
      const requirementSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: mockRequirementDef,
          error: null,
        }),
      };

      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return requirementSelectChain;
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({
        data: [mockEnrollmentRequirements[0]], // verified
        error: null,
        count: 1,
      });

      mockRequest.url = 'http://localhost:3000/api/requirement-definitions/req-001/submissions?status=verified';

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].submission_status).toBe('verified');
    });
  });

  describe('Sorting', () => {
    it('should sort by trainee name ascending', async () => {
      const requirementSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: mockRequirementDef,
          error: null,
        }),
      };

      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return requirementSelectChain;
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({
        data: mockEnrollmentRequirements,
        error: null,
        count: mockEnrollmentRequirements.length,
      });

      mockRequest.url = 'http://localhost:3000/api/requirement-definitions/req-001/submissions?sort_by=name&order=asc';

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      // Should be sorted: Ana, Juan, Maria, Pedro, Rosa
      expect(body.data[0].trainee_name).toBe('Ana Garcia');
      expect(body.data[1].trainee_name).toBe('Juan Dela Cruz');
      expect(body.data[2].trainee_name).toBe('Maria Santos');
    });

    it('should sort by date descending', async () => {
      const requirementSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: mockRequirementDef,
          error: null,
        }),
      };

      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return requirementSelectChain;
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({
        data: mockEnrollmentRequirements,
        error: null,
        count: mockEnrollmentRequirements.length,
      });

      mockRequest.url = 'http://localhost:3000/api/requirement-definitions/req-001/submissions?sort_by=date&order=desc';

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      // Should be sorted by submitted/created date descending
      expect(body.data).toHaveLength(5);
    });
  });

  describe('Pagination', () => {
    it('should paginate results with custom page and limit', async () => {
      const requirementSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: mockRequirementDef,
          error: null,
        }),
      };

      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return requirementSelectChain;
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({
        data: mockEnrollmentRequirements,
        error: null,
        count: mockEnrollmentRequirements.length,
      });

      mockRequest.url = 'http://localhost:3000/api/requirement-definitions/req-001/submissions?page=1&limit=2';

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      expect(body.data).toHaveLength(2);
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.limit).toBe(2);
      expect(body.pagination.total).toBe(5);
      expect(body.pagination.totalPages).toBe(3);
    });

    it('should return second page of results', async () => {
      const requirementSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: mockRequirementDef,
          error: null,
        }),
      };

      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return requirementSelectChain;
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({
        data: mockEnrollmentRequirements,
        error: null,
        count: mockEnrollmentRequirements.length,
      });

      mockRequest.url = 'http://localhost:3000/api/requirement-definitions/req-001/submissions?page=2&limit=2';

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      expect(body.data).toHaveLength(2);
      expect(body.pagination.page).toBe(2);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 when requirement does not exist', async () => {
      const requirementSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(requirementSelectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'nonexistent-req' }) }
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('not found');
    });

    it('should enforce tenant isolation - return 404 for cross-tenant access', async () => {
      const requirementSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: null, // No match because tenant doesn't match
          error: null,
        }),
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue(requirementSelectChain);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      expect(response.status).toBe(404);
    });

    it('should apply tenant filter to requirement queries', async () => {
      const requirementSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: mockRequirementDef,
          error: null,
        }),
      };

      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return requirementSelectChain;
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({
        data: mockEnrollmentRequirements,
        error: null,
        count: mockEnrollmentRequirements.length,
      });

      await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      // Verify tenant_id filter is applied
      expect(submissionSelectChain.eq).toHaveBeenCalledWith('tenant_id', 'tenant-001');
    });
  });

  describe('Empty Results', () => {
    it('should return empty array when no submissions exist', async () => {
      const requirementSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: mockRequirementDef,
          error: null,
        }),
      };

      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return requirementSelectChain;
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({
        data: [],
        error: null,
        count: 0,
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(0);
    });
  });

  describe('Rejection Reason Handling', () => {
    it('should include rejection reason for rejected submissions', async () => {
      const requirementSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: mockRequirementDef,
          error: null,
        }),
      };

      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return requirementSelectChain;
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({
        data: [mockEnrollmentRequirements[2]], // rejected
        error: null,
        count: 1,
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      expect(body.data[0].rejection_reason).toContain('photocopy of a photocopy');
    });
  });
});
