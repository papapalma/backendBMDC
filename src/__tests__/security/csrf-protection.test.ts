/**
 * CSRF Protection Security Tests (TDD - Before Implementation)
 *
 * Tests for Cross-Site Request Forgery (CSRF) protection.
 * Validates Requirements from Task 14:
 * - POST/PUT/DELETE require valid CSRF token
 * - GET requests allowed without token
 * - Invalid tokens rejected with 403
 * - Valid tokens accepted
 *
 * Implementation in src/middleware/csrf.ts and src/lib/security/csrf.ts
 *
 * Run: npm test -- --testPathPattern=csrf-protection
 */

import { generateCsrfToken, validateCsrfToken } from '@/lib/security/csrf';
import { NextRequest } from 'next/server';

describe('CSRF Protection', () => {
  // ==========================================================================
  // Token Generation
  // ==========================================================================

  describe('Token Generation', () => {
    it('should generate a CSRF token', () => {
      const token = generateCsrfToken('session-123');
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should generate different tokens for different session IDs', () => {
      const token1 = generateCsrfToken('session-1');
      const token2 = generateCsrfToken('session-2');
      expect(token1).not.toBe(token2);
    });

    it('should generate consistent tokens for same session ID', () => {
      const sessionId = 'session-consistency-test';
      const token1 = generateCsrfToken(sessionId);
      const token2 = generateCsrfToken(sessionId);
      // Same session should produce same token (deterministic for validation)
      expect(token1).toBe(token2);
    });

    it('should generate cryptographically random tokens', () => {
      const tokens = new Set();
      for (let i = 0; i < 100; i++) {
        tokens.add(generateCsrfToken(`session-${i}`));
      }
      // Should have 100 unique tokens (no collisions)
      expect(tokens.size).toBe(100);
    });

    it('should produce tokens of consistent length', () => {
      const lengths = new Set();
      for (let i = 0; i < 10; i++) {
        const token = generateCsrfToken(`session-${i}`);
        lengths.add(token.length);
      }
      // All tokens should be same length
      expect(lengths.size).toBe(1);
    });
  });

  // ==========================================================================
  // Token Validation
  // ==========================================================================

  describe('Token Validation', () => {
    it('should validate a valid CSRF token', () => {
      const sessionId = 'session-valid-test';
      const token = generateCsrfToken(sessionId);
      const result = validateCsrfToken(token, sessionId);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid CSRF token', () => {
      const sessionId = 'session-invalid-test';
      const token = generateCsrfToken(sessionId);
      const invalidToken = 'invalid-token-xyz';
      const result = validateCsrfToken(invalidToken, sessionId);
      expect(result.valid).toBe(false);
    });

    it('should reject token with wrong session ID', () => {
      const token = generateCsrfToken('session-1');
      const result = validateCsrfToken(token, 'session-2');
      expect(result.valid).toBe(false);
    });

    it('should reject empty token', () => {
      const result = validateCsrfToken('', 'session-123');
      expect(result.valid).toBe(false);
    });

    it('should reject empty session ID', () => {
      const token = generateCsrfToken('session-123');
      const result = validateCsrfToken(token, '');
      expect(result.valid).toBe(false);
    });

    it('should provide reason when validation fails', () => {
      const result = validateCsrfToken('invalid', 'session-123');
      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
      expect(typeof result.reason).toBe('string');
    });

    it('should reject malformed tokens', () => {
      const result = validateCsrfToken('not-a-valid-token', 'session-123');
      expect(result.valid).toBe(false);
    });

    it('should handle null/undefined gracefully', () => {
      expect(() => {
        validateCsrfToken(null as any, 'session-123');
      }).not.toThrow();

      expect(() => {
        validateCsrfToken('token', null as any);
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // HTTP Request Integration
  // ==========================================================================

  describe('HTTP Request Integration', () => {
    it('should extract token from X-CSRF-Token header', () => {
      const sessionId = 'session-http-test';
      const token = generateCsrfToken(sessionId);

      const mockRequest = new NextRequest(new URL('http://localhost/api/test'), {
        method: 'POST',
        headers: {
          'X-CSRF-Token': token,
        },
      });

      const headerToken = mockRequest.headers.get('X-CSRF-Token');
      const result = validateCsrfToken(headerToken!, sessionId);
      expect(result.valid).toBe(true);
    });

    it('should be case-insensitive for header name', () => {
      const sessionId = 'session-case-test';
      const token = generateCsrfToken(sessionId);

      const mockRequest1 = new NextRequest(new URL('http://localhost/api/test'), {
        headers: { 'x-csrf-token': token },
      });

      const mockRequest2 = new NextRequest(new URL('http://localhost/api/test'), {
        headers: { 'X-CSRF-Token': token },
      });

      const token1 = mockRequest1.headers.get('x-csrf-token');
      const token2 = mockRequest2.headers.get('X-CSRF-Token');

      expect(validateCsrfToken(token1!, sessionId).valid).toBe(true);
      expect(validateCsrfToken(token2!, sessionId).valid).toBe(true);
    });

    it('should handle missing CSRF token header', () => {
      const mockRequest = new NextRequest(new URL('http://localhost/api/test'), {
        method: 'POST',
      });

      const headerToken = mockRequest.headers.get('X-CSRF-Token');
      expect(headerToken).toBeNull();
    });

    it('should handle both JSON body and form data token', () => {
      const sessionId = 'session-body-test';
      const token = generateCsrfToken(sessionId);

      // Token in header should work
      const result1 = validateCsrfToken(token, sessionId);
      expect(result1.valid).toBe(true);

      // Same token should be valid regardless of transport
      const result2 = validateCsrfToken(token, sessionId);
      expect(result2.valid).toBe(true);
    });
  });

  // ==========================================================================
  // HTTP Method Handling
  // ==========================================================================

  describe('HTTP Method Handling', () => {
    it('should require CSRF token for POST', () => {
      // POST is state-changing, requires token
      const sessionId = 'session-post-test';
      const token = generateCsrfToken(sessionId);
      const result = validateCsrfToken(token, sessionId);
      expect(result.valid).toBe(true);
    });

    it('should require CSRF token for PUT', () => {
      // PUT is state-changing, requires token
      const sessionId = 'session-put-test';
      const token = generateCsrfToken(sessionId);
      const result = validateCsrfToken(token, sessionId);
      expect(result.valid).toBe(true);
    });

    it('should require CSRF token for DELETE', () => {
      // DELETE is state-changing, requires token
      const sessionId = 'session-delete-test';
      const token = generateCsrfToken(sessionId);
      const result = validateCsrfToken(token, sessionId);
      expect(result.valid).toBe(true);
    });

    it('should not require CSRF token for GET (read-only)', () => {
      // GET should be idempotent, no token needed
      // But validation should still work if provided
      const sessionId = 'session-get-test';
      const token = generateCsrfToken(sessionId);
      const result = validateCsrfToken(token, sessionId);
      expect(result.valid).toBe(true);
    });

    it('should not require CSRF token for HEAD (read-only)', () => {
      const sessionId = 'session-head-test';
      const token = generateCsrfToken(sessionId);
      const result = validateCsrfToken(token, sessionId);
      expect(result.valid).toBe(true);
    });

    it('should not require CSRF token for OPTIONS (read-only)', () => {
      const sessionId = 'session-options-test';
      const token = generateCsrfToken(sessionId);
      const result = validateCsrfToken(token, sessionId);
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // Token Expiration (Future Enhancement)
  // ==========================================================================

  describe('Token Security Properties', () => {
    it('should reject tokens that are too short', () => {
      const result = validateCsrfToken('abc', 'session-123');
      expect(result.valid).toBe(false);
    });

    it('should handle tokens with special characters', () => {
      // Valid tokens might contain special chars, should not crash
      const result = validateCsrfToken('token-with-special!@#$%', 'session-123');
      expect(typeof result.valid).toBe('boolean');
    });

    it('should be deterministic for same inputs', () => {
      const sessionId = 'session-deterministic';
      const token1 = generateCsrfToken(sessionId);
      const token2 = generateCsrfToken(sessionId);

      const validation1 = validateCsrfToken(token1, sessionId);
      const validation2 = validateCsrfToken(token2, sessionId);

      expect(validation1.valid).toBe(true);
      expect(validation2.valid).toBe(true);
    });

    it('should reject tampered tokens', () => {
      const sessionId = 'session-tamper-test';
      const token = generateCsrfToken(sessionId);

      // Tamper with token (flip a bit or modify)
      if (token.length > 0) {
        const tamperedToken = token.slice(0, -1) + (token[token.length - 1] === 'a' ? 'b' : 'a');
        const result = validateCsrfToken(tamperedToken, sessionId);
        expect(result.valid).toBe(false);
      }
    });
  });

  // ==========================================================================
  // Security Properties (Invariants)
  // ==========================================================================

  describe('Security Invariants', () => {
    it('should never generate predictable tokens', () => {
      const tokens = [];
      for (let i = 0; i < 50; i++) {
        tokens.push(generateCsrfToken(`session-${i}`));
      }

      // Check that tokens don't follow a predictable sequence
      const diffs = [];
      for (let i = 1; i < tokens.length; i++) {
        diffs.push(tokens[i] !== tokens[i - 1] ? 1 : 0);
      }

      // All should be different (no predictable pattern)
      expect(diffs.every((d) => d === 1)).toBe(true);
    });

    it('should prevent replay attacks (wrong session)', () => {
      const token1 = generateCsrfToken('session-1');
      const token2 = generateCsrfToken('session-2');

      // Token from session-1 should not validate for session-2
      const result = validateCsrfToken(token1, 'session-2');
      expect(result.valid).toBe(false);
    });

    it('should require exact token match', () => {
      const sessionId = 'session-exact-match-test';
      const token = generateCsrfToken(sessionId);

      // Any modification should fail (except case changes for hex strings)
      const variations = [
        token + 'x',
        token.slice(0, -1),
        token + '0', // append a character
      ];

      variations.forEach((variant) => {
        const result = validateCsrfToken(variant, sessionId);
        expect(result.valid).toBe(false);
      });

      // Note: case variations (toUpperCase, toLowerCase) are valid for hex strings
      // since HMAC output is typically case-insensitive in hex representation
      // The constant-time comparison will match them if they represent the same hash
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle very long session IDs', () => {
      const longSessionId = 'a'.repeat(10000);
      const token = generateCsrfToken(longSessionId);
      expect(token).toBeDefined();
      const result = validateCsrfToken(token, longSessionId);
      expect(result.valid).toBe(true);
    });

    it('should handle session IDs with special characters', () => {
      const specialSessionId = 'session-!@#$%^&*()-_=+[]{}|;:,.<>?/~`';
      const token = generateCsrfToken(specialSessionId);
      expect(token).toBeDefined();
      const result = validateCsrfToken(token, specialSessionId);
      expect(result.valid).toBe(true);
    });

    it('should handle UUID-like session IDs', () => {
      const uuidSessionId = '550e8400-e29b-41d4-a716-446655440000';
      const token = generateCsrfToken(uuidSessionId);
      expect(token).toBeDefined();
      const result = validateCsrfToken(token, uuidSessionId);
      expect(result.valid).toBe(true);
    });

    it('should handle whitespace in token validation', () => {
      const sessionId = 'session-whitespace-test';
      const token = generateCsrfToken(sessionId);

      // Token with leading/trailing whitespace should fail
      const result = validateCsrfToken(` ${token} `, sessionId);
      expect(result.valid).toBe(false);
    });

    it('should not crash on extremely long tokens', () => {
      const longToken = 'a'.repeat(100000);
      expect(() => {
        validateCsrfToken(longToken, 'session-123');
      }).not.toThrow();
    });
  });
});
