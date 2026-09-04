import { NextRequest, NextResponse } from 'next/server';

/**
 * CORS Configuration
 */
const ALLOWED_ORIGINS = [
  'http://localhost:3001',
  'http://localhost:5173',
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

/**
 * Add CORS headers to response.
 * When origin is not in the allowlist, no ACAO header is set so the browser
 * enforces same-origin policy (SEC-19).
 */
export function addCorsHeaders(
  response: NextResponse,
  origin?: string | null
): NextResponse {
  // In development, be more permissive to allow localhost:* origins

if (process.env.NODE_ENV === 'development' && origin && origin.startsWith('http://localhost')) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS.join(', '));
    response.headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(', '));
    response.headers.set('Access-Control-Max-Age', '86400');
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS.join(', '));
    response.headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(', '));
    response.headers.set('Access-Control-Max-Age', '86400');
  }
  // No ACAO header for unknown origins — do not fall back to localhost

return response;
}

/**
 * Handle OPTIONS request (preflight)
 */
export function handleOptionsRequest(request: NextRequest): NextResponse {
  const origin = request.headers.get('origin');
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
