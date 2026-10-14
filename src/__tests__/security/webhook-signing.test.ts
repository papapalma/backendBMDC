/**
 * Tests for Webhook Signing & Verification
 *
 * **Validates: Requirements 25.1, 25.2, 25.3**
 *
 * 25.1 Sign webhook payloads with HMAC-SHA256
 * 25.2 Verify signatures and reject invalid/expired
 * 25.3 Prevent replay attacks with timestamp validation
 */

import {
  signWebhook,
  verifyWebhookSignature,
  generateWebhookSecret,
  WebhookSigningResult,
} from '@/lib/security/webhook-signing';

describe('Webhook Signing - signWebhook()', () => {
  const secret = 'test-secret-key-min-32-bytes-long';
  const payload = { event: 'attendance_submitted', traineeId: '123', sessionId: '456' };

  it('should sign a payload and return signature + timestamp', () => {
    const result = signWebhook(payload, secret);

    expect(result.signature).toBeDefined();
    expect(result.timestamp).toBeDefined();
    expect(result.signature).toMatch(/^[a-f0-9]{64}$/); // SHA256 = 64 hex chars
    expect(new Date(result.timestamp)).toBeInstanceOf(Date);
  });

  it('should produce consistent signatures for same payload', () => {
    const ts = new Date('2024-10-05T10:00:00Z').toISOString();
    
    // Mock Date to get consistent timestamp
    const originalNow = Date.now;
    const originalISOString = Date.prototype.toISOString;
    
    try {
      Date.prototype.toISOString = jest.fn(() => ts);
      
      const result1 = signWebhook(payload, secret);
      const result2 = signWebhook(payload, secret);

      expect(result1.signature).toBe(result2.signature);
      expect(result1.timestamp).toBe(result2.timestamp);
    } finally {
      Date.prototype.toISOString = originalISOString;
    }
  });

  it('should produce different signatures for different payloads', () => {
    const result1 = signWebhook(payload, secret);
    const result2 = signWebhook({ ...payload, traineeId: '999' }, secret);

    expect(result1.signature).not.toBe(result2.signature);
  });

  it('should produce different signatures for different secrets', () => {
    const result1 = signWebhook(payload, secret);
    const result2 = signWebhook(payload, 'different-secret-key');

    expect(result1.signature).not.toBe(result2.signature);
  });

  it('should handle complex nested payloads', () => {
    const complexPayload = {
      event: 'attendance_submitted',
      trainee: { id: '123', name: 'John' },
      gps: { lat: 40.7128, lng: -74.006, accuracy: 10 },
      metadata: { source: 'mobile', version: '1.0' },
    };

    const result = signWebhook(complexPayload, secret);
    expect(result.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should handle empty payload object', () => {
    const result = signWebhook({}, secret);
    expect(result.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should handle payload with special characters', () => {
    const specialPayload = {
      event: 'test',
      message: 'Hello "world" with \\n newlines',
      emoji: '🎉',
    };

    const result = signWebhook(specialPayload, secret);
    expect(result.signature).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Webhook Verification - verifyWebhookSignature()', () => {
  const secret = 'test-secret-key-min-32-bytes-long';
  const payload = { event: 'attendance_submitted', traineeId: '123' };

  // Helper to create valid signature
  function createValidSignature(p: Record<string, unknown>, s: string, ts: string) {
    const { createHmac } = require('crypto');
    const message = `${JSON.stringify(p)}.${ts}`;
    return createHmac('sha256', s).update(message).digest('hex');
  }

  it('Valid signature: should verify correct signature', () => {
    const signed = signWebhook(payload, secret);

    const result = verifyWebhookSignature({
      payload,
      signature: signed.signature,
      timestamp: signed.timestamp,
      secret,
    });

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('Invalid signature: should reject tampered signature', () => {
    const signed = signWebhook(payload, secret);
    const tamperedSig = signed.signature.slice(0, -1) + '0';

    const result = verifyWebhookSignature({
      payload,
      signature: tamperedSig,
      timestamp: signed.timestamp,
      secret,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Invalid signature');
  });

  it('Invalid signature: should reject wrong secret', () => {
    const signed = signWebhook(payload, secret);

    const result = verifyWebhookSignature({
      payload,
      signature: signed.signature,
      timestamp: signed.timestamp,
      secret: 'wrong-secret-key',
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Invalid signature');
  });

  it('Invalid signature: should reject tampered payload', () => {
    const signed = signWebhook(payload, secret);
    const tamperedPayload = { ...payload, traineeId: '999' };

    const result = verifyWebhookSignature({
      payload: tamperedPayload,
      signature: signed.signature,
      timestamp: signed.timestamp,
      secret,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Invalid signature');
  });

  it('Missing signature: should reject missing X-Signature header', () => {
    const signed = signWebhook(payload, secret);

    const result = verifyWebhookSignature({
      payload,
      signature: undefined,
      timestamp: signed.timestamp,
      secret,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing X-Signature');
  });

  it('Missing timestamp: should reject missing X-Timestamp header', () => {
    const signed = signWebhook(payload, secret);

    const result = verifyWebhookSignature({
      payload,
      signature: signed.signature,
      timestamp: undefined,
      secret,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing X-Timestamp');
  });

  it('Expired timestamp: should reject timestamp older than maxAgeMs', () => {
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    const sig = createValidSignature(payload, secret, oldTimestamp);

    const result = verifyWebhookSignature({
      payload,
      signature: sig,
      timestamp: oldTimestamp,
      secret,
      maxAgeMs: 5 * 60 * 1000, // 5 min max
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('too old');
  });

  it('Recent timestamp: should accept timestamp within maxAgeMs', () => {
    const recentTimestamp = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 min ago
    const sig = createValidSignature(payload, secret, recentTimestamp);

    const result = verifyWebhookSignature({
      payload,
      signature: sig,
      timestamp: recentTimestamp,
      secret,
      maxAgeMs: 5 * 60 * 1000,
    });

    expect(result.valid).toBe(true);
  });

  it('Future timestamp: should reject timestamp in the future', () => {
    const futureTimestamp = new Date(Date.now() + 60 * 1000).toISOString(); // 1 min in future
    const sig = createValidSignature(payload, secret, futureTimestamp);

    const result = verifyWebhookSignature({
      payload,
      signature: sig,
      timestamp: futureTimestamp,
      secret,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('future');
  });

  it('Invalid timestamp format: should reject malformed timestamp', () => {
    const signed = signWebhook(payload, secret);

    const result = verifyWebhookSignature({
      payload,
      signature: signed.signature,
      timestamp: 'not-a-valid-date',
      secret,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Invalid X-Timestamp format');
  });

  it('Custom maxAgeMs: should accept custom max age', () => {
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    const sig = createValidSignature(payload, secret, oldTimestamp);

    const result = verifyWebhookSignature({
      payload,
      signature: sig,
      timestamp: oldTimestamp,
      secret,
      maxAgeMs: 15 * 60 * 1000, // 15 min max
    });

    expect(result.valid).toBe(true);
  });

  it('Array headers: should handle Next.js array headers', () => {
    const signed = signWebhook(payload, secret);

    const result = verifyWebhookSignature({
      payload,
      signature: [signed.signature], // Array from Next.js
      timestamp: [signed.timestamp],
      secret,
    });

    expect(result.valid).toBe(true);
  });

  it('Constant-time comparison: should resist timing attacks', () => {
    const signed = signWebhook(payload, secret);
    
    // These should all take roughly the same time to verify
    // (This is more of a documentation test; actual timing attack resistance
    // is hard to test without timing measurements)
    
    const result1 = verifyWebhookSignature({
      payload,
      signature: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      timestamp: signed.timestamp,
      secret,
    });

    const result2 = verifyWebhookSignature({
      payload,
      signature: signed.signature.slice(0, -1) + '0',
      timestamp: signed.timestamp,
      secret,
    });

    // Both should fail but in constant time
    expect(result1.valid).toBe(false);
    expect(result2.valid).toBe(false);
  });
});

describe('Webhook Secret Generation - generateWebhookSecret()', () => {
  it('should generate a 64-character hex string', () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should generate unique secrets each time', () => {
    const secret1 = generateWebhookSecret();
    const secret2 = generateWebhookSecret();
    expect(secret1).not.toBe(secret2);
  });

  it('should generate cryptographically random secrets', () => {
    const secrets = Array.from({ length: 10 }, () => generateWebhookSecret());
    const unique = new Set(secrets);
    expect(unique.size).toBe(10);
  });
});

describe('Webhook Signing - Integration Tests', () => {
  const secret = generateWebhookSecret();

  it('Full workflow: sign → verify → success', () => {
    const payload = {
      event: 'attendance_submitted',
      traineeId: '123',
      sessionId: '456',
      timestamp: new Date().toISOString(),
    };

    const signed = signWebhook(payload, secret);

    const result = verifyWebhookSignature({
      payload,
      signature: signed.signature,
      timestamp: signed.timestamp,
      secret,
    });

    expect(result.valid).toBe(true);
  });

  it('Replay attack: cannot reuse old signature with new timestamp', () => {
    const payload = { event: 'attendance_submitted', traineeId: '123' };
    const signed = signWebhook(payload, secret);

    // Try to verify with a different timestamp but same signature
    // Use a timestamp that's definitely different (100ms later)
    const newTimestamp = new Date(Date.now() + 100).toISOString();

    const result = verifyWebhookSignature({
      payload,
      signature: signed.signature,
      timestamp: newTimestamp, // Definitely different!
      secret,
    });

    // Should fail because signature was computed with original timestamp
    expect(result.valid).toBe(false);
  });

  it('Man-in-the-middle: cannot intercept and modify', () => {
    const payload = { event: 'attendance_submitted', traineeId: '123' };
    const signed = signWebhook(payload, secret);

    // MITM tries to modify the payload
    const modifiedPayload = { event: 'attendance_submitted', traineeId: '999' };

    const result = verifyWebhookSignature({
      payload: modifiedPayload,
      signature: signed.signature,
      timestamp: signed.timestamp,
      secret,
    });

    // Should fail because signature doesn't match modified payload
    expect(result.valid).toBe(false);
  });

  it('Wrong endpoint: cannot use signature from one endpoint on another', () => {
    const payload1 = { event: 'attendance_submitted', traineeId: '123' };
    const payload2 = { event: 'enrollment_created', traineeId: '456' };

    const secret1 = generateWebhookSecret();
    const secret2 = generateWebhookSecret();

    const signed1 = signWebhook(payload1, secret1);

    // Try to verify payload1's signature on payload2 with secret2
    const result = verifyWebhookSignature({
      payload: payload2,
      signature: signed1.signature,
      timestamp: signed1.timestamp,
      secret: secret2,
    });

    expect(result.valid).toBe(false);
  });
});
