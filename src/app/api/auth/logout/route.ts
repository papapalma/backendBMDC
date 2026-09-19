import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAsync } from '@/middleware/auth';
import { verifyToken, extractTokenFromHeader } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';
import { handleOptionsRequest } from '@/middleware/cors';
import { authRecoveryService } from '@/services/authRecoveryService';

// OPTIONS /api/auth/logout - Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuthAsync(request);
  if ('error' in authResult) return authResult.error as NextResponse;

  // Revoke the token by recording its jti in the denylist (SEC-5)
  const authHeader = request.headers.get('authorization');
  const rawToken = extractTokenFromHeader(authHeader || '');

  if (rawToken) {
    const payload = verifyToken(rawToken);
    if (payload?.jti) {
      await supabaseAdmin
        .from('revoked_tokens')
        .insert({ jti: payload.jti, expires_at: new Date((payload.exp ?? 0) * 1000).toISOString() })
        .throwOnError();
    }
  }

  // Extract refresh token from request body (sent from sessionStorage on frontend)
  let refreshToken: string | null = null;
  try {
    const body = await request.json();
    refreshToken = body.refreshToken || null;
  } catch {
    // No refresh token in body, continue without revoking
  }

  if (refreshToken) {
    await authRecoveryService.revokeRefreshToken(refreshToken);
  }

  await activityLogService.logAction(
    authResult.user.userId,
    'logout',
    'user',
    authResult.user.userId
  );

  const response = NextResponse.json({ success: true, data: null, message: 'Logged out successfully' });
  
  // NOTE: NO COOKIES SET - Tokens are managed in sessionStorage on frontend
  // Frontend should clear token and refreshToken from sessionStorage

  return response;
});
