/**
 * Tenant Context Extraction Middleware
 *
 * Implements Requirements 14.1, 14.4, 14.5:
 *   - 14.1  Extract tenant_id from JWT token on every API request
 *   - 14.4  Validate tenant_id presence in all authenticated requests
 *   - 14.5  Return 403 Forbidden if tenant context is invalid or missing
 *
 * This middleware is the single authoritative source for resolving the
 * TenantContext from an incoming Next.js request. It is intentionally
 * decoupled from the Supabase client injection (Task 3.2) so each concern
 * can be tested and evolved independently.
 */

import { NextRequest } from 'next/server';
import {
  verifyToken,
  extractTokenFromCookie,
  extractTokenFromHeader,
} from '@/lib/auth/jwt';
import { forbiddenResponse } from '@/utils/responses';
import { logger } from '@/utils/logger';
import type { UserRole } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Resolved tenant context attached to every authenticated request.
 *
 * Matches the TenantContext interface defined in the design document
 * (Components and Interfaces → Tenant Context Middleware).
 */
export interface TenantContext {
  /** UUID of the tenant the user belongs to. */
  tenantId: string;
  /** UUID of the authenticated user. */
  userId: string;
  /** Role of the authenticated user. */
  role: UserRole | string;
  /**
   * True when the user holds the `super_admin` role.
   *
   * Super Admins are granted cross-tenant access; downstream code uses this
   * flag to decide whether to bypass Row-Level Security (Req 14.7 / Task 3.2).
   */
  isSuperAdmin: boolean;
}

/** Successful extraction result. */
export type TenantContextSuccess = { context: TenantContext; error?: never };

/** Failed extraction result — carries a ready-to-return 403 Response. */
export type TenantContextFailure = { context?: never; error: Response };

export type TenantContextResult = TenantContextSuccess | TenantContextFailure;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pull the raw JWT string from the request.
 *
 * Priority order (mirrors the existing auth middleware convention):
 *   1. `Authorization: Bearer <token>` header
 *   2. `auth_token` httpOnly cookie
 */
function getRawToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  const cookieHeader = request.headers.get('cookie');

  return (
    extractTokenFromHeader(authHeader) ??
    extractTokenFromCookie(cookieHeader) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Core extraction function
// ---------------------------------------------------------------------------

/**
 * Extract and validate the tenant context from an incoming request.
 *
 * Returns a discriminated union:
 *   - `{ context }` on success
 *   - `{ error }` on failure (403 Forbidden response ready to return)
 *
 * @example
 * ```ts
 * const result = extractTenantContext(request);
 * if (result.error) return result.error;
 * const { tenantId, userId, role, isSuperAdmin } = result.context;
 * ```
 */
export function extractTenantContext(request: NextRequest): TenantContextResult {
  const token = getRawToken(request);

  // ── 1. Token presence ────────────────────────────────────────────────────

if (!token) {
    logger.warn('[TENANT_CONTEXT] No JWT found in request', {
      url: request.url,
      method: request.method,
    });
    return {
      error: forbiddenResponse('Tenant context is missing: no authentication token provided'),
    };
  }

  // ── 2. Signature & expiration verification ───────────────────────────────

const payload = verifyToken(token);

  if (!payload) {
    logger.warn('[TENANT_CONTEXT] JWT verification failed (invalid signature or expired)', {
      url: request.url,
      method: request.method,
    });
    return {
      error: forbiddenResponse('Tenant context is invalid: token verification failed'),
    };
  }

  // ── 3. tenantId presence ─────────────────────────────────────────────────
  //
  // Every non-super-admin token MUST carry a tenantId. Super Admin tokens
  // may omit tenantId when performing platform-wide operations, but we still
  // require the field to be present (even if it is a sentinel value) so that
  // downstream code can always read context.tenantId safely.
  if (!payload.tenantId) {
    logger.warn('[TENANT_CONTEXT] JWT payload missing tenantId', {
      userId: payload.userId,
      role: payload.role,
      url: request.url,
    });
    return {
      error: forbiddenResponse('Tenant context is invalid: tenantId missing from token'),
    };
  }

  // ── 4. userId presence ───────────────────────────────────────────────────

if (!payload.userId) {
    logger.warn('[TENANT_CONTEXT] JWT payload missing userId', {
      tenantId: payload.tenantId,
      url: request.url,
    });
    return {
      error: forbiddenResponse('Tenant context is invalid: userId missing from token'),
    };
  }

  // ── 5. Build context ─────────────────────────────────────────────────────

const isSuperAdmin = payload.role === 'super_admin';

  const context: TenantContext = {
    tenantId: payload.tenantId,
    userId: payload.userId,
    role: payload.role,
    isSuperAdmin,
  };

  logger.debug('[TENANT_CONTEXT] Context resolved', {
    tenantId: context.tenantId,
    userId: context.userId,
    role: context.role,
    isSuperAdmin: context.isSuperAdmin,
    url: request.url,
  });

  return { context };
}

// ---------------------------------------------------------------------------
// Convenience wrapper — returns context or throws a ready Response
// ---------------------------------------------------------------------------

/**
 * Require a valid tenant context or return a 403 response immediately.
 *
 * Designed for use inside Next.js API route handlers:
 *
 * ```ts
 * export async function GET(request: NextRequest) {
 *   const tenantResult = requireTenantContext(request);
 *   if (tenantResult.error) return tenantResult.error;
 *   const { tenantId, userId, isSuperAdmin } = tenantResult.context;
 *   // ... proceed with tenant-scoped logic
 * }
 * ```
 */
export function requireTenantContext(request: NextRequest): TenantContextResult {
  return extractTenantContext(request);
}
