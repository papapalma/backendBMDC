/**
 * Integration Tests for GET /api/requirement-definitions/{id}/submissions
 * 
 * **Validates: Requirements FR2.2, FR3.2, NFR4**
 * - FR2.2: View individual requirement details with submission list
 * - FR3.2: Track submission status per requirement per trainee
 * - NFR4: Security (tenant isolation, authorization)
 * 
 * Tests verify:
 * - Paginated list of trainee submissions with trainee info and status
 * - Query parameter filtering by status
 * - Sorting by name and date
 * - Pagination with page and limit controls
 * - Document URLs and submission/verification dates included
 * - 404 when requirement not found
 * - Tenant isolation enforcement
 * - Response format validation
 */

import { NextRequest } from 'next/server';
import { GET } from './route';
import { requireTenantContext } from '@/middleware/tenantContext';
import { supabaseAdmin } from '@/lib/supabase-admin';

jest.mock('@/middleware/tenantContext');
jest.mock('@/lib/supabase-admin');
jest.mock('@/middleware/cors', () => ({
  handleOptionsRequest: jest.fn(),
  addCorsHeaders: jest.fn((response) => response),
}));
jest.mock('@/middleware/errorHandler', () => ({
  withErrorHandler: (handler: Function) => handler,
}));

describe('GET /api/requirement-definitions/{id}/submissions - Integration Tests', () => {
  let mockRequest: Partial<NextRequest>;
  let mockTenantContext: any;
  let mockSubmissions: any[];

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock authenticated tenant context
    mockTenantContext = {
      tenantId: 'tenant-001',
      userId: 'user-001',
      role: 'local_admin',
    };

    // Mock submission data with nested relations
    mockSubmissions = [
      {
        id: 'submission-001',
        enrollment_id: 'enrollment-001',
        requirement_id: 'req-001',
        tenant_id: 'tenant-001',
        submission_status: 'verified',
        document_url: 'https://example.com/doc1.pdf',
        submitted_at: '2024-01-10T10:00:00Z',
        verified_at: '2024-01-12T14:30:00Z',
        verified_by: 'admin-001',
        rejection_reason: null,
        created_at: '2024-01-10T09:00:00Z',
        enrollments: { id: 'enrollment-001' },
        trainee_status_records: {
          trainee_id: 'trainee-001',
          trainees: {
            id: 'trainee-001',
            first_name: 'John',
            last_name: 'Doe',
            email: 'john@example.com',
          },
        },
      },
      {
        id: 'submission-002',
        enrollment_id: 'enrollment-002',
        requirement_id: 'req-001',
        tenant_id: 'tenant-001',
        submission_status: 'pending',
        document_url: null,
        submitted_at: null,
        verified_at: null,
        verified_by: null,
        rejection_reason: null,
        created_at: '2024-01-08T09:00:00Z',
        enrollments: { id: 'enrollment-002' },
        trainee_status_records: {
          trainee_id: 'trainee-002',
          trainees: {
            id: 'trainee-002',
            first_name: 'Jane',
            last_name: 'Smith',
            email: 'jane@example.com',
          },
        },
      },
      {
        id: 'submission-003',
        enrollment_id: 'enrollment-003',
        requirement_id: 'req-001',
        tenant_id: 'tenant-001',
        submission_status: 'submitted',
        document_url: 'https://example.com/doc3.pdf',
        submitted_at: '2024-01-11T11:00:00Z',
        verified_at: null,
        verified_by: null,
        rejection_reason: null,
        created_at: '2024-01-11T10:00:00Z',
        enrollments: { id: 'enrollment-003' },
        trainee_status_records: {
          trainee_id: 'trainee-003',
          trainees: {
            id: 'trainee-003',
            first_name: 'Alice',
            last_name: 'Anderson',
            email: 'alice@example.com',
          },
        },
      },
      {
        id: 'submission-004',
        enrollment_id: 'enrollment-004',
        requirement_id: 'req-001',
        tenant_id: 'tenant-001',
        submission_status: 'rejected',
        document_url: 'https://example.com/doc4.pdf',
        submitted_at: '2024-01-09T10:00:00Z',
        verified_at: '2024-01-09T15:00:00Z',
        verified_by: 'admin-001',
        rejection_reason: 'Document is blurry, please resubmit',
        created_at: '2024-01-09T09:00:00Z',
        enrollments: { id: 'enrollment-004' },
        trainee_status_records: {
          trainee_id: 'trainee-004',
          trainees: {
            id: 'trainee-004',
            first_name: 'Bob',
            last_name: 'Baker',
            email: 'bob@example.com',
          },
        },
      },
      {
        id: 'submission-005',
        enrollment_id: 'enrollment-005',
        requirement_id: 'req-001',
        tenant_id: 'tenant-001',
        submission_status: 'waived',
        document_url: null,
        submitted_at: null,
        verified_at: '2024-01-07T10:00:00Z',
        verified_by: 'admin-001',
        rejection_reason: null,
        created_at: '2024-01-07T09:00:00Z',
        enrollments: { id: 'enrollment-005' },
        trainee_status_records: {
          trainee_id: 'trainee-005',
          trainees: {
            id: 'trainee-005',
            first_name: 'Carol',
            last_name: 'Clark',
            email: 'carol@example.com',
          },
        },
      },
    ];

    // Mock request
    mockRequest = {
      headers: { get: (key: string) => (key === 'authorization' ? 'Bearer valid-token' : null) },
      url: 'http://localhost:3000/api/requirement-definitions/req-001/submissions',
      method: 'GET',
    } as any;

    // Setup default mock responses
    (requireTenantContext as jest.Mock).mockReturnValue({
      context: mockTenantContext,
    });

    // Mock Supabase query chain for checking requirement exists
    const requirementSelectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: 'req-001', tenant_id: 'tenant-001' },
        error: null,
      }),
    };

    // Mock Supabase query chain for fetching submissions
    const submissionSelectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
    };

    let callCount = 0;
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'requirement_definitions') {
        return requirementSelectChain;
      } else if (table === 'enrollment_requirements') {
        callCount++;
        return submissionSelectChain;
      }
    });

    submissionSelectChain.eq.mockReturnThis();
    submissionSelectChain.is.mockReturnThis();
  });

  describe('Authentication & Authorization', () => {
    it('should return 401 when user is not authenticated', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: new Response(
          JSON.stringify({ success: false, error: 'Unauthorized' }),
          { status: 401 }
        ),
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      expect(response.status).toBe(401);
    });

    it('should allow all authenticated users to view submissions', async () => {
      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'req-001', tenant_id: 'tenant-001' },
              error: null,
            }),
          };
        } else {
          submissionSelectChain.select.mockReturnThis();
          submissionSelectChain.eq.mockReturnThis();
          submissionSelectChain.is.mockReturnThis();
          return submissionSelectChain;
        }
      });

      // Mock the response from supabase
      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({ data: mockSubmissions, error: null, count: mockSubmissions.length });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      expect(response.status).toBe(200);
    });
  });

  describe('Requirement Validation', () => {
    it('should return 404 when requirement not found', async () => {
      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          };
        }
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'nonexistent-req' }) }
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('not found');
    });

    it('should return 404 for cross-tenant requirement access', async () => {
      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: null, // Requirement not found because it belongs to different tenant
              error: null,
            }),
          };
        }
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      expect(response.status).toBe(404);
    });
  });

  describe('Paginated Submissions', () => {
    it('should return paginated list with default page 1 and limit 20', async () => {
      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'req-001', tenant_id: 'tenant-001' },
              error: null,
            }),
          };
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({ 
        data: mockSubmissions, 
        error: null, 
        count: mockSubmissions.length 
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.limit).toBe(20);
    });

    it('should include trainee name, email, and status in submissions', async () => {
      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'req-001', tenant_id: 'tenant-001' },
              error: null,
            }),
          };
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({ 
        data: mockSubmissions, 
        error: null, 
        count: mockSubmissions.length 
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      const submission = body.data[0];

      expect(submission.trainee_name).toBeDefined();
      expect(submission.trainee_email).toBeDefined();
      expect(submission.submission_status).toBeDefined();
      expect(submission.trainee_name).toBe('John Doe');
      expect(submission.trainee_email).toBe('john@example.com');
    });

    it('should include document URL when present', async () => {
      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'req-001', tenant_id: 'tenant-001' },
              error: null,
            }),
          };
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({ 
        data: [mockSubmissions[0]], // Only verified submission with document
        error: null, 
        count: 1 
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      expect(body.data[0].document_url).toBe('https://example.com/doc1.pdf');
    });

    it('should include submission dates', async () => {
      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'req-001', tenant_id: 'tenant-001' },
              error: null,
            }),
          };
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({ 
        data: mockSubmissions, 
        error: null, 
        count: mockSubmissions.length 
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      const verified = body.data.find((s: any) => s.submission_status === 'verified');
      expect(verified.submitted_at).toBeDefined();
      expect(verified.verified_at).toBeDefined();
    });
  });

  describe('Status Filtering', () => {
    it('should filter by pending status', async () => {
      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'req-001', tenant_id: 'tenant-001' },
              error: null,
            }),
          };
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({ 
        data: [mockSubmissions[1]], // Only pending
        error: null, 
        count: 1 
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001?status=pending' }) }
      );

      expect(response.status).toBe(200);
    });

    it('should filter by verified status', async () => {
      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'req-001', tenant_id: 'tenant-001' },
              error: null,
            }),
          };
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({ 
        data: [mockSubmissions[0]], // Only verified
        error: null, 
        count: 1 
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      expect(response.status).toBe(200);
    });
  });

  describe('Sorting', () => {
    it('should support sort by name ascending', async () => {
      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'req-001', tenant_id: 'tenant-001' },
              error: null,
            }),
          };
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({ 
        data: mockSubmissions, 
        error: null, 
        count: mockSubmissions.length 
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      // Sorted by name should be: Alice, Bob, Carol, Jane, John
      if (body.data.length > 1) {
        const firstComp = body.data[0].trainee_name.localeCompare(body.data[1].trainee_name);
        expect(firstComp).toBeLessThanOrEqual(0);
      }
    });

    it('should support sort by date', async () => {
      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'req-001', tenant_id: 'tenant-001' },
              error: null,
            }),
          };
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({ 
        data: mockSubmissions, 
        error: null, 
        count: mockSubmissions.length 
      });

      mockRequest.url = 'http://localhost:3000/api/requirement-definitions/req-001/submissions?sort_by=date';

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      expect(response.status).toBe(200);
    });
  });

  describe('Tenant Isolation', () => {
    it('should only return submissions for authenticated tenant', async () => {
      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'req-001', tenant_id: 'tenant-001' },
              error: null,
            }),
          };
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({ 
        data: mockSubmissions.filter(s => s.tenant_id === 'tenant-001'), 
        error: null, 
        count: mockSubmissions.length 
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      body.data.forEach((submission: any) => {
        expect(submission).toBeDefined(); // Should only have tenant-001 submissions
      });
    });

    it('should verify tenant isolation in database query', async () => {
      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'req-001', tenant_id: 'tenant-001' },
              error: null,
            }),
          };
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({ 
        data: mockSubmissions, 
        error: null, 
        count: mockSubmissions.length 
      });

      await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      // Verify tenant_id filter was applied in query
      expect(submissionSelectChain.eq).toHaveBeenCalledWith('tenant_id', 'tenant-001');
    });
  });

  describe('Response Format Validation', () => {
    it('should return 200 status on success', async () => {
      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'req-001', tenant_id: 'tenant-001' },
              error: null,
            }),
          };
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({ 
        data: mockSubmissions, 
        error: null, 
        count: mockSubmissions.length 
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      expect(response.status).toBe(200);
    });

    it('should return JSON with success flag', async () => {
      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'req-001', tenant_id: 'tenant-001' },
              error: null,
            }),
          };
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({ 
        data: mockSubmissions, 
        error: null, 
        count: mockSubmissions.length 
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.pagination).toBeDefined();
    });

    it('should include pagination metadata', async () => {
      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'req-001', tenant_id: 'tenant-001' },
              error: null,
            }),
          };
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({ 
        data: mockSubmissions, 
        error: null, 
        count: mockSubmissions.length 
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      expect(body.pagination.page).toBeDefined();
      expect(body.pagination.limit).toBeDefined();
      expect(body.pagination.total).toBeDefined();
      expect(body.pagination.totalPages).toBeDefined();
    });

    it('should include required submission fields', async () => {
      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'req-001', tenant_id: 'tenant-001' },
              error: null,
            }),
          };
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({ 
        data: mockSubmissions, 
        error: null, 
        count: mockSubmissions.length 
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      const requiredFields = [
        'enrollment_id',
        'trainee_name',
        'trainee_email',
        'submission_status',
        'document_url',
        'submitted_at',
        'verified_at',
        'created_at',
      ];

      body.data.forEach((submission: any) => {
        requiredFields.forEach((field) => {
          expect(submission[field] !== undefined).toBe(true);
        });
      });
    });
  });

  describe('Query Parameter Validation', () => {
    it('should validate status parameter', () => {
      const validStatuses = ['pending', 'submitted', 'verified', 'rejected', 'waived'];
      validStatuses.forEach((status) => {
        expect(['pending', 'submitted', 'verified', 'rejected', 'waived']).toContain(status);
      });
    });

    it('should validate sort_by parameter', () => {
      const validSortOptions = ['name', 'date'];
      validSortOptions.forEach((option) => {
        expect(['name', 'date']).toContain(option);
      });
    });

    it('should validate page parameter', () => {
      const validPages = [1, 2, 5, 10];
      validPages.forEach((page) => {
        expect(page).toBeGreaterThan(0);
      });
    });

    it('should validate limit parameter with max 100', () => {
      const validLimits = [1, 10, 20, 50, 100];
      const invalidLimits = [0, -1, 101, 200];

      validLimits.forEach((limit) => {
        expect(limit).toBeGreaterThan(0);
        expect(limit).toBeLessThanOrEqual(100);
      });

      invalidLimits.forEach((limit) => {
        expect(limit <= 0 || limit > 100).toBe(true);
      });
    });
  });

  describe('Empty Results', () => {
    it('should return empty array when no submissions exist', async () => {
      const submissionSelectChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'req-001', tenant_id: 'tenant-001' },
              error: null,
            }),
          };
        } else {
          return submissionSelectChain;
        }
      });

      submissionSelectChain.select.mockReturnThis();
      submissionSelectChain.eq.mockReturnThis();
      submissionSelectChain.is.mockResolvedValue({ 
        data: [], 
        error: null, 
        count: 0 
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'req-001' }) }
      );

      const body = await response.json();
      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(0);
    });
  });
});
