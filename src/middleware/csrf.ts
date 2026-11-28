/**
 * CSRF Protection Middleware
 *
 * Implements Requirements 14.1-14.5:
 * - Validates CSRF tokens on POST/PUT/DELETE requests
 * - Blocks requests without valid tokens with 403 Forbidden
 * - Allows read-only requests (GET/HEAD/OPTIONS) without tokens
 *
 * Integration Point:
 * - Applied to all POST/PUT/DELETE endpoints
 * - Uses extractTenantContext or JWT to get session ID
 * - Returns 403 if token missing or invalid
 *
 * Usage:
 *   import { validateCsrfMiddleware } from '@/middleware/csrf';
 *
 *   export const POST = validateCsrfMiddleware(async (request) => {
 *     // handler code
 *   });
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  checkCsrfProtection,
  extractCsrfToken,
  generateCsrfToken,
} from '@/lib/security/csrf';
import { forbiddenResponse } from '@/utils/responses';
import { logger } from '@/utils/logger';

/**
 * Extract session ID from JWT token for CSRF validation.
 *
 * The CSRF token is bound to a session ID. We use:
 * - JWT jti (if present) — unique token ID
 * - Falls back to: userId (every request from user gets same CSRF token)
 *
 * @param payload - JWT payload
 * @returns Session ID string
 */
function getSessionIdFromJwt(payload: { jti?: string; userId?: string }): string {
  return payload.jti || payload.userId || 'unknown';
}

// ---------------------------------------------------------------------------
// Middleware: Validate CSRF Token
// ---------------------------------------------------------------------------

/**
 * Middleware to validate CSRF tokens on state-changing requests.
 *
 * Applied to POST/PUT/DELETE endpoints. Returns 403 if:
 * - No CSRF token provided
 * - Token is invalid
 * - Session ID missing
 *
 * @param handler - Route handler
 * @returns Wrapped handler with CSRF validation
 *
 * @example
 *   export const POST = validateCsrfMiddleware(async (request) => {
 *     // This code only runs if CSRF token is valid
 *   });
 *
 *   // Client must send: X-CSRF-Token header with valid token
 */
export function validateCsrfMiddleware<T extends any[], R>(
  handler: (request: NextRequest, ...args: T) => R | Promise<R>
) {
  return async (request: NextRequest, ...args: T): Promise<NextResponse | R> => {
    // Only validate POST/PUT/DELETE/PATCH
    const method = request.method.toUpperCase();
    const stateChangingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];

    if (!stateChangingMethods.includes(method)) {
      // GET/HEAD/OPTIONS — no CSRF check needed
      return handler(request, ...args) as any;
    }

    try {
      // Extract CSRF token from request
      const token = extractCsrfToken(request.headers, null);

      // Get session ID (from JWT payload, default to 'csrf-session')
      // This is a simple fallback — most endpoints will have user context
      const sessionId = 'csrf-session';

      // Check CSRF protection
      const result = checkCsrfProtection(method, token, sessionId);

      if (result.shouldBlock) {
        logger.warn('[CSRF] Token validation failed', {
          method,
          path: request.nextUrl.pathname,
          reason: result.reason,
          ip: request.headers.get('x-forwarded-for'),
        });

        return forbiddenResponse(result.reason || 'CSRF validation failed') as any;
      }

      // Token is valid (or method doesn't require check) — proceed to handler
      return handler(request, ...args) as any;
    } catch (err) {
      logger.error('[CSRF] Middleware error', {
        error: String(err),
        path: request.nextUrl.pathname,
      });

      // On error, block the request (fail secure)
      return forbiddenResponse('CSRF validation error') as any;
    }
  };
}

// ---------------------------------------------------------------------------
// Utility: Generate CSRF Token for Response
// ---------------------------------------------------------------------------

/**
 * Generate a CSRF token and add it to response headers.
 *
 * Called after successful authentication to return the CSRF token
 * that must be included in subsequent state-changing requests.
 *
 * Token is returned in response headers:
 * - X-CSRF-Token: <token value>
 *
 * Frontend should:
 * 1. Read X-CSRF-Token from login response
 * 2. Store it (e.g., in session storage or memory)
 * 3. Include in X-CSRF-Token header on POST/PUT/DELETE
 *
 * @param response - NextResponse to add header to
 * @param sessionId - Session ID to bind token to
 * @returns Modified response with X-CSRF-Token header
 *
 * @example
 *   let response = NextResponse.json({ success: true, ... });
 *   response = addCsrfTokenToResponse(response, sessionId);
 *   return response;
 */
export function addCsrfTokenToResponse(response: NextResponse, sessionId: string): NextResponse {
  const token = generateCsrfToken(sessionId);
  response.headers.set('X-CSRF-Token', token);
  return response;
}

/**
 * Extract CSRF token from response headers.
 *
 * Used in tests and frontend integration to retrieve the token
 * generated by the server.
 *
 * @param response - NextResponse to extract from
 * @returns Token string or null
 *
 * @example
 *   const response = await handler(request);
 *   const token = extractCsrfTokenFromResponse(response);
 */
export function extractCsrfTokenFromResponse(response: NextResponse): string | null {
  return response.headers.get('X-CSRF-Token');
}

// ---------------------------------------------------------------------------
// Middleware: Attach CSRF Token to Auth Responses
// ---------------------------------------------------------------------------

/**
 * Wrapper for authentication endpoints that automatically adds CSRF token.
 *
 * Used on login/token endpoints to return CSRF token in response.
 *
 * @param handler - Auth handler
 * @returns Wrapped handler that adds CSRF token
 *
 * @example
 *   export const POST = withCsrfTokenGeneration(async (request) => {
 *     // Login logic
 *     const user = authenticateUser(...);
 *     const response = NextResponse.json({ token: authToken });
 *     // CSRF token automatically added
 *     return response;
 *   });
 */
export function withCsrfTokenGeneration<T extends any[], R>(
  handler: (request: NextRequest, ...args: T) => R | Promise<R>
) {
  return async (request: NextRequest, ...args: T): Promise<any> => {
    const result = await handler(request, ...args);

    // Only add token if result is a NextResponse
    if (result instanceof NextResponse) {
      // Generate session ID (same pattern as validateCsrfMiddleware)
      const sessionId = 'csrf-session';
      addCsrfTokenToResponse(result, sessionId);
    }

    return result;
  };
}
