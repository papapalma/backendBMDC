/**
 * Rate Limiting Tests
 * Task 6.4: Write tests (before code changes) - Rate Limiting Enforcement
 *
 * These tests validate that rate limiting is properly enforced across endpoints:
 * 1. Attendance submission endpoint: 5 submissions per hour per trainee
 * 2. File upload endpoint: 10 uploads per hour per user
 * 3. Rate limit resets after window expires
 * 4. Different users have independent limits
 * 5. Retry-After header present in 429 responses
 *
 * Test scenarios:
 * - Multiple requests within limit -> accepted (2xx/3xx)
 * - Request exceeding limit -> rejected (429)
 * - Retry-After header validation
 * - Window reset behavior
 * - Per-user isolation
 */

import { checkRateLimit, getRateLimitKey, RateLimitOptions } from '@/utils/rateLimit';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock Next.js Request object with specified IP
 */
function createMockRequest(ip: string): Request {
  const url = new URL('http://localhost:3000/api/test');
  return {
    url: url.toString(),
    method: 'POST',
    headers: {
      get: (key: string) => {
        if (key.toLowerCase() === 'x-forwarded-for') return ip;
        if (key.toLowerCase() === 'x-real-ip') return ip;
        return null;
      },
      has: (key: string) => {
        return key.toLowerCase() === 'x-forwarded-for' || key.toLowerCase() === 'x-real-ip';
      },
    },
  } as any as Request;
}

/**
 * Helper to wait for rate limit window to expire
 * (uses real setTimeout to simulate time passage)
 */
async function waitForWindowExpiry(windowMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, windowMs + 100); // +100ms for safety margin
  });
}

// ============================================================================
// Test Suite: Rate Limiting Enforcement
// ============================================================================

describe('Rate Limiting - checkRateLimit utility', () => {
  // =========================================================================
  // Test 1: Submit 5 times in same hour -> all succeed (201)
  // =========================================================================

  it('Test 1: should allow 5 submissions within the rate limit window', () => {
    // Arrange
    const key = 'submit:tenant-123:trainee-456';
    const options: RateLimitOptions = {
      limit: 5,
      windowMs: 60 * 60 * 1000, // 1 hour
    };

    // Act & Assert: Make 5 requests
    for (let i = 0; i < 5; i++) {
      const response = checkRateLimit(key, options);
      expect(response).toBeNull(); // null = allowed, not rejected
    }
  });

  // =========================================================================
  // Test 2: Submit 6th time -> 429 Too Many Requests
  // =========================================================================

  it('Test 2: should return 429 when request exceeds rate limit', () => {
    // Arrange
    const key = 'submit:tenant-789:trainee-012';
    const options: RateLimitOptions = {
      limit: 5,
      windowMs: 60 * 60 * 1000,
    };

    // Act: Make 6 requests
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, options); // First 5 allowed
    }

    const sixthResponse = checkRateLimit(key, options); // 6th should be rejected

    // Assert
    expect(sixthResponse).not.toBeNull();
    expect(sixthResponse?.status).toBe(429);
  });

  // =========================================================================
  // Test 3: Retry-After header present in 429 response
  // =========================================================================

  it('Test 3: should include Retry-After header in 429 response', async () => {
    // Arrange
    const key = 'submit:tenant-345:trainee-678';
    const windowMs = 60 * 1000; // 1 minute
    const options: RateLimitOptions = {
      limit: 2,
      windowMs,
    };

    // Act: Exceed limit
    checkRateLimit(key, options); // 1st allowed
    checkRateLimit(key, options); // 2nd allowed
    const rejectedResponse = checkRateLimit(key, options); // 3rd rejected (429)

    // Assert
    expect(rejectedResponse?.status).toBe(429);

    const retryAfter = rejectedResponse?.headers.get('Retry-After');
    expect(retryAfter).toBeDefined();
    expect(retryAfter).not.toBeNull();

    // Retry-After should be a number (seconds)
    const retryAfterSeconds = parseInt(retryAfter!, 10);
    expect(retryAfterSeconds).toBeGreaterThan(0);
    expect(retryAfterSeconds).toBeLessThanOrEqual(60); // Should not exceed window
  });

  // =========================================================================
  // Test 4: Different users have independent limits
  // =========================================================================

  it('Test 4: should track rate limits independently per user/key', () => {
    // Arrange: Two different users
    const userAKey = 'submit:tenant-111:trainee-aaa';
    const userBKey = 'submit:tenant-111:trainee-bbb';
    const options: RateLimitOptions = {
      limit: 3,
      windowMs: 60 * 1000,
    };

    // Act & Assert: User A fills their limit
    checkRateLimit(userAKey, options); // 1/3 for A
    checkRateLimit(userAKey, options); // 2/3 for A
    checkRateLimit(userAKey, options); // 3/3 for A (full)

    // User A should be rejected on 4th
    const userAFourthResponse = checkRateLimit(userAKey, options);
    expect(userAFourthResponse?.status).toBe(429);

    // But User B should still be able to make requests (separate limit)
    const userBFirstResponse = checkRateLimit(userBKey, options);
    expect(userBFirstResponse).toBeNull(); // Allowed

    const userBSecondResponse = checkRateLimit(userBKey, options);
    expect(userBSecondResponse).toBeNull(); // Allowed

    const userBThirdResponse = checkRateLimit(userBKey, options);
    expect(userBThirdResponse).toBeNull(); // Allowed

    // User B's 4th should also be rejected
    const userBFourthResponse = checkRateLimit(userBKey, options);
    expect(userBFourthResponse?.status).toBe(429);
  });

  // =========================================================================
  // Test 5: Limit resets after window expires
  // =========================================================================

  it('Test 5: should reset limit after window expires', async () => {
    // Arrange: Very short window for testing
    const key = 'submit:tenant-999:trainee-zzz';
    const windowMs = 100; // 100ms window
    const options: RateLimitOptions = {
      limit: 2,
      windowMs,
    };

    // Act: Fill the limit in first window
    checkRateLimit(key, options); // 1/2
    checkRateLimit(key, options); // 2/2

    // Should be rejected on 3rd
    const rejectedInFirstWindow = checkRateLimit(key, options);
    expect(rejectedInFirstWindow?.status).toBe(429);

    // Wait for window to expire
    await waitForWindowExpiry(windowMs);

    // After reset, should accept new requests
    const firstAfterReset = checkRateLimit(key, options);
    expect(firstAfterReset).toBeNull(); // Allowed (new window)

    const secondAfterReset = checkRateLimit(key, options);
    expect(secondAfterReset).toBeNull(); // Allowed
  }, 10000); // Increase timeout for this async test

  // =========================================================================
  // Test 6: Attendance submission rate limit (5 per hour)
  // =========================================================================

  it('Test 6: should enforce attendance submission rate limit (5 per hour)', () => {
    // Arrange: Attendance submission key
    const tenantId = 'tenant-attn-001';
    const traineeId = 'trainee-attn-001';
    const key = `submit:${tenantId}:${traineeId}`;
    const options: RateLimitOptions = {
      limit: 5,
      windowMs: 60 * 60 * 1000, // 1 hour
    };

    // Act & Assert: Make 5 submissions successfully
    for (let i = 1; i <= 5; i++) {
      const response = checkRateLimit(key, options);
      expect(response).toBeNull();
    }

    // 6th submission should fail
    const sixthSubmission = checkRateLimit(key, options);
    expect(sixthSubmission?.status).toBe(429);
    expect(sixthSubmission?.headers.get('Retry-After')).toBeDefined();
  });

  // =========================================================================
  // Test 7: File upload rate limit (10 per hour)
  // =========================================================================

  it('Test 7: should enforce file upload rate limit (10 per hour)', () => {
    // Arrange: File upload key
    const tenantId = 'tenant-upload-001';
    const userId = 'user-upload-001';
    const key = `upload:${tenantId}:${userId}`;
    const options: RateLimitOptions = {
      limit: 10,
      windowMs: 60 * 60 * 1000, // 1 hour
    };

    // Act & Assert: Make 10 uploads successfully
    for (let i = 1; i <= 10; i++) {
      const response = checkRateLimit(key, options);
      expect(response).toBeNull();
    }

    // 11th upload should fail
    const eleventhUpload = checkRateLimit(key, options);
    expect(eleventhUpload?.status).toBe(429);
  });

  // =========================================================================
  // Test 8: Rate limit response has correct Content-Type
  // =========================================================================

  it('Test 8: should return JSON response with correct Content-Type', () => {
    // Arrange
    const key = 'submit:tenant-ct:trainee-ct';
    const options: RateLimitOptions = {
      limit: 1,
      windowMs: 60 * 1000,
    };

    // Act: Fill limit and get rejected response
    checkRateLimit(key, options); // 1/1
    const rejectedResponse = checkRateLimit(key, options); // Rejected

    // Assert
    expect(rejectedResponse?.status).toBe(429);
    expect(rejectedResponse?.headers.get('Content-Type')).toBe('application/json');
  });

  // =========================================================================
  // Test 9: Rate limit response body contains error message
  // =========================================================================

  it('Test 9: should include error message in 429 response body', async () => {
    // Arrange
    const key = 'submit:tenant-msg:trainee-msg';
    const options: RateLimitOptions = {
      limit: 1,
      windowMs: 60 * 1000,
    };

    // Act: Fill limit and get rejected response
    checkRateLimit(key, options); // 1/1
    const rejectedResponse = checkRateLimit(key, options); // Rejected

    // Assert
    expect(rejectedResponse?.status).toBe(429);

    const body = await rejectedResponse!.json();
    expect(body).toHaveProperty('success', false);
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('Too many requests');
  });

  // =========================================================================
  // Test 10: Cross-tenant rate limits are independent
  // =========================================================================

  it('Test 10: should maintain independent limits across tenants', () => {
    // Arrange: Same user in different tenants
    const tenantAKey = `submit:tenant-a:trainee-shared`;
    const tenantBKey = `submit:tenant-b:trainee-shared`;
    const options: RateLimitOptions = {
      limit: 2,
      windowMs: 60 * 1000,
    };

    // Act & Assert: Tenant A - fill limit
    checkRateLimit(tenantAKey, options); // 1/2
    checkRateLimit(tenantAKey, options); // 2/2

    const tenantAThird = checkRateLimit(tenantAKey, options);
    expect(tenantAThird?.status).toBe(429);

    // Tenant B - should have independent limit
    checkRateLimit(tenantBKey, options); // 1/2
    checkRateLimit(tenantBKey, options); // 2/2

    const tenantBThird = checkRateLimit(tenantBKey, options);
    expect(tenantBThird?.status).toBe(429);

    // Both tenants should maintain their limits independently
    expect(tenantAThird?.status).toBe(429);
    expect(tenantBThird?.status).toBe(429);
  });

  // =========================================================================
  // Test 11: getRateLimitKey extracts IP correctly
  // =========================================================================

  it('Test 11: should extract rate limit key from request with x-forwarded-for header', () => {
    // Arrange
    const ip = '192.168.1.100';
    const request = createMockRequest(ip);
    const prefix = 'submit';

    // Act
    const key = getRateLimitKey(request, prefix);

    // Assert
    expect(key).toContain(prefix);
    expect(key).toContain(ip);
  });

  // =========================================================================
  // Test 12: Rate limit response indicates remaining window time accurately
  // =========================================================================

  it('Test 12: should calculate accurate Retry-After time', () => {
    // Arrange
    const key = 'submit:tenant-retry:trainee-retry';
    const windowMs = 5000; // 5 seconds
    const options: RateLimitOptions = {
      limit: 1,
      windowMs,
    };

    // Act: Make first request, then get rejection
    const startTime = Date.now();
    checkRateLimit(key, options); // 1/1
    const rejectedResponse = checkRateLimit(key, options); // Rejected

    const retryAfterStr = rejectedResponse?.headers.get('Retry-After');
    const retryAfterSeconds = parseInt(retryAfterStr!, 10);
    const elapsedMs = Date.now() - startTime;

    // Assert: Retry-After should be approximately window time minus elapsed
    const expectedRetryAfter = Math.ceil((windowMs - elapsedMs) / 1000);
    expect(retryAfterSeconds).toBeGreaterThan(0);
    expect(retryAfterSeconds).toBeLessThanOrEqual(expectedRetryAfter + 1); // Allow 1s buffer
  });
});

// ============================================================================
// Test Suite: Integration with Key Prefixes
// ============================================================================

describe('Rate Limiting - Key Prefix Isolation', () => {
  // =========================================================================
  // Test 13: Different prefix keys maintain separate limits
  // =========================================================================

  it('Test 13: should maintain separate limits for different action prefixes', () => {
    // Arrange: Same user/tenant but different actions
    const baseKey = 'tenant-123:user-456';
    const submitKey = `submit:${baseKey}`;
    const uploadKey = `upload:${baseKey}`;

    const submitOptions: RateLimitOptions = { limit: 5, windowMs: 3600000 };
    const uploadOptions: RateLimitOptions = { limit: 10, windowMs: 3600000 };

    // Act & Assert: Submit limit (5)
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(submitKey, submitOptions)).toBeNull();
    }
    expect(checkRateLimit(submitKey, submitOptions)?.status).toBe(429);

    // Upload limit should still allow 10 requests (separate tracking)
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(uploadKey, uploadOptions)).toBeNull();
    }
    expect(checkRateLimit(uploadKey, uploadOptions)?.status).toBe(429);
  });

  // =========================================================================
  // Test 14: Login attempt rate limiting (5 failures per 15 min)
  // =========================================================================

  it('Test 14: should support login attempt rate limiting (e.g., 5 failures per 15 min)', () => {
    // Arrange: Login failure tracking
    const email = 'user@example.com';
    const key = `login:${email}`;
    const options: RateLimitOptions = {
      limit: 5,
      windowMs: 15 * 60 * 1000, // 15 minutes
    };

    // Act & Assert: Allow 5 failed attempts
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, options)).toBeNull();
    }

    // 6th attempt should be rejected
    const sixthAttempt = checkRateLimit(key, options);
    expect(sixthAttempt?.status).toBe(429);
  });

  // =========================================================================
  // Test 15: Verify code attempt rate limiting (5 per 5 min)
  // =========================================================================

  it('Test 15: should support OTP/verify code rate limiting (e.g., 5 per 5 min)', () => {
    // Arrange: OTP verification attempts
    const email = 'user@example.com';
    const key = `verify-code:${email}`;
    const options: RateLimitOptions = {
      limit: 5,
      windowMs: 5 * 60 * 1000, // 5 minutes
    };

    // Act & Assert: Allow 5 attempts
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, options)).toBeNull();
    }

    // 6th attempt should be rejected
    const sixthAttempt = checkRateLimit(key, options);
    expect(sixthAttempt?.status).toBe(429);
  });
});

// ============================================================================
// Test Suite: Edge Cases & Boundary Conditions
// ============================================================================

describe('Rate Limiting - Edge Cases', () => {
  // =========================================================================
  // Test 16: Very large limit (bulk operations)
  // =========================================================================

  it('Test 16: should handle large limits (e.g., 1000 requests per hour)', () => {
    // Arrange
    const key = 'bulk:tenant:user';
    const options: RateLimitOptions = {
      limit: 1000,
      windowMs: 3600000,
    };

    // Act: Make 1000 requests
    for (let i = 0; i < 1000; i++) {
      expect(checkRateLimit(key, options)).toBeNull();
    }

    // 1001st should be rejected
    const excess = checkRateLimit(key, options);
    expect(excess?.status).toBe(429);
  });

  // =========================================================================
  // Test 17: Very short window (sub-second)
  // =========================================================================

  it('Test 17: should handle short rate limit windows', async () => {
    // Arrange: 100ms window
    const key = 'fast:tenant:user';
    const options: RateLimitOptions = {
      limit: 2,
      windowMs: 100,
    };

    // Act: Fill window
    checkRateLimit(key, options); // 1/2
    checkRateLimit(key, options); // 2/2

    const exceeded = checkRateLimit(key, options);
    expect(exceeded?.status).toBe(429);

    // Wait and check reset
    await waitForWindowExpiry(options.windowMs);

    const afterReset = checkRateLimit(key, options);
    expect(afterReset).toBeNull(); // Should be allowed again
  }, 5000);

  // =========================================================================
  // Test 18: Zero-length key (edge case)
  // =========================================================================

  it('Test 18: should handle unusual keys gracefully', () => {
    // Arrange: Edge case keys
    const emptyKey = '';
    const specialCharsKey = 'key:with:colons:and:@special#chars$';
    const options: RateLimitOptions = {
      limit: 2,
      windowMs: 60000,
    };

    // Act & Assert: Should not crash, just track separately
    const response1 = checkRateLimit(emptyKey, options);
    expect(response1).toBeNull();

    const response2 = checkRateLimit(specialCharsKey, options);
    expect(response2).toBeNull();
  });
});
