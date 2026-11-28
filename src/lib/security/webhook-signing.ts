/**
 * Webhook Signing & Verification — HMAC-SHA256
 *
 * Implements webhook authenticity and prevents spoofing.
 *
 * Algorithm: HMAC-SHA256
 *   - Sign payload: HMAC-SHA256(secret, JSON.stringify(payload))
 *   - Timestamp: ISO 8601 format, included in signed data
 *   - Max age: 5 minutes (configurable)
 *   - Headers: X-Signature (hex), X-Timestamp (ISO)
 *
 * Usage (Sender):
 *   const { signature, timestamp } = signWebhook(payload, secret);
 *   // Send webhook with headers:
 *   //   X-Signature: <signature>
 *   //   X-Timestamp: <timestamp>
 *
 * Usage (Receiver):
 *   const result = verifyWebhookSignature({
 *     payload: received_payload,
 *     signature: req.headers['x-signature'],
 *     timestamp: req.headers['x-timestamp'],
 *     secret: webhook_secret,
 *     maxAgeMs: 5 * 60 * 1000,
 *   });
 *   if (!result.valid) return 401;
 *
 * Security Notes:
 *   - Secret should be randomly generated (min 32 bytes)
 *   - Store secret in environment variables, never in source
 *   - Signature computed over exact JSON stringification (no reformatting)
 *   - Timestamp must match sent and verified in same order
 */

import { createHmac } from 'crypto';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookSigningResult {
  signature: string; // hex string
  timestamp: string; // ISO 8601
}

export interface WebhookVerificationResult {
  valid: boolean;
  reason?: string;
}

export interface WebhookVerificationOptions {
  payload: Record<string, unknown>;
  signature: string | string[] | undefined;
  timestamp: string | string[] | undefined;
  secret: string;
  maxAgeMs?: number; // default 5 minutes
}

// ---------------------------------------------------------------------------
// Webhook Signing
// ---------------------------------------------------------------------------

/**
 * Sign a webhook payload with HMAC-SHA256.
 *
 * @param payload - The data to sign (will be JSON stringified)
 * @param secret - The shared secret key (min 32 bytes recommended)
 * @returns Object with signature (hex) and timestamp (ISO 8601)
 */
export function signWebhook(
  payload: Record<string, unknown>,
  secret: string
): WebhookSigningResult {
  const timestamp = new Date().toISOString();

  // Stringify payload consistently (no extra whitespace)
  const payloadJson = JSON.stringify(payload);

  // Combine: payload + timestamp for HMAC
  const message = `${payloadJson}.${timestamp}`;

  // Sign with HMAC-SHA256
  const signature = createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  return { signature, timestamp };
}

// ---------------------------------------------------------------------------
// Webhook Verification
// ---------------------------------------------------------------------------

/**
 * Verify a webhook signature and timestamp.
 *
 * @param options - Verification options (payload, signature, timestamp, secret, maxAgeMs)
 * @returns Object with valid=true if signature and timestamp are valid
 */
export function verifyWebhookSignature(
  options: WebhookVerificationOptions
): WebhookVerificationResult {
  const {
    payload,
    signature,
    timestamp,
    secret,
    maxAgeMs = 5 * 60 * 1000, // 5 minutes default
  } = options;

  // Normalize header values (they may be arrays from Next.js)
  const sig = Array.isArray(signature) ? signature[0] : signature;
  const ts = Array.isArray(timestamp) ? timestamp[0] : timestamp;

  // 1. Check signature header exists
  if (!sig) {
    return { valid: false, reason: 'Missing X-Signature header' };
  }

  // 2. Check timestamp header exists
  if (!ts) {
    return { valid: false, reason: 'Missing X-Timestamp header' };
  }

  // 3. Validate timestamp format (ISO 8601)
  const sentTime = new Date(ts);
  if (isNaN(sentTime.getTime())) {
    return { valid: false, reason: 'Invalid X-Timestamp format (must be ISO 8601)' };
  }

  // 4. Check timestamp is not too old
  const now = Date.now();
  const age = now - sentTime.getTime();
  if (age < 0) {
    return { valid: false, reason: 'X-Timestamp is in the future' };
  }
  if (age > maxAgeMs) {
    const seconds = Math.ceil(age / 1000);
    const maxSeconds = Math.ceil(maxAgeMs / 1000);
    return {
      valid: false,
      reason: `X-Timestamp too old: ${seconds}s ago (max: ${maxSeconds}s)`,
    };
  }

  // 5. Compute expected signature
  const payloadJson = JSON.stringify(payload);
  const message = `${payloadJson}.${ts}`;
  const expectedSig = createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  // 6. Compare signatures (constant-time to prevent timing attacks)
  if (!constantTimeCompare(sig, expectedSig)) {
    logger.warn('[WEBHOOK] Signature mismatch', {
      received: sig.substring(0, 8) + '...',
      expected: expectedSig.substring(0, 8) + '...',
    });
    return { valid: false, reason: 'Invalid signature' };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Helper: Constant-Time Comparison
// ---------------------------------------------------------------------------

/**
 * Compare two strings in constant time to prevent timing attacks.
 * 
 * Returns true if strings are equal, false otherwise.
 * Time taken is independent of where the strings differ.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ---------------------------------------------------------------------------
// Secret Generation Helper
// ---------------------------------------------------------------------------

/**
 * Generate a random webhook secret (64 hex chars = 32 bytes).
 * Use this to create new webhook secrets for endpoints.
 */
export function generateWebhookSecret(): string {
  const { randomBytes } = require('crypto');
  return randomBytes(32).toString('hex');
}
