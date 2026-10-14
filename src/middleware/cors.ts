import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/utils/logger';

/**
 * CORS Configuration
 *
 * Implements strict origin allowlisting to prevent CORS-based attacks.
 * Origins not in the allowlist are denied (SEC-19, Req 21.1, 21.2).
 */
const ALLOWED_ORIGINS = [
  'http://localhost:3001',
  'http://localhost:5173',
  'https://bmdc.online',
  'https://www.bmdc.online',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const ALLOWED_HEADERS = [
  'X-CSRF-Token',
  'X-Requested-With',
  'Accept',
  'Accept-Version',
  'Content-Length',
  'Content-MD5',
  'Content-Type',
  'Date',
  'X-Api-Version',
  'Authorization',
];

const MAX_AGE = '86400'; // 24 hours

/**
 * Validate origin against allowlist.
 *
 * DENY BY DEFAULT: Origins not in allowlist are rejected (SEC-19).
 * In development, localhost:* origins are permitted for flexibility.
 * In production, only explicitly configured origins are allowed.
 *
 * @param origin - Request origin header
 * @returns true if origin is allowed, false otherwise
 */
function isOriginAllowed(origin: string | null): boolean {
  if (!origin) {
    return false;
  }

  // Development: allow any localhost origin
  if (process.env.NODE_ENV === 'development' && origin.startsWith('http://localhost')) {
    return true;
  }

  // Production: strict allowlist
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  if (!isAllowed) {
    logger.warn('[CORS] Rejected request from unauthorized origin', {
      origin,
      allowedOrigins: ALLOWED_ORIGINS,
    });
  }

  return isAllowed;
}

/**
 * Add CORS headers to response.
 * When origin is not in the allowlist, no ACAO header is set so the browser
 * enforces same-origin policy (SEC-19).
 */
export function addCorsHeaders(
  response: NextResponse,
  origin?: string | null
): NextResponse {
  if (origin && isOriginAllowed(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS.join(', '));
    response.headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(', '));
    response.headers.set('Access-Control-Max-Age', MAX_AGE);
    response.headers.set('Access-Control-Expose-Headers', 'Content-Length, X-JSON-Response-Time');

    if (process.env.NODE_ENV === 'development') {
      logger.debug('[CORS] Request allowed', { origin });
    }
  }
  // No ACAO header for unknown origins — browser enforces same-origin policy

  return response;
}

/**
 * Handle OPTIONS request (preflight)
 */
export function handleOptionsRequest(request: NextRequest): NextResponse {
  const origin = request.headers.get('origin');

  if (!isOriginAllowed(origin)) {
    return new NextResponse(null, { status: 403 });
  }

  const response = new NextResponse(null, { status: 200 });
  return addCorsHeaders(response, origin);
}

/**
 * Create CORS-enabled response
 */
export function corsResponse(
  data: any,
  request: NextRequest,
  init?: ResponseInit
): NextResponse {
  const origin = request.headers.get('origin');
  const response = NextResponse.json(data, init);
  return addCorsHeaders(response, origin);
}

/**
 * Verify CORS preflight is valid
 */
export function verifyCorsPreflightRequest(request: NextRequest): boolean {
  if (request.method !== 'OPTIONS') {
    return true; // Not a preflight request
  }

  const origin = request.headers.get('origin');
  const method = request.headers.get('access-control-request-method');

  if (!origin || !isOriginAllowed(origin)) {
    logger.warn('[CORS] Invalid preflight - unauthorized origin', { origin });
    return false;
  }

  if (!method) {
    logger.warn('[CORS] Invalid preflight - no requested method');
    return false;
  }

  if (!ALLOWED_METHODS.includes(method.toUpperCase())) {
    logger.warn('[CORS] Invalid preflight - disallowed method', { method });
    return false;
  }

  return true;
}
