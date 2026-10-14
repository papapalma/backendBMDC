/**
 * Unit Tests for POST /api/auth/refresh - JWT Validation
 * 
 * **Validates: Requirement 6.3 - Role Immutability Check**
 * Tests that token refresh rejects privilege escalation attempts where
 * a token's role changes between the old and new JWT.
 */

import { NextRequest, NextResponse } from 'next/server';
import { POST, OPTIONS } from './route';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authRecoveryService } from '@/services/authRecoveryService';
import { generateToken, verifyToken, extractTokenFromHeader } from '@/lib/auth';
import { logger } from '@/utils/logger';
import { JWTPayload } from '@/types';

// Mock dependencies
jest.mock('@/lib/supabase-admin');
jest.mock('@/services/authRecoveryService');
jest.mock('@/lib/auth');
jest.mock('@/utils/logger');
jest.mock('@/middleware/cors', () => ({
  handleOptionsRequest: jest.fn((req) => new NextResponse(null, { status: 200 })),
}));
jest.mock('@/middleware/errorHandler', () => ({
  withErrorHandler: (handler: Function) => handler,
}));
jest.mock('@/utils/rateLimit', () => ({
  checkRateLimit: jest.fn(() => null),
  getRateLimitKey: jest.fn(() => 'test-key'),
}));

describe('POST /api/auth/refresh - Role Immutability Check', () => {
  let mockRequest: Partial<NextRequest>;
  let mockAuthUser: any;
  let mockOldToken: JWTPayload;
  let mockNewToken: string;
  let mockSupabaseChain: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock user data
    mockAuthUser = {
      id: 'user-uuid-123',
      email: 'user@example.com',
      username: 'testuser',
      role: 'trainee',
      tenant_id: 'tenant-uuid-456',
    };

    // Mock old token (the one being refreshed from)
    mockOldToken = {
      userId: 'user-uuid-123',
      email: 'user@example.com',
      role: 'trainee',
      tenantId: 'tenant-uuid-456',
      jti: 'old-jti-123',
    };

    // Mock new token string
    mockNewToken = 'new-jwt-token-string';

    // Setup Supabase chain mock
    mockSupabaseChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: mockAuthUser,
        error: null,
      }),
    };

    (supabaseAdmin.from as jest.Mock).mockReturnValue(mockSupabaseChain);

    // Mock request
    mockRequest = {
      json: jest.fn(async () => ({ refreshToken: 'valid-refresh-token' })),
      headers: {
        get: jest.fn((key: string) => {
          if (key === 'authorization') return 'Bearer old-token-string';
          if (key === 'x-forwarded-for') return '192.168.1.1';
          if (key === 'user-agent') return 'Test User Agent';
          return null;
        }),
      },
      url: 'http://localhost:3000/api/auth/refresh',
      method: 'POST',
    } as any;
  });

  /**
   * Test 1: Successful token refresh when role hasn't changed
   * 
   * **Validates: Requirement 6.3 (part 1)**
   * When old token role matches current user role, refresh should succeed.
   */
  it('should successfully refresh token when role remains unchanged', async () => {
    // Setup
    (authRecoveryService.rotateRefreshToken as jest.Mock).mockResolvedValue({
      userId: 'user-uuid-123',
      token: 'new-refresh-token',
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    });

    (extractTokenFromHeader as jest.Mock).mockReturnValue('old-token-string');
    (verifyToken as jest.Mock).mockReturnValue(mockOldToken);
    (generateToken as jest.Mock).mockReturnValue(mockNewToken);

    // Act
    const response = await POST(mockRequest as NextRequest);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.token).toBe(mockNewToken);
    expect(body.data.user.role).toBe('trainee');

    // Verify logger was NOT called (no security incident)
    expect(logger.warn).not.toHaveBeenCalled();
  });

  /**
   * Test 2: Reject refresh when role escalates (privilege escalation attempt)
   * 
   * **Validates: Requirement 6.3 (main check)**
   * When old token has 'trainee' but new user role is 'admin', reject and log.
   * This is the core privilege escalation defense.
   */
  it('should reject token refresh when role changes from trainee to admin (privilege escalation)', async () => {
    // Setup: Old token says trainee, but user DB has admin role
    const escalatedUser = { ...mockAuthUser, role: 'admin' };
    mockSupabaseChain.single.mockResolvedValue({
      data: escalatedUser,
      error: null,
    });

    (authRecoveryService.rotateRefreshToken as jest.Mock).mockResolvedValue({
      userId: 'user-uuid-123',
      token: 'new-refresh-token',
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    });

    (extractTokenFromHeader as jest.Mock).mockReturnValue('old-token-string');
    (verifyToken as jest.Mock).mockReturnValue(mockOldToken); // Still 'trainee'
    (generateToken as jest.Mock).mockReturnValue(mockNewToken);

    // Act
    const response = await POST(mockRequest as NextRequest);

    // Assert: Should reject with 401
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('role changed');

    // Verify security incident was logged
    expect(logger.warn).toHaveBeenCalledWith(
      'Role mismatch detected in token refresh',
      expect.objectContaining({
        userId: 'user-uuid-123',
        oldRole: 'trainee',
        newRole: 'admin',
      })
    );
  });

  /**
   * Test 3: Reject refresh when role downgrades (suspicious activity)
   * 
   * **Validates: Requirement 6.3 (edge case)**
   * Even if role is downgraded (admin -> trainee), reject it.
   * Role changes in either direction are suspicious.
   */
  it('should reject token refresh when role changes from admin to trainee', async () => {
    // Setup: Old token says admin, but user DB now has trainee role
    const downgraded = { ...mockAuthUser, role: 'trainee' };
    const adminOldToken: JWTPayload = { ...mockOldToken, role: 'admin' };

    mockSupabaseChain.single.mockResolvedValue({
      data: downgraded,
      error: null,
    });

    (authRecoveryService.rotateRefreshToken as jest.Mock).mockResolvedValue({
      userId: 'user-uuid-123',
      token: 'new-refresh-token',
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    });

    (extractTokenFromHeader as jest.Mock).mockReturnValue('old-token-string');
    (verifyToken as jest.Mock).mockReturnValue(adminOldToken);
    (generateToken as jest.Mock).mockReturnValue(mockNewToken);

    // Act
    const response = await POST(mockRequest as NextRequest);

    // Assert: Should reject
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toContain('role changed');

    // Verify security incident was logged
    expect(logger.warn).toHaveBeenCalledWith(
      'Role mismatch detected in token refresh',
      expect.objectContaining({
        userId: 'user-uuid-123',
        oldRole: 'admin',
        newRole: 'trainee',
      })
    );
  });

  /**
   * Test 4: Allow refresh when no Authorization header (no old token to verify)
   * 
   * **Validates: Requirement 6.3 (graceful fallback)**
   * If the client doesn't send an old token in Authorization header,
   * we can't verify it, so we allow the refresh (normal first-time or no header).
   */
  it('should allow refresh when Authorization header is missing', async () => {
    // Setup: No Authorization header
    const requestWithoutAuth = {
      ...mockRequest,
      headers: {
        get: jest.fn((key: string) => {
          // Return null for all headers
          return null;
        }),
      },
    };

    (authRecoveryService.rotateRefreshToken as jest.Mock).mockResolvedValue({
      userId: 'user-uuid-123',
      token: 'new-refresh-token',
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    });

    (extractTokenFromHeader as jest.Mock).mockReturnValue(null); // No token extracted
    (verifyToken as jest.Mock).mockReturnValue(null); // Can't verify, no token
    (generateToken as jest.Mock).mockReturnValue(mockNewToken);

    // Act
    const response = await POST(requestWithoutAuth as NextRequest);

    // Assert: Should succeed (can't verify old token, so no check possible)
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    // Verify logger was NOT called (no suspicious activity detected)
    expect(logger.warn).not.toHaveBeenCalled();
  });

  /**
   * Test 5: Allow refresh when old token is invalid/expired (can't verify)
   * 
   * **Validates: Requirement 6.3 (graceful fallback)**
   * If the old token can't be verified (expired, tampered, etc.),
   * we skip the check since we can't decode it.
   */
  it('should allow refresh when old token cannot be verified', async () => {
    // Setup: verifyToken returns null (expired or invalid)
    (authRecoveryService.rotateRefreshToken as jest.Mock).mockResolvedValue({
      userId: 'user-uuid-123',
      token: 'new-refresh-token',
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    });

    (extractTokenFromHeader as jest.Mock).mockReturnValue('old-token-string');
    (verifyToken as jest.Mock).mockReturnValue(null); // Token is invalid/expired
    (generateToken as jest.Mock).mockReturnValue(mockNewToken);

    // Act
    const response = await POST(mockRequest as NextRequest);

    // Assert: Should succeed (can't verify old token)
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    // Verify logger was NOT called
    expect(logger.warn).not.toHaveBeenCalled();
  });

  /**
   * Test 6: Handle missing user gracefully
   * 
   * **Validates: Requirement 6.3 (error path)**
   * If user lookup fails, return 401 before role check.
   */
  it('should return 401 when user is not found in database', async () => {
    // Setup
    mockSupabaseChain.single.mockResolvedValue({
      data: null,
      error: new Error('Not found'),
    });

    (authRecoveryService.rotateRefreshToken as jest.Mock).mockResolvedValue({
      userId: 'user-uuid-missing',
      token: 'new-refresh-token',
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // Act
    const response = await POST(mockRequest as NextRequest);

    // Assert
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toContain('User not found');

    // Role check should never be reached
    expect(verifyToken).not.toHaveBeenCalled();
  });
});
