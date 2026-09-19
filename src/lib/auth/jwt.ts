/**
 * JWT utility module for multi-tenant token generation and verification.
 *
 * Implements Requirements 6.3, 6.4, and 6.8:
 *   - 6.3  JWT payload includes userId, email, role, tenantId, jti, iat, exp
 *   - 6.4  Tokens expire after 8 hours
 *   - 6.8  Tokens stored in httpOnly cookies with SameSite=Strict
 *
 * Cookie helper (setCookies) is exported so API route handlers can apply the
 * correct cookie attributes without duplicating the security settings.
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import type { JWTPayload } from '@/types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

/** Token lifetime: 8 hours (Req 6.4) */
const TOKEN_EXPIRY_SECONDS = 8 * 60 * 60; // 28 800 s

// ---------------------------------------------------------------------------
// Core token operations
// ---------------------------------------------------------------------------

/**
 * Generate a signed JWT containing the full tenant-scoped payload.
 *
 * A cryptographically random `jti` (JWT ID) is injected automatically so
 * tokens can be tracked and revoked individually.
 *
 * @param payload - Must include userId, email, role, and tenantId.
 * @returns Signed JWT string.
 */
export function generateToken(payload: Omit<JWTPayload, 'jti' | 'iat' | 'exp'>): string {
  const jti = crypto.randomBytes(16).toString('hex');

  const claims: JWTPayload = {
    ...payload,
    jti,
  };

  return jwt.sign(claims, JWT_SECRET as string, {
    expiresIn: TOKEN_EXPIRY_SECONDS,
  } as jwt.SignOptions);
}

/**
 * Verify a JWT and return its decoded payload.
 *
 * @param token - Raw JWT string.
 * @returns Decoded `TokenPayload` if valid, `null` if expired or tampered.
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET as string) as JWTPayload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cookie helpers (Req 6.8)
// ---------------------------------------------------------------------------

/**
 * Options used when writing the auth_token cookie.
 *
 * - `httpOnly: true`   — prevents JavaScript access (XSS mitigation)
 * - `sameSite: 'strict'` — blocks cross-site request forgery
 * - `secure: true` in production — cookie only sent over HTTPS
 * - `path: '/'`        — available to all API routes
 */
export interface AuthCookieOptions {
  /** Override the default 8-hour max-age (seconds). */
  maxAge?: number;
}

/**
 * Apply the auth_token cookie to an existing `NextResponse`.
 *
 * Usage:
 * ```ts
 * const response = NextResponse.json({ success: true, data: { user } });
 * setAuthCookie(response, token);
 * return response;
 * ```
 */
export function setAuthCookie(
  response: NextResponse,
  token: string,
  options: AuthCookieOptions = {}
): void {
  const isProduction = process.env.NODE_ENV === 'production';

  response.cookies.set('auth_token', token, {
    httpOnly: true,
    // In production keep SameSite=Strict for strong CSRF protection.
    // During local development the frontend often runs on a different
    // origin (different localhost port). Use SameSite='lax' in
    // non-production so browsers will accept cross-site cookies during
    // development without requiring the Secure flag.
    sameSite: isProduction ? 'strict' : 'lax',
    // Secure flag ensures the cookie is only transmitted over HTTPS in
    // production; relaxed in development to allow http://localhost.
    secure: isProduction,
    maxAge: options.maxAge ?? TOKEN_EXPIRY_SECONDS,
    path: '/',
  });
}

/**
 * Clear the auth_token cookie (used during logout).
 */
export function clearAuthCookie(response: NextResponse): void {
  const isProduction = process.env.NODE_ENV === 'production';
  response.cookies.set('auth_token', '', {
    httpOnly: true,
    sameSite: isProduction ? 'strict' : 'lax',
    secure: isProduction,
    maxAge: 0,
    path: '/',
  });
}

// ---------------------------------------------------------------------------
// Token extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract a raw JWT from a `Cookie` header string.
 *
 * @param cookieHeader - Value of the `Cookie` request header.
 * @returns JWT string or `null` if not present.
 */
export function extractTokenFromCookie(cookieHeader?: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Extract a raw JWT from an `Authorization: Bearer <token>` header.
 *
 * @param authHeader - Value of the `Authorization` request header.
 * @returns JWT string or `null` if not present / malformed.
 */
export function extractTokenFromHeader(authHeader?: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.substring(7);
}
