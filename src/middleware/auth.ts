import { NextRequest } from 'next/server';
import { verifyToken, extractTokenFromHeader, extractTokenFromCookie } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { JWTPayload } from '@/types';
import { unauthorizedResponse } from '@/utils/responses';
import { getAuthConfigCached } from '@/lib/config';
import { logger } from '@/utils/logger';
import {
  resolveAppUserFromSupabaseIdentity,
  verifySupabaseAccessToken,
} from '@/lib/supabase-auth';

export interface AuthenticatedRequest extends NextRequest {
  user?: JWTPayload;
}

/**
 * Check if a token has been revoked (is in the denylist).
 * Returns true if revoked or an error occurred.
 */
const isTokenRevoked = async (jti: string): Promise<boolean> => {
  try {
    const { data } = await supabaseAdmin
      .from('revoked_tokens')
      .select('jti')
      .eq('jti', jti)
      .maybeSingle();
    return data !== null;
  } catch {
    // If the table doesn't exist yet, treat as not revoked

return false;
  }
};

const getRequestToken = (request: NextRequest): string | null => {
  const authHeader = request.headers.get('authorization');
  const cookieHeader = request.headers.get('cookie');

  console.log('[getRequestToken] Attempting token extraction', {
    hasAuthHeader: !!authHeader,
    hasCookieHeader: !!cookieHeader,
    authHeaderPrefix: authHeader?.substring(0, 20),
  });

  let token = extractTokenFromHeader(authHeader || '');
  if (!token) {
    token = extractTokenFromCookie(cookieHeader);
  }

  console.log('[getRequestToken] Token extraction result', {
    tokenFound: !!token,
    tokenLength: token?.length,
    tokenPrefix: token?.substring(0, 20),
  });

  return token;
};

export const authenticateUser = async (request: NextRequest): Promise<JWTPayload | null> => {
  const config = getAuthConfigCached();
  const token = getRequestToken(request);

  if (!token) {
    logger.info('[AUTH_OBSERVABILITY] No token found in request', {
      authPath: config.supabaseJwtVerification ? 'supabase' : 'custom',
      url: request.url,
    });
    return null;
  }

if (config.supabaseJwtVerification) {
    const identity = await verifySupabaseAccessToken(token);
    if (!identity) {
      logger.warn('[AUTH_OBSERVABILITY] Supabase token verification failed', {
        authPath: 'supabase',
        url: request.url,
      });
      return null;
    }

const appUser = await resolveAppUserFromSupabaseIdentity(identity);
    if (!appUser) {
      logger.warn('[AUTH_OBSERVABILITY] No app user mapping for Supabase user', {
        authPath: 'supabase',
        authUserId: identity.authUserId,
        email: identity.email,
        url: request.url,
      });
      return null;
    }

    logger.info('[AUTH_OBSERVABILITY] Auth successful', {
      authPath: 'supabase',
      userId: appUser.id,
      role: appUser.role,
      url: request.url,
    });

    return {
      userId: appUser.id,
      email: appUser.email,
      role: appUser.role,
      tenantId: appUser.tenantId || 'platform',
      jti: 'supabase-session',
    };
  }

const payload = verifyToken(token);
  if (!payload) {
    logger.warn('[AUTH_OBSERVABILITY] Token verification failed', {
      authPath: config.supabaseJwtVerification ? 'supabase' : 'custom',
      url: request.url,
      tokenLength: token.length,
    });
    return null;
  }

  console.log('[authenticateUser] Token verification successful', {
    payloadKeys: Object.keys(payload),
    userId: payload.userId,
    tenantId: payload.tenantId,
    role: payload.role,
    hasUserId: 'userId' in payload,
  });

  // Check revocation list

if (payload.jti && await isTokenRevoked(payload.jti)) {
    logger.warn('[AUTH_OBSERVABILITY] Token revoked', {
      authPath: 'custom',
      jti: payload.jti,
      userId: payload.userId,
      url: request.url,
    });
    return null;
  }

  logger.info('[AUTH_OBSERVABILITY] Auth successful', {
    authPath: config.supabaseJwtVerification ? 'supabase' : 'custom',
    userId: payload.userId,
    role: payload.role,
    url: request.url,
  });

  return payload;
};

export const requireAuth = (request: NextRequest): { user: JWTPayload } | { error: Response } => {
  const token = getRequestToken(request);

  if (!token) {
    return { error: unauthorizedResponse('Authentication required') };
  }

const user = verifyToken(token);
  if (!user) {
    return { error: unauthorizedResponse('Authentication required') };
  }

  return { user };
};

export const requireAuthAsync = async (
  request: NextRequest
): Promise<{ user: JWTPayload } | { error: Response }> => {
  const user = await authenticateUser(request);
  if (!user) {
    return { error: unauthorizedResponse('Authentication required') };
  }

  return { user };
};

export const requireRole = (
  request: NextRequest,
  allowedRoles: string[]
): { user: JWTPayload } | { error: Response } => {
  const authResult = requireAuth(request);

  if ('error' in authResult) {
    return authResult;
  }

if (!allowedRoles.includes(authResult.user.role)) {
    return {
      error: new Response(
        JSON.stringify({ success: false, error: 'Insufficient permissions' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      ),
    };
  }

  return authResult;
};

export const requireRoleAsync = async (
  request: NextRequest,
  allowedRoles: string[]
): Promise<{ user: JWTPayload } | { error: Response }> => {
  const authResult = await requireAuthAsync(request);

  if ('error' in authResult) {
    return authResult;
  }

if (!allowedRoles.includes(authResult.user.role)) {
    return {
      error: new Response(
        JSON.stringify({ success: false, error: 'Insufficient permissions' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      ),
    };
  }

  return authResult;
};
