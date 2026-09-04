import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateToken } from '@/lib/auth';
import { refreshTokenSchema } from '@/utils/validators';
import { successResponse, unauthorizedResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { checkRateLimit, getRateLimitKey } from '@/utils/rateLimit';
import { authRecoveryService } from '@/services/authRecoveryService';

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
