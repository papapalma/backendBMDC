/**
 * CMS Authentication Middleware
 *
 * Implements Requirements 2.1, 2.11, 12.1, 12.2, 12.3:
 *   - 2.1   Extract tenant_id from authenticated user context
 *   - 2.11  Extract tenant_id from JWT token and pass to data layer queries
 *   - 12.1  Restrict customization panel access to authorized admins
 *   - 12.2  Display customization interface for authorized admins
 *   - 12.3  Reject unauthorized API calls with 403 Forbidden
 *
 * This middleware:
 *   1. Extracts and verifies JWT from Authorization header or cookies
 *   2. Validates tenant_id presence in token
 *   3. Validates admin_id presence in token
 *   4. Validates admin role (admin or superadmin required)
 *   5. Attaches CMSTenantContext to request object
 *   6. Returns 401 Unauthorized if no token or token invalid
 *   7. Returns 403 Forbidden if tenant_id missing or role insufficient
 */

import { NextRequest } from 'next/server';
import { verifyToken, extractTokenFromHeader, extractTokenFromCookie } from '@/lib/auth';
import { forbiddenResponse, unauthorizedResponse } from '@/utils/responses';
import { logger } from '@/utils/logger';

/**
 * CMS Tenant Context - tenant isolation for CMS operations
 * Attached to requests that pass authentication
 */
export interface CMSTenantContext {
  /** UUID of the tenant the admin belongs to */
  tenantId: string;
  /** UUID of the authenticated admin user */
  adminId: string;
  /** Role of the authenticated admin (admin or superadmin) */
  adminRole: string;
  /** True if authenticated (always true when this context exists) */
  authenticated: boolean;
}

/**
 * Result of CMS auth extraction
 */
export interface CMSAuthResult {
  context?: CMSTenantContext;
  error?: Response;
}

/**
 * Extract raw JWT token from request (Authorization header or cookie)
 */
function getRawToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  const cookieHeader = request.headers.get('cookie');

  return (
    extractTokenFromHeader(authHeader || '') ??
    extractTokenFromCookie(cookieHeader || '') ??
    null
  );
}

/**
 * Extract CMS tenant context from request JWT
 *
 * Returns success with context if all validations pass, or error response otherwise.
 *
 * Validation sequence:
 *   1. Token presence (401 if missing)
 *   2. Token validity (401 if invalid)
 *   3. tenant_id presence in token (403 if missing)
 *   4. admin_id presence in token (403 if missing)
 *   5. Role validation - must be 'admin' or 'superadmin' (403 if insufficient)
 *
 * @example
 * ```ts
 * const result = extractCMSAuth(request);
 * if (result.error) return result.error;
 * const { tenantId, adminId, adminRole } = result.context!;
 * ```
 */
export function extractCMSAuth(request: NextRequest): CMSAuthResult {
  const token = getRawToken(request);

  // ── 1. Token presence ────────────────────────────────────────────────────

  if (!token) {
    logger.warn('[CMS_AUTH] No JWT found in request', {
      url: request.url,
      method: request.method,
    });
    return {
      error: unauthorizedResponse('No authentication token provided'),
    };
  }

  // ── 2. Token validity ────────────────────────────────────────────────────

  const payload = verifyToken(token);

  if (!payload) {
    logger.warn('[CMS_AUTH] JWT verification failed', {
      url: request.url,
      method: request.method,
    });
    return {
      error: unauthorizedResponse('Invalid or expired token'),
    };
  }

  // ── 3. tenant_id presence ────────────────────────────────────────────────

  if (!payload.tenantId) {
    logger.warn('[CMS_AUTH] JWT payload missing tenantId', {
      userId: payload.userId,
      role: payload.role,
      url: request.url,
    });
    return {
      error: forbiddenResponse('Missing tenant context: tenantId not in token'),
    };
  }

  // ── 4. admin_id presence (userId maps to admin_id) ──────────────────────

  // Note: In our JWT schema, userId represents the admin_id for CMS operations
  if (!payload.userId) {
    logger.warn('[CMS_AUTH] JWT payload missing userId/adminId', {
      tenantId: payload.tenantId,
      url: request.url,
    });
    return {
      error: forbiddenResponse('Missing admin context: userId not in token'),
    };
  }

  // ── 5. Role validation ───────────────────────────────────────────────────

  const adminRole = payload.role?.toLowerCase() || '';
  const isAdmin = adminRole === 'admin' || adminRole === 'local_admin';
  const isSuperAdmin = adminRole === 'super_admin' || adminRole === 'superadmin';
  const isAuthorized = isAdmin || isSuperAdmin;

  if (!isAuthorized) {
    logger.warn('[CMS_AUTH] Insufficient admin role', {
      userId: payload.userId,
      tenantId: payload.tenantId,
      role: payload.role,
      url: request.url,
    });
    return {
      error: forbiddenResponse('Admin access required: insufficient role'),
    };
  }

  // ── 6. Build context ─────────────────────────────────────────────────────

  const context: CMSTenantContext = {
    tenantId: payload.tenantId,
    adminId: payload.userId,
    adminRole: payload.role,
    authenticated: true,
  };

  logger.debug('[CMS_AUTH] Context resolved', {
    tenantId: context.tenantId,
    adminId: context.adminId,
    adminRole: context.adminRole,
    url: request.url,
  });

  return { context };
}

/**
 * Middleware wrapper for CMS endpoints requiring admin authentication
 *
 * This is a higher-order function that wraps a Next.js API route handler.
 * If authentication fails, returns 401 or 403 immediately without calling handler.
 *
 * Usage:
 * ```ts
 * export const POST = withCMSAuth(async (request, context) => {
 *   const { tenantId, adminId } = context;
 *   // ... tenant-scoped CMS logic
 * });
 * ```
 */
export type CMSHandler = (
  request: NextRequest,
  context: CMSTenantContext
) => Promise<Response> | Response;

export function withCMSAuth(handler: CMSHandler) {
  return async function cmsAuthWrapper(request: NextRequest): Promise<Response> {
    const result = extractCMSAuth(request);

    if (result.error) {
      return result.error;
    }

    return handler(request, result.context!);
  };
}

/**
 * Convenience function: require CMS auth or return error response
 *
 * For use in route handlers that need to check auth inline:
 * ```ts
 * export async function POST(request: NextRequest) {
 *   const authResult = requireCMSAuth(request);
 *   if (authResult.error) return authResult.error;
 *   const { tenantId, adminId, adminRole } = authResult.context!;
 *   // ... proceed with CMS operation
 * }
 * ```
 */
export function requireCMSAuth(request: NextRequest): CMSAuthResult {
  return extractCMSAuth(request);
}
