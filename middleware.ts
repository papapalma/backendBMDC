/**
 * Next.js Edge Middleware — HTTPS Redirect & Security Headers
 *
 * Implements Requirements 21.6, 21.7:
 *   - 21.6  Redirect HTTP requests to HTTPS in production
 *   - 21.7  Set Strict-Transport-Security (HSTS) header
 *
 * This middleware runs on every request before it reaches any route handler.
 * It enforces HTTPS in production and adds security headers that cannot be
 * set via next.config.js alone (e.g. dynamic HSTS based on environment).
 *
 * Note: Static security headers (X-Frame-Options, CSP, HSTS, etc.) are also
 * configured in next.config.js for defence-in-depth. This middleware adds
 * the HTTPS redirect logic that next.config.js cannot express.
 *
 * TLS configuration (Req 21.7):
 *   - TLS 1.2 minimum, TLS 1.3 preferred
 *   - Strong cipher suites enforced at the reverse proxy / load balancer level
 *     (Nginx, AWS ALB, Cloudflare) — not configurable in Next.js itself
 *   - See docs/tls-configuration.md for recommended Nginx cipher suite config
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseMiddlewareClient } from '@/utils/supabase/middleware';

/**
 * HSTS header value (Req 21.7):
 *   max-age=63072000  — 2 years (63,072,000 seconds)
 *   includeSubDomains — applies to all subdomains
 *   preload           — eligible for browser HSTS preload list
 */
const HSTS_VALUE = 'max-age=63072000; includeSubDomains; preload';

export function middleware(request: NextRequest): NextResponse {
  const { nextUrl, headers } = request;
  const isProduction = process.env.NODE_ENV === 'production';

  // ── HTTPS redirect (Req 21.6) ────────────────────────────────────────────
  // In production, redirect any plain HTTP request to HTTPS.
  // The x-forwarded-proto header is set by reverse proxies (Nginx, ALB, etc.)
  // when the original request was HTTP.
  if (isProduction) {
    const proto = headers.get('x-forwarded-proto');
    if (proto === 'http') {
      const httpsUrl = new URL(nextUrl.toString());
      httpsUrl.protocol = 'https:';
      return NextResponse.redirect(httpsUrl, { status: 301 });
    }
  }

  // ── Supabase session refresh ─────────────────────────────────────────────
  // Keeps the user's Supabase auth session alive by refreshing cookies on
  // every request that passes through middleware.
  const { supabaseResponse } = createSupabaseMiddlewareClient(request);

  // ── Security headers ─────────────────────────────────────────────────────
  // HSTS (Req 21.7) — also set in next.config.js for defence-in-depth
  if (isProduction) {
    supabaseResponse.headers.set('Strict-Transport-Security', HSTS_VALUE);
  }

  return supabaseResponse;
}

/**
 * Matcher: run middleware on all routes except Next.js internals and
 * static files (which don't need HTTPS redirect logic).
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     *   - _next/static  (static files)
     *   - _next/image   (image optimisation)
     *   - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
