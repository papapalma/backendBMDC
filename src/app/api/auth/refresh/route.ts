import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateToken, extractTokenFromHeader, verifyToken } from '@/lib/auth';
import { refreshTokenSchema } from '@/utils/validators';
import { successResponse, unauthorizedResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { checkRateLimit, getRateLimitKey } from '@/utils/rateLimit';
import { authRecoveryService } from '@/services/authRecoveryService';
import { logger } from '@/utils/logger';
import { activityLogService } from '@/services/activityLogService';

// OPTIONS /api/auth/refresh - Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// POST /api/auth/refresh - Rotate refresh token and issue a new access token
// Expects refreshToken in request body (from sessionStorage)

export const POST = withErrorHandler(async (request: NextRequest) => {
  const rlResponse = checkRateLimit(getRateLimitKey(request, 'refresh-token'), {
    limit: 50,
    windowMs: 60 * 60 * 1000,
  });
  if (rlResponse) return rlResponse as NextResponse;

  let providedRefreshToken: string | null = null;

  try {
    const body = await request.json();
    const parsed = refreshTokenSchema.parse(body);
    providedRefreshToken = parsed.refreshToken || null;
  } catch {
    // Invalid or missing refreshToken
  }

  if (!providedRefreshToken) {
    return unauthorizedResponse('Refresh token is required in request body');
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || undefined;
  const userAgent = request.headers.get('user-agent') || undefined;

  let rotated;
  try {
    rotated = await authRecoveryService.rotateRefreshToken(providedRefreshToken, { ip, userAgent });
  } catch {
    return unauthorizedResponse('Invalid or expired refresh token');
  }

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, email, username, role, tenant_id')
    .eq('id', rotated.userId)
    .single();

  if (error || !user) {
    return unauthorizedResponse('User not found');
  }

  // Check role immutability - prevent privilege escalation (Req 6.3)
  const authHeader = request.headers.get('authorization');
  const oldToken = extractTokenFromHeader(authHeader ?? undefined);
  const decoded = oldToken ? verifyToken(oldToken) : null;
  if (decoded && decoded.role !== user.role) {
    logger.warn('Role mismatch detected in token refresh', { userId: user.id, oldRole: decoded.role, newRole: user.role });
    
    // Task 20.2: Log role mismatch attempt as potential escalation
    try {
      // Determine if this is an escalation attempt
      const escalationRoles = ['admin', 'coordinator', 'supervisor', 'staff_training_coordinator', 'staff_inventory_manager', 'local_admin', 'super_admin'];
      const isEscalationAttempt = escalationRoles.includes(user.role) && !escalationRoles.includes(decoded.role);
      
      const action = isEscalationAttempt ? 'role_escalation_attempt' : 'role_mismatch';
      
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                 request.headers.get('x-real-ip') || undefined;
      const userAgent = request.headers.get('user-agent') || undefined;
      
      await activityLogService.logAction(
        user.id,
        action,
        'auth',
        user.id,
        {
          userId: user.id,
          oldRole: decoded.role,
          newRole: user.role,
          timestamp: new Date().toISOString(),
          ip: ip,
          userAgent: userAgent,
          reason: isEscalationAttempt ? 'Attempted privilege escalation' : 'Role changed between tokens',
          status: 'failure',
        },
        request,
        user.tenant_id
      );
    } catch (logError) {
      logger.error('Failed to log role mismatch attempt', { error: String(logError), userId: user.id });
    }
    
    return unauthorizedResponse('Token refresh failed: role changed');
  }

  // Task 20.2: Log successful token refresh with role verification
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
               request.headers.get('x-real-ip') || undefined;
    const userAgent = request.headers.get('user-agent') || undefined;
    
    await activityLogService.logAction(
      user.id,
      'token_refreshed',
      'auth',
      user.id,
      {
        userId: user.id,
        role: user.role,
        roleVerified: true,
        timestamp: new Date().toISOString(),
        ip,
        userAgent,
        status: 'success',
      },
      request,
      user.tenant_id
    );
  } catch (logError) {
    logger.debug('Failed to log token refresh', { error: String(logError), userId: user.id });
  }

  const token = generateToken({ userId: user.id, email: user.email, role: user.role, tenantId: user.tenant_id });

  const response = NextResponse.json({
    success: true,
    data: {
      token,
      refreshToken: rotated.token,  // Return new refresh token in body
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    },
    message: 'Token refreshed successfully',
  });

  // NOTE: NO COOKIES SET - All tokens are returned in response body for session storage
  // Frontend should store token and refreshToken in sessionStorage

  return response;
});
