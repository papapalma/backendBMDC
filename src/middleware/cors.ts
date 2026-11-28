import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/utils/logger';

/**
 * CORS Configuration
 *
 * Implements strict origin allowlisting to prevent CORS-based attacks.
 * Origins not in the allowlist are denied (SEC-19, Req 21.1, 21.2).
 */
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
  'http://127.0.0.1:3003',
  'http://127.0.0.1:5173',
  'https://bmdc.site',
  'https://www.bmdc.site',
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
  'X-Upload-Token',
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
export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) {
    return false;
  }

  const normalizedOrigin = origin.replace(/\/+$/, '');

  // Development: allow any localhost or 127.0.0.1 origin
  if (process.env.NODE_ENV === 'development' && (normalizedOrigin.startsWith('http://localhost') || normalizedOrigin.startsWith('http://127.0.0.1'))) {
    return true;
  }

  // Production: strict allowlist (also respect dynamically updated FRONTEND_URL)
  const envFrontendOrigin = process.env.FRONTEND_URL?.replace(/\/+$/, '');
  const isAllowed =
    ALLOWED_ORIGINS.includes(normalizedOrigin) ||
    (Boolean(envFrontendOrigin) && normalizedOrigin === envFrontendOrigin);

  if (!isAllowed) {
    logger.warn('[CORS] Rejected request from unauthorized origin', {
      origin: normalizedOrigin,
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
  if (data instanceof NextResponse) {
    return addCorsHeaders(data, origin);
  }
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
