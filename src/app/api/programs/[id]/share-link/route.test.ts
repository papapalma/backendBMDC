/**
 * Unit tests for Program Link Generator endpoint
 * GET /api/programs/:id/share-link
 *
 * Tests idempotence, OG metadata generation, authorization, and error handling
 * Property 1: Program ID Validation Idempotence — Validating same program_id multiple times produces same result
 * **Validates: Requirements 1.5, 2.1**
 */

import { NextRequest } from 'next/server';
import { GET } from './route';
import { programService } from '@/services/programService';
import { requireTenantContext } from '@/middleware/tenantContext';
import fc from 'fast-check';

// Mock dependencies
jest.mock('@/services/programService');
jest.mock('@/middleware/tenantContext');
jest.mock('@/middleware/errorHandler', () => ({
  withErrorHandler: (handler: Function) => handler,
}));

describe('GET /api/programs/:id/share-link', () => {
  let mockRequest: Partial<NextRequest>;
  let mockProgram: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock program data
    mockProgram = {
      id: 'prog-uuid-1234',
      name: 'Advanced JavaScript Training',
      description: 'Learn modern JavaScript with ES6+ features',
      status: 'active',
      tenant_id: 'tenant-uuid-5678',
      image_path: 'programs/prog-uuid-1234/image.jpg',
      start_date: '2024-01-15',
      end_date: '2024-03-15',
    };

    // Mock request
    const headersMap = new Map([
      ['host', 'localhost:3003'],
      ['x-forwarded-proto', 'http'],
    ]);

    mockRequest = {
      headers: {
        get: (key: string) => headersMap.get(key) ?? null,
      },
      url: 'http://localhost:3003/api/programs/prog-uuid-1234/share-link',
    } as any;
  });

  describe('Authorization', () => {
    it('should return 403 when user lacks admin permissions', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: {
          tenantId: 'tenant-uuid-5678',
          role: 'trainee', // Non-admin role
          isSuperAdmin: false,
        },
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Insufficient permissions');
    });

    it('should allow local_admin to generate links', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: {
          tenantId: 'tenant-uuid-5678',
          role: 'local_admin',
          isSuperAdmin: false,
        },
      });

      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.url).toBeDefined();
    });

    it('should allow staff_training_coordinator to generate links', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: {
          tenantId: 'tenant-uuid-5678',
          role: 'staff_training_coordinator',
          isSuperAdmin: false,
        },
      });

      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should return 401 when authentication is missing', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: { status: 401 },
      });

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      expect(response.status).toBe(401);
    });
  });

  describe('Program Validation', () => {
    beforeEach(() => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: {
          tenantId: 'tenant-uuid-5678',
          role: 'local_admin',
          isSuperAdmin: false,
        },
      });
    });

    it('should return 404 when program not found', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(null);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'nonexistent-id' }) }
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('Program not found');
    });

    it('should return 403 when program is not active', async () => {
      const inactiveProgram = { ...mockProgram, status: 'completed' };
      (programService.getProgramById as jest.Mock).mockResolvedValue(inactiveProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain('active programs');
    });

    it('should return 403 when program status is upcoming', async () => {
      const upcomingProgram = { ...mockProgram, status: 'upcoming' };
      (programService.getProgramById as jest.Mock).mockResolvedValue(upcomingProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain('active programs');
    });

    it('should respect tenant isolation (non-super-admin)', async () => {
      const otherTenantProgram = { ...mockProgram, tenant_id: 'other-tenant-uuid' };
      (programService.getProgramById as jest.Mock).mockResolvedValue(null);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      expect(response.status).toBe(404);
      expect(programService.getProgramById).toHaveBeenCalledWith('prog-uuid-1234', 'tenant-uuid-5678');
    });

    it('should allow super_admin to see all programs', async () => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: {
          tenantId: 'platform',
          role: 'super_admin',
          isSuperAdmin: true,
        },
      });

      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      expect(response.status).toBe(200);
      // Super admin should bypass tenant check (undefined passed as tenantId)
      expect(programService.getProgramById).toHaveBeenCalledWith('prog-uuid-1234', undefined);
    });
  });

  describe('Link Generation (Requirement 1.1, 1.2, 1.3)', () => {
    beforeEach(() => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: {
          tenantId: 'tenant-uuid-5678',
          role: 'local_admin',
          isSuperAdmin: false,
        },
      });
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);
    });

    it('should generate shareable link with program_id query parameter', async () => {
      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.url).toContain('/share?program_id=prog-uuid-1234');
    });

    it('should use application base domain in link', async () => {
      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.url).toContain('http://localhost:3003');
    });

    it('should include UTM parameters when provided', async () => {
      const urlWithParams = new URL('http://localhost:3003/api/programs/prog-uuid-1234/share-link');
      urlWithParams.searchParams.set('utm_source', 'facebook');
      urlWithParams.searchParams.set('utm_medium', 'social');
      urlWithParams.searchParams.set('utm_campaign', 'summer_2024');

      mockRequest.url = urlWithParams.toString();

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.url).toContain('utm_source=facebook');
      expect(data.data.url).toContain('utm_medium=social');
      expect(data.data.url).toContain('utm_campaign=summer_2024');
    });

    it('should return only program_id in link by default', async () => {
      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      const url = new URL(data.data.url);
      const params = url.searchParams;
      expect(params.get('program_id')).toBe('prog-uuid-1234');
      expect(params.get('utm_source')).toBeNull();
    });
  });

  describe('Idempotence Property (Requirement 1.5)', () => {
    beforeEach(() => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: {
          tenantId: 'tenant-uuid-5678',
          role: 'local_admin',
          isSuperAdmin: false,
        },
      });
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);
    });

    it('should generate identical links for the same program (idempotent)', async () => {
      // Generate link first time
      const response1 = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );
      const data1 = await response1.json();

      // Generate link second time
      const response2 = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );
      const data2 = await response2.json();

      // Base URLs should be identical (excluding generatedAt timestamp)
      const url1 = new URL(data1.data.url);
      const url2 = new URL(data2.data.url);

      expect(url1.toString()).toBe(url2.toString());
      expect(data1.data.programId).toBe(data2.data.programId);
    });

    it('should generate different links for different programs', async () => {
      const response1 = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );
      const data1 = await response1.json();

      const prog2 = { ...mockProgram, id: 'prog-uuid-5678' };
      (programService.getProgramById as jest.Mock).mockResolvedValue(prog2);

      const response2 = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-5678' }) }
      );
      const data2 = await response2.json();

      expect(data1.data.url).not.toBe(data2.data.url);
      expect(data1.data.programId).not.toBe(data2.data.programId);
    });
  });

  describe('Open Graph Metadata Generation (Requirement 1.1)', () => {
    beforeEach(() => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: {
          tenantId: 'tenant-uuid-5678',
          role: 'local_admin',
          isSuperAdmin: false,
        },
      });
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);
    });

    it('should generate OG metadata with program title', async () => {
      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.og.title).toContain('Advanced JavaScript Training');
      expect(data.data.og.title).toContain('Training Program');
    });

    it('should generate OG metadata with program description', async () => {
      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.og.description).toContain('Learn modern JavaScript');
    });

    it('should truncate description to 160 characters for OG', async () => {
      const longDesc = 'A'.repeat(200);
      const progWithLongDesc = { ...mockProgram, description: longDesc };
      (programService.getProgramById as jest.Mock).mockResolvedValue(progWithLongDesc);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.og.description.length).toBeLessThanOrEqual(160);
    });

    it('should include program image in OG metadata if available', async () => {
      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.og.image).toBeDefined();
      expect(data.data.og.image).toContain('programs/prog-uuid-1234/image.jpg');
    });

    it('should omit image from OG metadata if not available', async () => {
      const progWithoutImage = { ...mockProgram, image_path: null };
      (programService.getProgramById as jest.Mock).mockResolvedValue(progWithoutImage);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.og.image).toBeUndefined();
    });

    it('should include shareable URL in OG metadata', async () => {
      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.og.url).toBe(data.data.url);
    });

    it('should use default description if program description is missing', async () => {
      const progNoDesc = { ...mockProgram, description: null };
      (programService.getProgramById as jest.Mock).mockResolvedValue(progNoDesc);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.og.description).toContain('Advanced JavaScript Training');
    });
  });

  describe('Response Structure', () => {
    beforeEach(() => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: {
          tenantId: 'tenant-uuid-5678',
          role: 'local_admin',
          isSuperAdmin: false,
        },
      });
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);
    });

    it('should return correct response structure', async () => {
      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.url).toBeDefined();
      expect(data.data.programId).toBe('prog-uuid-1234');
      expect(data.data.generatedAt).toBeDefined();
      expect(data.data.og).toBeDefined();
    });

    it('should include generatedAt timestamp in ISO format', async () => {
      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      const timestamp = data.data.generatedAt;
      expect(new Date(timestamp)).toBeInstanceOf(Date);
      expect(timestamp).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should return HTTP 200 on success', async () => {
      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      expect(response.status).toBe(200);
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: {
          tenantId: 'tenant-uuid-5678',
          role: 'local_admin',
          isSuperAdmin: false,
        },
      });
    });

    it('should handle program with special characters in name', async () => {
      const specialProgram = {
        ...mockProgram,
        name: 'Advanced C++ & Database Programming (2024)',
      };
      (programService.getProgramById as jest.Mock).mockResolvedValue(specialProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.og.title).toContain('Advanced C++ & Database Programming');
    });

    it('should handle HTTPS base URL', async () => {
      const headersMap = new Map([
        ['host', 'bmdc.online'],
        ['x-forwarded-proto', 'https'],
      ]);

      mockRequest = {
        headers: {
          get: (key: string) => headersMap.get(key) ?? null,
        },
        url: 'https://bmdc.online/api/programs/prog-uuid-1234/share-link',
      } as any;

      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.url).toContain('https://bmdc.online');
    });

    it('should handle program with UUID containing special format', async () => {
      const uuidProgram = {
        ...mockProgram,
        id: 'a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6',
      };
      (programService.getProgramById as jest.Mock).mockResolvedValue(uuidProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6' }) }
      );

      const data = await response.json();
      expect(data.data.url).toContain('a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6');
    });
  });

  describe('Property 1: Program ID Validation Idempotence', () => {
    /**
     * **Validates: Requirements 1.5, 2.1**
     * 
     * Property: When generating a shareable link for the same program_id multiple times,
     * the endpoint MUST always return the same link URL (idempotence property).
     * 
     * This property ensures that:
     * 1. Links are deterministic (no randomness or time-based changes to the URL itself)
     * 2. Multiple generations don't produce different URLs
     * 3. Admins can reliably share the same program link across multiple platforms
     */
    beforeEach(() => {
      (requireTenantContext as jest.Mock).mockReturnValue({
        error: null,
        context: {
          tenantId: 'tenant-uuid-5678',
          role: 'local_admin',
          isSuperAdmin: false,
        },
      });
    });

    it('Property: Generating link for same program_id multiple times produces identical URL', async () => {
      // Test idempotence across multiple program IDs using property-based approach
      const testCases = [
        'prog-uuid-1234',
        'a1b2c3d4-e5f6-4a78-b9c0-d1e2f3a4b5c6',
        '12345678-1234-1234-1234-123456789012',
        'demo-program-xyz',
      ];

      for (const programId of testCases) {
        const testProgram = {
          id: programId,
          name: 'Test Program ' + programId.substring(0, 8),
          description: 'Test description for program',
          status: 'active',
          tenant_id: 'tenant-uuid-5678',
          image_path: 'programs/' + programId + '/image.jpg',
          start_date: '2024-01-15',
          end_date: '2024-03-15',
        };

        (programService.getProgramById as jest.Mock).mockResolvedValue(testProgram);

        // Generate link first time
        const response1 = await GET(
          mockRequest as NextRequest,
          { params: Promise.resolve({ id: programId }) }
        );
        const data1 = await response1.json();

        // Generate link second time
        const response2 = await GET(
          mockRequest as NextRequest,
          { params: Promise.resolve({ id: programId }) }
        );
        const data2 = await response2.json();

        // Property: URLs must be identical for same program_id (idempotence)
        expect(data1.data.url).toBe(data2.data.url);

        // Property: program_id in responses must match input
        expect(data1.data.programId).toBe(programId);
        expect(data2.data.programId).toBe(programId);

        // Property: Both responses must be successful
        expect(data1.success).toBe(true);
        expect(data2.success).toBe(true);

        // Property: OG metadata should be consistent
        const ogUrl1 = new URL(data1.data.og.url);
        const ogUrl2 = new URL(data2.data.og.url);
        expect(ogUrl1.searchParams.get('program_id')).toBe(
          ogUrl2.searchParams.get('program_id')
        );
      }
    });

    it('Property: Different program IDs produce different links', async () => {
      // Verify that the idempotence property doesn't conflate different programs
      const programId1 = 'prog-uuid-1111';
      const programId2 = 'prog-uuid-2222';

      const program1 = {
        ...mockProgram,
        id: programId1,
        name: 'Program One',
      };
      (programService.getProgramById as jest.Mock).mockResolvedValue(program1);

      const response1 = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: programId1 }) }
      );
      const data1 = await response1.json();

      const program2 = {
        ...mockProgram,
        id: programId2,
        name: 'Program Two',
      };
      (programService.getProgramById as jest.Mock).mockResolvedValue(program2);

      const response2 = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: programId2 }) }
      );
      const data2 = await response2.json();

      // Property: Different program IDs must produce different URLs
      expect(data1.data.url).not.toBe(data2.data.url);
      expect(data1.data.programId).not.toBe(data2.data.programId);

      // Property: Both URLs must contain their respective program_id
      expect(data1.data.url).toContain(`program_id=${programId1}`);
      expect(data2.data.url).toContain(`program_id=${programId2}`);
    });

    it('Property: Link format always includes program_id query parameter', async () => {
      // Verify that generated links always conform to the expected format
      const testProgramIds = [
        'prog-001',
        'prog-uuid-abcd-1234',
        'a1b2c3d4-e5f6-4a78-b9c0-d1e2f3a4b5c6',
      ];

      for (const programId of testProgramIds) {
        (programService.getProgramById as jest.Mock).mockResolvedValue({
          ...mockProgram,
          id: programId,
        });

        const response = await GET(
          mockRequest as NextRequest,
          { params: Promise.resolve({ id: programId }) }
        );
        const data = await response.json();

        // Property: Response must have success flag
        expect(data.success).toBe(true);

        // Property: URL must contain /share endpoint
        expect(data.data.url).toContain('/share?');

        // Property: URL must have program_id parameter
        const urlObj = new URL(data.data.url);
        expect(urlObj.searchParams.has('program_id')).toBe(true);
        expect(urlObj.searchParams.get('program_id')).toBe(programId);

        // Property: OG metadata must have required fields
        expect(data.data.og).toBeDefined();
        expect(data.data.og.title).toBeDefined();
        expect(data.data.og.description).toBeDefined();
        expect(data.data.og.url).toBe(data.data.url);
      }
    });
  });
});
