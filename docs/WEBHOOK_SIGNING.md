# Webhook Signing Implementation Guide

## Overview

This document describes the webhook signing implementation using HMAC-SHA256 to ensure authenticity and prevent spoofing attacks.

**Requirements Met:**
- 25.1: Sign webhook payloads with HMAC-SHA256
- 25.2: Verify signatures and reject invalid/expired signatures
- 25.3: Prevent replay attacks with timestamp validation

## Security Properties

### 1. **Payload Integrity**
- HMAC-SHA256 ensures the payload hasn't been tampered with
- Any modification to the payload will invalidate the signature

### 2. **Authenticity**
- Only the holder of the shared secret can generate valid signatures
- Receivers verify the signature to confirm the message came from a trusted source

### 3. **Replay Attack Prevention**
- Timestamps are included in the signature computation
- Expired webhooks (>5 minutes old by default) are rejected
- Using an old signature with a new timestamp will fail verification

### 4. **Timing Attack Resistance**
- Constant-time comparison used for signature verification
- Prevents attackers from using timing differences to forge signatures

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────┐
│ Your System                                             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  signWebhook(payload, secret)                           │
│  ↓                                                       │
│  HMAC-SHA256(payload + timestamp, secret)               │
│  ↓                                                       │
│  Headers: X-Signature, X-Timestamp                      │
│  ↓                                                       │
│  HTTP POST to External Endpoint                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
                        ↓
                   [Network]
                        ↓
┌─────────────────────────────────────────────────────────┐
│ External System (Webhook Consumer)                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  POST /webhooks/verify                                  │
│  ↓                                                       │
│  verifyWebhookSignature(payload, sig, ts, secret)       │
│  ↓                                                       │
│  Compare signatures (constant-time)                     │
│  Check timestamp freshness                              │
│  ↓                                                       │
│  Valid → Process event (200 OK)                         │
│  Invalid → Reject (401 Forbidden)                       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## API Reference

### Signing a Webhook

```typescript
import { signWebhook, generateWebhookSecret } from '@/lib/security/webhook-signing';

// Generate a secret (do this once per endpoint)
const secret = generateWebhookSecret(); // 64-char hex string

// Create and sign a webhook
const payload = {
  event: 'attendance_submitted',
  traineeId: '123',
  sessionId: '456',
};

const { signature, timestamp } = signWebhook(payload, secret);

// Send HTTP POST with headers
const response = await fetch('https://external.example.com/webhooks', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Signature': signature,
    'X-Timestamp': timestamp,
  },
  body: JSON.stringify(payload),
});
```

### Verifying a Webhook

```typescript
import { verifyWebhookSignature } from '@/lib/security/webhook-signing';

export const POST = async (request: NextRequest) => {
  const payload = await request.json();
  const signature = request.headers.get('x-signature');
  const timestamp = request.headers.get('x-timestamp');
  const secret = process.env.WEBHOOK_SECRET;

  const result = verifyWebhookSignature({
    payload,
    signature,
    timestamp,
    secret,
    maxAgeMs: 5 * 60 * 1000, // 5 minutes
  });

  if (!result.valid) {
    return new Response(
      JSON.stringify({ error: result.reason }),
      { status: 401 }
    );
  }

  // Process the webhook
  await handleWebhookEvent(payload);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
```

## Usage Patterns

### Pattern 1: Simple Endpoint Verification

```typescript
// src/app/api/webhooks/verify/route.ts
import { POST } from './route'; // See example implementation

// Verifies any incoming webhook with a single secret
```

### Pattern 2: Multi-Source Webhooks

```typescript
const WEBHOOK_SECRETS: Record<string, string> = {
  'service-a': process.env.WEBHOOK_SECRET_A,
  'service-b': process.env.WEBHOOK_SECRET_B,
};

export const POST = async (request) => {
  const source = request.headers.get('x-source');
  const secret = WEBHOOK_SECRETS[source];

  if (!secret) return forbiddenResponse('Unknown source');

  // Verify with service-specific secret
  const result = verifyWebhookSignature({
    payload: await request.json(),
    signature: request.headers.get('x-signature'),
    timestamp: request.headers.get('x-timestamp'),
    secret,
  });

  if (!result.valid) return forbiddenResponse(result.reason);
  // ... process
};
```

### Pattern 3: Broadcasting to Multiple Endpoints

```typescript
// When an event occurs, notify all subscribed webhooks
import { broadcastWebhookEvent } from '@/services/webhookService';

export const POST = async (request: NextRequest) => {
  // ... verify auth, parse input ...

  const attendanceRecord = await attendanceService.submitAttendance(data);

  // Fetch subscribed webhooks
  const webhooks = await db.query(
    'SELECT * FROM webhook_endpoints WHERE active = true'
  );

  // Send to all
  await broadcastWebhookEvent(webhooks, {
    event: 'attendance_submitted',
    timestamp: new Date().toISOString(),
    data: {
      attendanceId: attendanceRecord.id,
      traineeId: attendanceRecord.trainee_id,
    },
  });

  return createdResponse(attendanceRecord);
};
```

## Testing

### Unit Tests (Pre-Written)

All webhook signing functionality is tested in:
```
src/__tests__/security/webhook-signing.test.ts
```

Run tests:
```bash
npm test -- --testPathPatterns=webhook-signing
```

**Coverage:**
- ✅ Signing with different payloads/secrets
- ✅ Verification with valid signatures
- ✅ Rejection of tampered signatures
- ✅ Rejection of tampered payloads
- ✅ Timestamp validation (old/new/future)
- ✅ Replay attack prevention
- ✅ Timing attack resistance
- ✅ Next.js array headers handling
- ✅ Secret generation (random, cryptographic)

### Integration Testing

```typescript
it('End-to-end: sign and verify workflow', () => {
  const payload = { event: 'test', data: { id: '123' } };
  const secret = generateWebhookSecret();

  // Sign
  const { signature, timestamp } = signWebhook(payload, secret);

  // Verify
  const result = verifyWebhookSignature({
    payload,
    signature,
    timestamp,
    secret,
  });

  expect(result.valid).toBe(true);
});

it('Replay attack: different timestamp fails', () => {
  const payload = { event: 'test' };
  const secret = generateWebhookSecret();

  const { signature, timestamp } = signWebhook(payload, secret);

  // Try with different timestamp
  const result = verifyWebhookSignature({
    payload,
    signature,
    timestamp: new Date(Date.now() + 100).toISOString(),
    secret,
  });

  expect(result.valid).toBe(false);
});
```

## Security Considerations

### Secret Management

1. **Generation**: Use `generateWebhookSecret()` to create cryptographically random secrets
   ```typescript
   const secret = generateWebhookSecret(); // 32 bytes / 64 hex chars
   ```

2. **Storage**: Never commit secrets to version control
   ```bash
   # .env (DO NOT COMMIT)
   WEBHOOK_SECRET_SERVICE_A=a1b2c3d4e5f6...
   WEBHOOK_SECRET_SERVICE_B=f6e5d4c3b2a1...
   ```

3. **Rotation**: Regularly rotate secrets
   - Store old secret during transition period
   - Accept webhooks signed with either key
   - Gradually phase out old secret after receivers update

### Network Security

1. **HTTPS Only**: Always use HTTPS for webhook transmission
   ```typescript
   if (!endpoint.url.startsWith('https://')) {
     throw new Error('Webhook URL must use HTTPS');
   }
   ```

2. **Timeout**: Set appropriate timeouts
   ```typescript
   await fetch(url, {
     timeout: 10000, // 10 seconds
   });
   ```

3. **Retry Logic**: Implement exponential backoff
   ```typescript
   // Retry failed deliveries with exponential backoff
   const delayMs = 1000 * Math.pow(2, attemptNumber);
   ```

### Verification Best Practices

1. **Always Verify**: Never skip signature verification
   ```typescript
   // ❌ WRONG: Trusting any X-Signature
   if (request.headers.has('x-signature')) {
     // Assume it's valid!
   }

   // ✅ CORRECT: Verify the signature
   const result = verifyWebhookSignature({ ... });
   if (!result.valid) return forbiddenResponse(result.reason);
   ```

2. **Check Timestamp**: Always validate timestamp freshness
   ```typescript
   // ✅ Default 5 minutes (configurable)
   const result = verifyWebhookSignature({
     payload,
     signature,
     timestamp,
     secret,
     maxAgeMs: 5 * 60 * 1000,
   });
   ```

3. **Log Everything**: Audit all webhook operations
   ```typescript
   logger.info('[WEBHOOK] Verification successful', {
     source,
     event: payload.event,
     timestamp,
   });

   logger.warn('[WEBHOOK] Verification failed', {
     source,
     reason: result.reason,
   });
   ```

## Deployment

### Phase Rollout

1. **Week 1**: Deploy webhook infrastructure without enforcing signatures
   - Endpoint accepts webhooks
   - Signature verification is optional
   - Logging captures all events

2. **Week 2**: Enable signature verification for new webhooks
   - New webhook endpoints MUST provide valid signatures
   - Existing webhooks can still send unsigned

3. **Week 3**: Mandatory for all endpoints
   - All webhook requests require valid signatures
   - Unsigned requests are rejected with 401

4. **Week 4**: Monitor and optimize
   - Review logs for any issues
   - Adjust max age if needed
   - Document for consumers

### Environment Variables

```bash
# .env.production
WEBHOOK_SECRET_SERVICE_A=<64-char hex from generateWebhookSecret()>
WEBHOOK_SECRET_SERVICE_B=<64-char hex>
WEBHOOK_MAX_AGE_MS=300000  # 5 minutes
WEBHOOK_TIMEOUT_MS=10000   # 10 seconds
```

### Monitoring

**Alerts:**
- Webhook verification failures > 10/min
- Webhook delivery failures > 50/hour
- Invalid timestamps (indicates clock skew)
- Replay attack attempts (same signature, different timestamp)

**Metrics:**
- `webhook_verify_duration_ms` — Time to verify signature
- `webhook_deliver_duration_ms` — Time to deliver webhook
- `webhook_verify_failures_total` — Total verification failures
- `webhook_deliver_failures_total` — Total delivery failures

## Common Issues

### Issue 1: Signature Mismatch on Valid Webhooks

**Cause**: JSON stringification differences
- Whitespace changes
- Key order changes
- Number formatting

**Solution**: Always use `JSON.stringify()` consistently
```typescript
// Correct: consistent stringification
const message = JSON.stringify(payload) + '.' + timestamp;

// Wrong: may have different whitespace
const message = JSON.stringify(payload, null, 2) + '.' + timestamp;
```

### Issue 2: Timestamp Expired Immediately

**Cause**: System clock differences between sender and receiver
- Sender's clock ahead
- Network latency

**Solution**: Increase max age for testing, use NTP sync in production
```typescript
// Testing: 1 hour
const result = verifyWebhookSignature({
  payload,
  signature,
  timestamp,
  secret,
  maxAgeMs: 60 * 60 * 1000,
});

// Production: 5 minutes
// Ensure NTP synchronization on both systems
```

### Issue 3: Array Headers from Next.js

**Cause**: Next.js may return headers as arrays
- Headers can be `string | string[]`

**Solution**: Automatically handled by `verifyWebhookSignature()`
```typescript
// This works with both formats:
const signature: string | string[] | undefined = request.headers.get('x-signature');
const result = verifyWebhookSignature({
  payload,
  signature, // Handles array automatically
  timestamp,
  secret,
});
```

## Examples

### Example 1: Slack-like Webhook

```typescript
// External system calls us
POST /api/webhooks/slack
X-Signature: sha256=...
X-Timestamp: 1234567890

{ "event": "message", "text": "..." }
```

### Example 2: Stripe-like Webhook

```typescript
// Stripe sends webhook
POST /api/webhooks/stripe
Stripe-Signature: t=...,v1=...

{ "type": "charge.succeeded", "data": {...} }
```

**Note**: Stripe uses a different format. Their signature includes timestamp + signature. Our implementation is simpler and equally secure.

## References

- [HMAC - Wikipedia](https://en.wikipedia.org/wiki/HMAC)
- [OWASP - Webhook Security](https://owasp.org/www-community/attacks/Webhook_Attacks)
- [Node.js crypto module](https://nodejs.org/api/crypto.html)
- [RFC 2104 - HMAC](https://tools.ietf.org/html/rfc2104)

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-10-06 | Initial webhook signing implementation |

</content>
