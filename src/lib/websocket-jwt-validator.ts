/**
 * WebSocket JWT Validator Module
 *
 * Handles JWT validation for WebSocket connections, extracting claims for
 * authentication and authorization checks.
 *
 * Implements Requirements: 14.1, 14.2, 15.1
 *   - 14.1: WebSocket connection includes valid JWT in handshake
 *   - 14.2: WebSocket server validates JWT signature and expiration
 *   - 15.1: Production only accepts WSS (WebSocket Secure)
 */

import { verifyToken } from './auth/jwt';
import type { JWTPayload } from '@/types';

/**
 * Represents validation result of a JWT token
 */
export interface JWTValidationResult {
  valid: boolean;
  payload?: JWTPayload;
  error?: string;
}

/**
 * Represents extracted JWT claims for WebSocket connection
 */
export interface WebSocketJWTClaims {
  traineeId: string;
  tenantId: string;
  userId: string;
  email: string;
  role: string;
  exp?: number;
}

/**
 * Extract JWT token from WebSocket connection URL query parameters or headers
 *
 * In WebSocket connections, the token can be passed via:
 * 1. Query parameter: ws://localhost/socket?token=<jwt>
 * 2. Headers during handshake (handled by server framework)
 *
 * @param urlOrToken - WebSocket URL string or raw token
 * @returns Extracted token string or null
 */
export function extractJWTFromWebSocket(urlOrToken: string): string | null {
  if (!urlOrToken) return null;

  // Try to extract from query parameter first (faster path for URLs)
  if (urlOrToken.includes('?')) {
    try {
      const url = new URL(urlOrToken);
      const token = url.searchParams.get('token');
      if (token) return token;
    } catch {
      // URL parsing failed, try as direct token
    }
  }

  // Check if it looks like a JWT token (has exactly 3 parts separated by dots, with significant content)
  const parts = urlOrToken.split('.');
  if (parts.length === 3 && parts.every((part) => part.length > 0)) {
    // Looks like a valid JWT, return as-is
    return urlOrToken;
  }

  return null;
}

/**
 * Validate JWT token from WebSocket connection handshake
 *
 * This function:
 * 1. Extracts the JWT from provided source
 * 2. Verifies the signature using JWT_SECRET
 * 3. Checks expiration time
 * 4. Extracts user identity claims
 *
 * @param token - Raw JWT token string
 * @returns Validation result with payload on success, error message on failure
 */
export function validateWebSocketJWT(token: string): JWTValidationResult {
  // Validate token is provided
  if (!token) {
    return {
      valid: false,
      error: 'JWT token is required',
    };
  }

  // Validate token format (basic JWT structure check)
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    return {
      valid: false,
      error: 'Invalid JWT format',
    };
  }

  // Verify token signature and expiration
  const payload = verifyToken(token);
  if (!payload) {
    return {
      valid: false,
      error: 'JWT verification failed: invalid signature or expired token',
    };
  }

  // Check required claims are present
  const requiredClaims = ['userId', 'tenantId', 'email', 'role'];
  const missingClaims = requiredClaims.filter((claim) => !(claim in payload));

  if (missingClaims.length > 0) {
    return {
      valid: false,
      error: `JWT is missing required claims: ${missingClaims.join(', ')}`,
    };
  }

  return {
    valid: true,
    payload,
  };
}

/**
 * Extract WebSocket JWT claims from validated payload
 *
 * Converts JWT payload into claims object specific to WebSocket connections
 *
 * @param payload - Validated JWT payload
 * @returns WebSocket JWT claims
 */
export function extractWebSocketClaims(payload: JWTPayload): WebSocketJWTClaims {
  return {
    traineeId: payload.userId,
    tenantId: payload.tenantId,
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
    exp: payload.exp,
  };
}

/**
 * Check if JWT token is expired
 *
 * @param exp - Expiration timestamp (seconds since epoch)
 * @returns True if token is expired, false otherwise
 */
export function isTokenExpired(exp?: number): boolean {
  if (!exp) return false;
  const nowInSeconds = Math.floor(Date.now() / 1000);
  return nowInSeconds > exp;
}

/**
 * Validate transport protocol based on environment
 *
 * Implements Requirement 15.1: Production only accepts WSS (WebSocket Secure)
 *
 * @param protocol - Protocol string from WebSocket URL (ws or wss)
 * @returns True if protocol is valid for environment, false otherwise
 */
export function validateWebSocketProtocol(protocol: string): boolean {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    // Production requires WSS (secure WebSocket)
    return protocol === 'wss:' || protocol === 'wss';
  }

  // Development allows both WS and WSS
  return protocol === 'ws:' || protocol === 'ws' || protocol === 'wss:' || protocol === 'wss';
}

/**
 * Complete WebSocket connection authentication flow
 *
 * This is a convenience function that orchestrates the full validation:
 * 1. Extract token
 * 2. Validate JWT signature and expiration
 * 3. Extract claims
 *
 * @param token - Raw JWT token string
 * @returns Object with validation status and claims on success
 */
export function authenticateWebSocketConnection(
  token: string
): { authenticated: boolean; claims?: WebSocketJWTClaims; error?: string } {
  const validationResult = validateWebSocketJWT(token);

  if (!validationResult.valid || !validationResult.payload) {
    return {
      authenticated: false,
      error: validationResult.error,
    };
  }

  // Check if token is expired
  if (isTokenExpired(validationResult.payload.exp)) {
    return {
      authenticated: false,
      error: 'JWT token has expired',
    };
  }

  const claims = extractWebSocketClaims(validationResult.payload);

  return {
    authenticated: true,
    claims,
  };
}
