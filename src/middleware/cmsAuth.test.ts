/**
 * Tests for CMS Authentication Middleware
 *
 * Tests Requirements 2.1, 2.11, 12.1, 12.2, 12.3
 *   - 2.1   Extract tenant_id from authenticated user context
 *   - 2.11  Extract tenant_id from JWT token and pass to data layer
 *   - 12.1  Deny access to non-admin users
 *   - 12.2  Display interface for authorized admins
 *   - 12.3  Reject unauthorized API calls with 403
 *
 * Property Tested:
 *   Property 1: Tenant Context Validation
 *     - Valid JWT produces valid tenant context
 *     - Invalid JWT produces error response
 *
 * Validates: Requirements 2.1, 2.11, 12.1
 */

import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';
import { extractCMSAuth, withCMSAuth, requireCMSAuth, CMSTenantContext } from './cmsAuth';

// Mock environment and auth utilities
jest.mock('@/lib/auth', () => ({
  verifyToken: jest.fn(),
  extractTokenFromHeader: jest.fn(),
  extractTokenFromCookie: jest.fn(),
}));

jest.mock('@/utils/responses', () => ({
  forbiddenResponse: jest.fn((msg) => new Response(JSON.stringify({ error: msg }), { status: 403 })),
  unauthorizedResponse: jest.fn((msg) => new Response(JSON.stringify({ error: msg }), { status: 401 })),
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

import { verifyToken, extractTokenFromHeader, extractTokenFromCookie } from '@/lib/auth';
import { forbiddenResponse, unauthorizedResponse } from '@/utils/responses';
import { logger } from '@/utils/logger';

// Test data
const validTenantId = '550e8400-e29b-41d4-a716-446655440000';
const validAdminId = '550e8400-e29b-41d4-a716-446655440001';
const validSuperAdminId = '550e8400-e29b-41d4-a716-446655440002';

const validAdminPayload = {
  userId: validAdminId,
  tenantId: validTenantId,
  email: 'admin@example.com',
  role: 'local_admin',
  jti: 'test-jti-1',
};

const validSuperAdminPayload = {
  userId: validSuperAdminId,
  tenantId: validTenantId,
  email: 'superadmin@example.com',
  role: 'super_admin',
  jti: 'test-jti-2',
};

// Utility to create mock NextRequest
function createMockRequest(options: { authHeader?: string; cookie?: string } = {}): NextRequest {
  const headers = new Map<string, string>();
  if (options.authHeader) headers.set('authorization', options.authHeader);
  if (options.cookie) headers.set('cookie', options.cookie);

  return {
    headers,
    url: 'http://localhost:3000/api/cms-settings',
    method: 'POST',
  } as unknown as NextRequest;
}

describe('CMS Authentication Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('extractCMSAuth', () => {
    describe('Happy Path - Valid JWT with Admin Role', () => {
      it('should return valid context for admin user with valid JWT', () => {
        const mockRequest = createMockRequest({ authHeader: 'Bearer valid-token' });

        (extractTokenFromHeader as jest.Mock).mockReturnValue('valid-token');
        (extractTokenFromCookie as jest.Mock).mockReturnValue(null);
        (verifyToken as jest.Mock).mockReturnValue(validAdminPayload);

        const result = extractCMSAuth(mockRequest);

        expect(result.context).toBeDefined();
        expect(result.error).toBeUndefined();
        expect(result.context?.tenantId).toBe(validTenantId);
        expect(result.context?.adminId).toBe(validAdminId);
        expect(result.context?.adminRole).toBe('local_admin');
        expect(result.context?.authenticated).toBe(true);
      });

      it('should return valid context for superadmin user with valid JWT', () => {
        const mockRequest = createMockRequest({ authHeader: 'Bearer valid-token' });

        (extractTokenFromHeader as jest.Mock).mockReturnValue('valid-token');
        (extractTokenFromCookie as jest.Mock).mockReturnValue(null);
        (verifyToken as jest.Mock).mockReturnValue(validSuperAdminPayload);

        const result = extractCMSAuth(mockRequest);

        expect(result.context).toBeDefined();
        expect(result.error).toBeUndefined();
        expect(result.context?.adminRole).toBe('super_admin');
        expect(result.context?.authenticated).toBe(true);
      });

      it('should extract token from Authorization header first', () => {
        const mockRequest = createMockRequest({ authHeader: 'Bearer header-token', cookie: 'auth_token=cookie-token' });

        (extractTokenFromHeader as jest.Mock).mockReturnValue('header-token');
        (extractTokenFromCookie as jest.Mock).mockReturnValue('cookie-token');
        (verifyToken as jest.Mock).mockReturnValue(validAdminPayload);

        extractCMSAuth(mockRequest);

        expect(extractTokenFromHeader).toHaveBeenCalled();
        // Should use header token, not cookie
        expect(verifyToken).toHaveBeenCalledWith('header-token');
      });

      it('should extract token from cookie if Authorization header not present', () => {
        const mockRequest = createMockRequest({ cookie: 'auth_token=cookie-token' });

        (extractTokenFromHeader as jest.Mock).mockReturnValue(null);
        (extractTokenFromCookie as jest.Mock).mockReturnValue('cookie-token');
        (verifyToken as jest.Mock).mockReturnValue(validAdminPayload);

        extractCMSAuth(mockRequest);

        expect(verifyToken).toHaveBeenCalledWith('cookie-token');
      });
    });

    describe('Error Case - No Token (401 Unauthorized)', () => {
      it('should return 401 when no token in Authorization header or cookie', () => {
        const mockRequest = createMockRequest();

        (extractTokenFromHeader as jest.Mock).mockReturnValue(null);
        (extractTokenFromCookie as jest.Mock).mockReturnValue(null);

        const result = extractCMSAuth(mockRequest);

        expect(result.error).toBeDefined();
        expect(result.context).toBeUndefined();
        expect(unauthorizedResponse).toHaveBeenCalledWith(expect.stringContaining('No authentication token provided'));
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No JWT found'), expect.any(Object));
      });
    });

    describe('Error Case - Invalid Token (401 Unauthorized)', () => {
      it('should return 401 when token verification fails', () => {
        const mockRequest = createMockRequest({ authHeader: 'Bearer invalid-token' });

        (extractTokenFromHeader as jest.Mock).mockReturnValue('invalid-token');
        (extractTokenFromCookie as jest.Mock).mockReturnValue(null);
        (verifyToken as jest.Mock).mockReturnValue(null);

        const result = extractCMSAuth(mockRequest);

        expect(result.error).toBeDefined();
        expect(result.context).toBeUndefined();
        expect(unauthorizedResponse).toHaveBeenCalledWith(expect.stringContaining('Invalid or expired token'));
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('JWT verification failed'), expect.any(Object));
      });
    });

    describe('Error Case - Missing tenant_id (403 Forbidden)', () => {
      it('should return 403 when JWT payload missing tenantId', () => {
        const mockRequest = createMockRequest({ authHeader: 'Bearer valid-token' });
        const payloadWithoutTenant = { ...validAdminPayload, tenantId: undefined };

        (extractTokenFromHeader as jest.Mock).mockReturnValue('valid-token');
        (extractTokenFromCookie as jest.Mock).mockReturnValue(null);
        (verifyToken as jest.Mock).mockReturnValue(payloadWithoutTenant);

        const result = extractCMSAuth(mockRequest);

        expect(result.error).toBeDefined();
        expect(result.context).toBeUndefined();
        expect(forbiddenResponse).toHaveBeenCalledWith(expect.stringContaining('Missing tenant context'));
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('JWT payload missing tenantId'), expect.any(Object));
      });
    });

    describe('Error Case - Missing admin_id (403 Forbidden)', () => {
      it('should return 403 when JWT payload missing userId/adminId', () => {
        const mockRequest = createMockRequest({ authHeader: 'Bearer valid-token' });
        const payloadWithoutAdmin = { ...validAdminPayload, userId: undefined };

        (extractTokenFromHeader as jest.Mock).mockReturnValue('valid-token');
        (extractTokenFromCookie as jest.Mock).mockReturnValue(null);
        (verifyToken as jest.Mock).mockReturnValue(payloadWithoutAdmin);

        const result = extractCMSAuth(mockRequest);

        expect(result.error).toBeDefined();
        expect(result.context).toBeUndefined();
        expect(forbiddenResponse).toHaveBeenCalledWith(expect.stringContaining('Missing admin context'));
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('JWT payload missing userId/adminId'), expect.any(Object));
      });
    });

    describe('Error Case - Insufficient Role (403 Forbidden)', () => {
      it('should return 403 when role is not admin or superadmin', () => {
        const mockRequest = createMockRequest({ authHeader: 'Bearer valid-token' });
        const payloadWithTraineeRole = { ...validAdminPayload, role: 'trainee' };

        (extractTokenFromHeader as jest.Mock).mockReturnValue('valid-token');
        (extractTokenFromCookie as jest.Mock).mockReturnValue(null);
        (verifyToken as jest.Mock).mockReturnValue(payloadWithTraineeRole);

        const result = extractCMSAuth(mockRequest);

        expect(result.error).toBeDefined();
        expect(result.context).toBeUndefined();
        expect(forbiddenResponse).toHaveBeenCalledWith(expect.stringContaining('Admin access required'));
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Insufficient admin role'), expect.any(Object));
      });

      it('should return 403 when role is staff but not admin', () => {
        const mockRequest = createMockRequest({ authHeader: 'Bearer valid-token' });
        const payloadWithStaffRole = { ...validAdminPayload, role: 'staff_training_coordinator' };

        (extractTokenFromHeader as jest.Mock).mockReturnValue('valid-token');
        (extractTokenFromCookie as jest.Mock).mockReturnValue(null);
        (verifyToken as jest.Mock).mockReturnValue(payloadWithStaffRole);

        const result = extractCMSAuth(mockRequest);

        expect(result.error).toBeDefined();
        expect(result.context).toBeUndefined();
        expect(forbiddenResponse).toHaveBeenCalledWith(expect.stringContaining('Admin access required'));
      });
    });

    describe('Logging', () => {
      it('should log debug message on successful context resolution', () => {
        const mockRequest = createMockRequest({ authHeader: 'Bearer valid-token' });

        (extractTokenFromHeader as jest.Mock).mockReturnValue('valid-token');
        (extractTokenFromCookie as jest.Mock).mockReturnValue(null);
        (verifyToken as jest.Mock).mockReturnValue(validAdminPayload);

        extractCMSAuth(mockRequest);

        expect(logger.debug).toHaveBeenCalledWith(
          expect.stringContaining('Context resolved'),
          expect.objectContaining({
            tenantId: validTenantId,
            adminId: validAdminId,
            adminRole: 'local_admin',
          })
        );
      });
    });
  });

  describe('withCMSAuth - Higher Order Function', () => {
    it('should wrap handler and extract context before calling', async () => {
      const mockRequest = createMockRequest({ authHeader: 'Bearer valid-token' });
      const mockHandler = jest.fn().mockResolvedValue(new Response('Success'));

      (extractTokenFromHeader as jest.Mock).mockReturnValue('valid-token');
      (extractTokenFromCookie as jest.Mock).mockReturnValue(null);
      (verifyToken as jest.Mock).mockReturnValue(validAdminPayload);

      const wrappedHandler = withCMSAuth(mockHandler);
      const response = await wrappedHandler(mockRequest);

      expect(mockHandler).toHaveBeenCalledWith(mockRequest, expect.objectContaining({
        tenantId: validTenantId,
        adminId: validAdminId,
      }));
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });

    it('should return error response if auth fails without calling handler', async () => {
      const mockRequest = createMockRequest();
      const mockHandler = jest.fn();

      (extractTokenFromHeader as jest.Mock).mockReturnValue(null);
      (extractTokenFromCookie as jest.Mock).mockReturnValue(null);

      const wrappedHandler = withCMSAuth(mockHandler);
      const response = await wrappedHandler(mockRequest);

      expect(mockHandler).not.toHaveBeenCalled();
      expect(response.status).toBe(401);
    });
  });

  describe('requireCMSAuth - Convenience Function', () => {
    it('should return context for valid JWT', () => {
      const mockRequest = createMockRequest({ authHeader: 'Bearer valid-token' });

      (extractTokenFromHeader as jest.Mock).mockReturnValue('valid-token');
      (extractTokenFromCookie as jest.Mock).mockReturnValue(null);
      (verifyToken as jest.Mock).mockReturnValue(validAdminPayload);

      const result = requireCMSAuth(mockRequest);

      expect(result.context).toBeDefined();
      expect(result.context?.tenantId).toBe(validTenantId);
    });

    it('should return error for invalid JWT', () => {
      const mockRequest = createMockRequest();

      (extractTokenFromHeader as jest.Mock).mockReturnValue(null);
      (extractTokenFromCookie as jest.Mock).mockReturnValue(null);

      const result = requireCMSAuth(mockRequest);

      expect(result.error).toBeDefined();
      expect(result.context).toBeUndefined();
    });
  });

  describe('Property 1: Tenant Context Validation', () => {
    describe('Valid JWT produces valid tenant context', () => {
      it('should produce valid context for admin with all required fields', () => {
        const mockRequest = createMockRequest({ authHeader: 'Bearer valid-token' });

        (extractTokenFromHeader as jest.Mock).mockReturnValue('valid-token');
        (extractTokenFromCookie as jest.Mock).mockReturnValue(null);
        (verifyToken as jest.Mock).mockReturnValue(validAdminPayload);

        const result = extractCMSAuth(mockRequest);

        // Context should have all required fields
        expect(result.context).toBeDefined();
        expect(result.context?.tenantId).toBeTruthy();
        expect(result.context?.adminId).toBeTruthy();
        expect(result.context?.adminRole).toBeTruthy();
        expect(result.context?.authenticated).toBe(true);

        // Error should not be present
        expect(result.error).toBeUndefined();
      });

      it('should produce valid context for superadmin with all required fields', () => {
        const mockRequest = createMockRequest({ authHeader: 'Bearer valid-token' });

        (extractTokenFromHeader as jest.Mock).mockReturnValue('valid-token');
        (extractTokenFromCookie as jest.Mock).mockReturnValue(null);
        (verifyToken as jest.Mock).mockReturnValue(validSuperAdminPayload);

        const result = extractCMSAuth(mockRequest);

        // Context should have all required fields
        expect(result.context).toBeDefined();
        expect(result.context?.tenantId).toBeTruthy();
        expect(result.context?.adminId).toBeTruthy();
        expect(result.context?.adminRole).toBeTruthy();
        expect(result.context?.authenticated).toBe(true);

        // Error should not be present
        expect(result.error).toBeUndefined();
      });
    });

    describe('Invalid JWT produces error', () => {
      it('should produce error for missing token', () => {
        const mockRequest = createMockRequest();

        (extractTokenFromHeader as jest.Mock).mockReturnValue(null);
        (extractTokenFromCookie as jest.Mock).mockReturnValue(null);

        const result = extractCMSAuth(mockRequest);

        // Error should be present
        expect(result.error).toBeDefined();
        expect(result.error?.status).toBe(401);

        // Context should not be present
        expect(result.context).toBeUndefined();
      });

      it('should produce error for invalid token', () => {
        const mockRequest = createMockRequest({ authHeader: 'Bearer invalid' });

        (extractTokenFromHeader as jest.Mock).mockReturnValue('invalid');
        (extractTokenFromCookie as jest.Mock).mockReturnValue(null);
        (verifyToken as jest.Mock).mockReturnValue(null);

        const result = extractCMSAuth(mockRequest);

        // Error should be present
        expect(result.error).toBeDefined();
        expect(result.error?.status).toBe(401);

        // Context should not be present
        expect(result.context).toBeUndefined();
      });

      it('should produce error for non-admin role', () => {
        const mockRequest = createMockRequest({ authHeader: 'Bearer valid-token' });
        const payloadWithoutAdminRole = { ...validAdminPayload, role: 'trainee' };

        (extractTokenFromHeader as jest.Mock).mockReturnValue('valid-token');
        (extractTokenFromCookie as jest.Mock).mockReturnValue(null);
        (verifyToken as jest.Mock).mockReturnValue(payloadWithoutAdminRole);

        const result = extractCMSAuth(mockRequest);

        // Error should be present
        expect(result.error).toBeDefined();
        expect(result.error?.status).toBe(403);

        // Context should not be present
        expect(result.context).toBeUndefined();
      });
    });
  });
});
