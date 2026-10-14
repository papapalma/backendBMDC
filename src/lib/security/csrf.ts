/**
 * CSRF Protection Utilities
 *
 * Implements Requirements 14.1-14.5:
 * - Generate CSRF tokens on authentication
 * - Validate CSRF tokens on state-changing requests
 * - Use Node.js crypto for token generation (no external dependency)
 *
 * Implementation: Cryptographically signed tokens bound to session ID
 * Token = HMAC-SHA256(sessionId, APP_SECRET)
 *
 * This provides deterministic but secure tokens that:
 * - Cannot be forged without the APP_SECRET
 * - Are specific to each session (different tokens per sessionId)
 * - Are consistent (same sessionId = same token, allowing validation)
 */

import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

/**
 * Secret key for HMAC signing. Must be present in environment.
 * Falls back to a default for development (INSECURE).
 */
const CSRF_SECRET = process.env.CSRF_SECRET || process.env.JWT_SECRET || 'csrf-default-dev-key';

if (!process.env.CSRF_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('[CSRF] WARNING: CSRF_SECRET not set. Using JWT_SECRET fallback.');
}

// ---------------------------------------------------------------------------
// Token Generation
// ---------------------------------------------------------------------------

/**
 * Generate a CSRF token for a given session.
 *
 * Uses HMAC-SHA256 to create a deterministic but cryptographically
 * secure token bound to the session ID. The same sessionId will
 * always produce the same token (deterministic for validation),
 * but an attacker cannot forge a token without knowing CSRF_SECRET.
 *
 * Token format: 64-character hex string (HMAC-SHA256 output)
 *
 * @param sessionId - Unique session identifier (e.g., JWT jti, user session ID)
 * @returns CSRF token string
 *
 * @example
 *   const token = generateCsrfToken('user-123-session');
 *   // Returns: 'a1b2c3d4e5f6...' (64 hex chars)
 */
export function generateCsrfToken(sessionId: string): string {
  const hmac = createHmac('sha256', CSRF_SECRET);
  hmac.update(sessionId);
  return hmac.digest('hex');
}

// ---------------------------------------------------------------------------
// Token Validation
// ---------------------------------------------------------------------------

export interface CsrfValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate a CSRF token against a session.
 *
 * Compares the provided token with the expected token for the session.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param token - CSRF token from request (header or body)
 * @param sessionId - Session ID to validate against
 * @returns CsrfValidationResult with validity and reason
 *
 * @example
 *   const token = getTokenFromRequest(request);
 *   const sessionId = getUserSessionId();
 *   const result = validateCsrfToken(token, sessionId);
 *   if (!result.valid) {
 *     return forbiddenResponse(result.reason);
 *   }
 */
export function validateCsrfToken(token: unknown, sessionId: unknown): CsrfValidationResult {
  // Type guards
  if (typeof token !== 'string') {
    return { valid: false, reason: 'CSRF token must be a string' };
  }

  if (typeof sessionId !== 'string') {
    return { valid: false, reason: 'Session ID must be a string' };
  }

  // Reject empty values
  if (!token || !sessionId) {
    return { valid: false, reason: 'CSRF token or session ID is missing' };
  }

  // Generate expected token
  const expectedToken = generateCsrfToken(sessionId);

  // Use constant-time comparison to prevent timing attacks
  // crypto.timingSafeEqual throws if lengths differ, so check first
  try {
    if (token.length !== expectedToken.length) {
      return { valid: false, reason: 'Invalid CSRF token' };
    }

    const isValid = timingSafeEqual(
      Buffer.from(token, 'utf8'),
      Buffer.from(expectedToken, 'utf8')
    );

    return { valid: isValid, reason: isValid ? undefined : 'Invalid CSRF token' };
  } catch (err) {
    // timingSafeEqual can throw on invalid input
    return { valid: false, reason: 'CSRF token validation failed' };
  }
}

// ---------------------------------------------------------------------------
// Request Integration
// ---------------------------------------------------------------------------

/**
 * Extract CSRF token from HTTP request headers or body.
 *
 * Checks:
 * 1. X-CSRF-Token header
 * 2. X-Csrf-Token header (case variants)
 *
 * @param headers - Request headers
 * @param body - Request body (for future support of csrf_token in form data)
 * @returns Token string or null if not found
 *
 * @example
 *   const token = extractCsrfToken(request.headers, null);
 */
export function extractCsrfToken(
  headers: { get(name: string): string | null },
  body?: Record<string, unknown> | null
): string | null {
  // Check X-CSRF-Token header (case-insensitive due to NextRequest)
  const headerToken = headers.get('X-CSRF-Token') || headers.get('x-csrf-token');
  if (headerToken) {
    return headerToken;
  }

  // Check body (for form data or JSON)
  if (body && typeof body === 'object') {
    const bodyToken = body.csrf_token || body.csrfToken;
    if (typeof bodyToken === 'string') {
      return bodyToken;
    }
  }

  return null;
}

/**
 * Check if a request method requires CSRF protection.
 *
 * State-changing methods (POST, PUT, DELETE, PATCH) require CSRF tokens.
 * Read-only methods (GET, HEAD, OPTIONS) do not.
 *
 * @param method - HTTP method
 * @returns true if CSRF token is required
 *
 * @example
 *   requiresCsrfToken('POST') → true
 *   requiresCsrfToken('GET') → false
 */
export function requiresCsrfToken(method: string): boolean {
  const stateChangingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
  return stateChangingMethods.includes(method.toUpperCase());
}

// ---------------------------------------------------------------------------
// Middleware Integration
// ---------------------------------------------------------------------------

export interface CsrfCheckResult {
  valid: boolean;
  reason?: string;
  shouldBlock: boolean;
}

/**
 * Check CSRF protection for a request.
 *
 * Returns result with shouldBlock flag indicating if request should be rejected.
 *
 * Logic:
 * - GET/HEAD/OPTIONS: always allowed (no CSRF check)
 * - POST/PUT/DELETE: requires valid CSRF token
 *
 * @param method - HTTP method
 * @param token - CSRF token from request
 * @param sessionId - Session ID to validate against
 * @returns CsrfCheckResult
 *
 * @example
 *   const result = checkCsrfProtection('POST', token, sessionId);
 *   if (result.shouldBlock) {
 *     return forbiddenResponse(result.reason);
 *   }
 */
export function checkCsrfProtection(
  method: string,
  token: string | null,
  sessionId: string
): CsrfCheckResult {
  // Read-only methods don't need CSRF protection
  if (!requiresCsrfToken(method)) {
    return { valid: true, shouldBlock: false };
  }

  // State-changing methods require a token
  if (!token) {
    return {
      valid: false,
      reason: 'CSRF token is required for this request',
      shouldBlock: true,
    };
  }

  // Validate the token
  const validation = validateCsrfToken(token, sessionId);

  return {
    valid: validation.valid,
    reason: validation.reason,
    shouldBlock: !validation.valid,
  };
}
