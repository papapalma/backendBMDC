/**
 * Example Webhook Verification Endpoint
 *
 * This endpoint demonstrates how to verify webhook signatures using HMAC-SHA256.
 * It validates incoming webhooks to ensure they:
 * 1. Come from trusted sources (signature matches)
 * 2. Haven't been tampered with (payload integrity)
 * 3. Are timely (timestamp is recent, preventing replay attacks)
 *
 * Usage:
 *   POST /api/webhooks/verify
 *   Headers:
 *     X-Signature: <hmac-sha256-hex>
 *     X-Timestamp: <iso-8601-timestamp>
 *     Content-Type: application/json
 *   Body: { "event": "attendance_submitted", ... }
 */

import { NextRequest } from 'next/server';
import { verifyWebhookSignature } from '@/lib/security/webhook-signing';
import { withErrorHandler } from '@/middleware/errorHandler';
import { successResponse, forbiddenResponse, errorResponse } from '@/utils/responses';
import { logger } from '@/utils/logger';

// Example webhook secrets (in production, fetch from database or environment)
// Each external service should have its own secret
const WEBHOOK_SECRETS: Record<string, string> = {
  'external-service-1': process.env.WEBHOOK_SECRET_SERVICE_1 || 'default-secret-1',
  'external-service-2': process.env.WEBHOOK_SECRET_SERVICE_2 || 'default-secret-2',
};

/**
 * POST /api/webhooks/verify
 *
 * Verify webhook signature and process the event.
 * Returns 200 if signature is valid, 401 if invalid.
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  // 1. Extract headers
  const signatureHeader = request.headers.get('x-signature');
  const timestampHeader = request.headers.get('x-timestamp');
  const source = request.headers.get('x-source') || 'unknown'; // optional: identify source

  // 2. Parse body
  const payload = await request.json();

  // 3. Get secret for this source (in production: from database or vault)
  const secret = WEBHOOK_SECRETS[source];
  if (!secret) {
    logger.warn('[WEBHOOK] Unknown webhook source', { source });
    return forbiddenResponse('Unknown webhook source');
  }

  // 4. Verify signature and timestamp
  const verification = verifyWebhookSignature({
    payload,
    signature: signatureHeader ?? undefined,
    timestamp: timestampHeader ?? undefined,
    secret,
    maxAgeMs: 5 * 60 * 1000, // 5 minute max age
  });

  if (!verification.valid) {
    logger.warn('[WEBHOOK] Verification failed', {
      source,
      reason: verification.reason,
      signature: signatureHeader?.substring(0, 8) + '...',
    });
    return forbiddenResponse(`Webhook verification failed: ${verification.reason}`);
  }

  // 5. Process the webhook event (implement your business logic here)
  try {
    logger.info('[WEBHOOK] Processing verified webhook', { source, event: payload.event });

    // Example: handle different event types
    switch (payload.event) {
      case 'attendance_submitted':
        await handleAttendanceSubmitted(payload);
        break;

      case 'enrollment_created':
        await handleEnrollmentCreated(payload);
        break;

      case 'training_completed':
        await handleTrainingCompleted(payload);
        break;

      default:
        logger.warn('[WEBHOOK] Unknown event type', { event: payload.event });
    }

    return successResponse(
      { received: true, event: payload.event },
      'Webhook processed successfully'
    );
  } catch (error) {
    logger.error('[WEBHOOK] Processing error', { source, error: String(error) });
    return errorResponse('Failed to process webhook', 500);
  }
});

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

/**
 * Handle attendance_submitted event
 */
async function handleAttendanceSubmitted(payload: Record<string, unknown>) {
  logger.info('[WEBHOOK] Attendance submitted', payload);
  // TODO: Implement your business logic
  // e.g., update database, send notifications, etc.
}

/**
 * Handle enrollment_created event
 */
async function handleEnrollmentCreated(payload: Record<string, unknown>) {
  logger.info('[WEBHOOK] Enrollment created', payload);
  // TODO: Implement your business logic
}

/**
 * Handle training_completed event
 */
async function handleTrainingCompleted(payload: Record<string, unknown>) {
  logger.info('[WEBHOOK] Training completed', payload);
  // TODO: Implement your business logic
}

// ---------------------------------------------------------------------------
// OPTIONS for CORS (if needed)
// ---------------------------------------------------------------------------

export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Signature, X-Timestamp, X-Source',
    },
  });
}
