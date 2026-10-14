/**
 * Integration tests for PATCH /api/requirement-definitions/{id} endpoint
 * 
 * **Validates: Requirements FR1.1, FR2.3, NFR4**
 * - FR1.1: Store requirement definitions with metadata
 * - FR2.3: Edit requirement definitions (admin only)
 * - NFR4: Security (tenant isolation, role-based access)
 * 
 * Tests verify:
 * 1. Admin access control (403 for non-admin users)
 * 2. Tenant isolation (404 for cross-tenant access)
 * 3. Successful PATCH updates with 200 response
 * 4. Partial field updates and optional fields validation
 * 5. Error handling (400, 403, 404, 422)
 */

import { NextRequest } from 'next/server';
import { PATCH } from './route';
import { requireTenantContext } from '@/middleware/tenantContext';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { calculateSubmissionStats } from '../submission-stats';

jest.mock('@/middleware/tenantContext');
jest.mock('@/lib/supabase-admin');
jest.mock('../submission-stats');
jest.mock('@/middleware/cors', () => ({
  handleOptionsRequest: jest.fn((req) =>
    new Response(null, { status: 200, headers: { 'Access-Control-Allow-Methods': 'PATCH,OPTIONS' } })
  ),
}));
jest.mock('@/middleware/errorHandler', () => ({
  withErrorHandler: (handler: Function) => handler,
}));

describe('PATCH /api/requirement-definitions/{id} - Integration Tests', () => {
  let mockRequest: Partial<NextRequest>;
  let mockSingleFn: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      url: 'http://localhost:3000/api/requirement-definitions/req-001',
      json: jest.fn().mockResolvedValue({}),
    };

    // Mock the single() call that returns requirement data
    mockSingleFn = jest.fn().mockResolvedValue({
      data: {
        id: 'req-001',
        tenant_id: 'tenant-001',
        requirement_type: 'birth_certificate_copy',
        display_name: 'Birth Certificate',
        description: 'Original description',
        is_mandatory: true,
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        deleted_at: null,
      },
      error: null,
    });

    // Create a function that returns a fresh mock chain each time
    const createMockChain = () => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          is: jest.fn().mockReturnValue({
            single: mockSingleFn,
          }),
        }),
      }),
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 'req-001',
                  tenant_id: 'tenant-001',
                  requirement_type: 'birth_certificate_copy',
                  display_name: 'Updated Name',
                  description: 'Updated description',
                  is_mandatory: false,
                  is_active: false,
                  updated_at: new Date().toISOString(),
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    });

    // Setup Supabase mock to return fresh chain each call
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => createMockChain());

    (calculateSubmissionStats as jest.Mock).mockResolvedValue({
      total_trainees: 100,
      pending_count: 20,
      submitted_count: 30,
      verified_count: 50,
      rejected_count: 0,
      waived_count: 0,
      completion_rate: 50,
    });

    (requireTenantContext as jest.Mock).mockReturnValue({
      context: {
        tenantId: 'tenant-001',
        userId: 'user-001',
        role: 'local_admin',
        isSuperAdmin: false,
      },
    });
  });

  describe('Admin Access Control - 403 Forbidden for non-admin users', () => {
    it('should return 403 Forbidden when trainee user attempts to update', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: 'tenant-001',
          role: 'trainee',
        },
      });

      (mockRequest.json as jest.Mock).mockResolvedValue({ display_name: 'Updated' });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain('admin');
    });

    it('should return 403 Forbidden when staff_inventory_manager attempts to update', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: 'tenant-001',
          role: 'staff_inventory_manager',
        },
      });

      (mockRequest.json as jest.Mock).mockResolvedValue({ display_name: 'Updated' });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain('admin');
    });

    it('should return 403 Forbidden when instructor attempts to update', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: 'tenant-001',
          role: 'instructor',
        },
      });

      (mockRequest.json as jest.Mock).mockResolvedValue({ display_name: 'Updated' });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain('admin');
    });
  });

  describe('Admin Access Control - Allowed for admin roles', () => {
    it('should allow local_admin role to update', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: 'tenant-001',
          role: 'local_admin',
        },
      });

      (mockRequest.json as jest.Mock).mockResolvedValue({ display_name: 'Updated Name' });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(200);
    });

    it('should allow super_admin role to update', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: 'tenant-001',
          role: 'super_admin',
        },
      });

      (mockRequest.json as jest.Mock).mockResolvedValue({ display_name: 'Updated Name' });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(200);
    });
  });

  describe('404 Handling - Requirement not found', () => {
    it('should return 404 when requirement does not exist', async () => {
      mockSingleFn.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      (mockRequest.json as jest.Mock).mockResolvedValue({ display_name: 'Updated' });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'nonexistent-id' }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('not found');
    });

    it('should return 404 for soft-deleted requirements', async () => {
      mockSingleFn.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      (mockRequest.json as jest.Mock).mockResolvedValue({ display_name: 'Updated' });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(404);
    });

    it('should return 404 when requirement belongs to different tenant (cross-tenant isolation)', async () => {
      mockSingleFn.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      (requireTenantContext as jest.Mock).mockReturnValue({
        context: {
          tenantId: 'tenant-002',
          role: 'local_admin',
        },
      });

      (mockRequest.json as jest.Mock).mockResolvedValue({ display_name: 'Updated' });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe('Request Validation - Schema validation', () => {
    it('should reject display_name longer than 255 characters', async () => {
      const longName = 'a'.repeat(256);
      (mockRequest.json as jest.Mock).mockResolvedValue({ display_name: longName });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(422);
    });

    it('should reject description longer than 5000 characters', async () => {
      const longDesc = 'a'.repeat(5001);
      (mockRequest.json as jest.Mock).mockResolvedValue({ description: longDesc });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(422);
    });

    it('should reject unknown fields (strict validation)', async () => {
      (mockRequest.json as jest.Mock).mockResolvedValue({
        display_name: 'Valid',
        unknown_field: 'should fail',
      });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(422);
    });

    it('should reject non-boolean is_mandatory', async () => {
      (mockRequest.json as jest.Mock).mockResolvedValue({ is_mandatory: 'true' });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(422);
    });

    it('should reject non-boolean is_active', async () => {
      (mockRequest.json as jest.Mock).mockResolvedValue({ is_active: 1 });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(422);
    });
  });

  describe('Request Validation - Valid inputs', () => {
    it('should accept display_name update', async () => {
      (mockRequest.json as jest.Mock).mockResolvedValue({
        display_name: 'Updated Birth Certificate',
      });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(200);
    });

    it('should accept description update', async () => {
      (mockRequest.json as jest.Mock).mockResolvedValue({
        description: 'Updated description',
      });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(200);
    });

    it('should accept is_mandatory boolean update', async () => {
      (mockRequest.json as jest.Mock).mockResolvedValue({ is_mandatory: false });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(200);
    });

    it('should accept is_active boolean update', async () => {
      (mockRequest.json as jest.Mock).mockResolvedValue({ is_active: false });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(200);
    });

    it('should accept partial update (single field)', async () => {
      (mockRequest.json as jest.Mock).mockResolvedValue({
        display_name: 'Updated Name',
      });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(200);
    });

    it('should accept full update (all fields)', async () => {
      (mockRequest.json as jest.Mock).mockResolvedValue({
        display_name: 'Updated Name',
        description: 'Updated description',
        is_mandatory: false,
        is_active: false,
      });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(200);
    });

    it('should accept empty update payload (no-op)', async () => {
      (mockRequest.json as jest.Mock).mockResolvedValue({});

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(200);
    });
  });

  describe('Response Format - Successful updates', () => {
    it('should return 200 status on successful update', async () => {
      (mockRequest.json as jest.Mock).mockResolvedValue({ display_name: 'Updated' });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      expect(response.status).toBe(200);
    });

    it('should include updated requirement in response', async () => {
      (mockRequest.json as jest.Mock).mockResolvedValue({ display_name: 'Updated' });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.id).toBe('req-001');
      expect(data.data.display_name).toBeDefined();
    });

    it('should include submission_stats in response', async () => {
      (mockRequest.json as jest.Mock).mockResolvedValue({ display_name: 'Updated' });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      const data = await response.json();
      expect(data.data).toHaveProperty('submission_stats');
      expect(data.data.submission_stats).toHaveProperty('completion_rate');
    });

    it('should set updated_at timestamp to current time', async () => {
      const beforeTime = new Date().getTime();
      (mockRequest.json as jest.Mock).mockResolvedValue({ display_name: 'Updated' });

      const response = await PATCH(mockRequest as NextRequest, {
        params: Promise.resolve({ id: 'req-001' }),
      });

      const afterTime = new Date().getTime();
      const data = await response.json();
      const updatedAtTime = new Date(data.data.updated_at).getTime();

      expect(updatedAtTime).toBeGreaterThanOrEqual(beforeTime);
      expect(updatedAtTime).toBeLessThanOrEqual(afterTime);
    });
  });
});
