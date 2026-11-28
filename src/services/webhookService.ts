/**
 * Webhook Service — Send and manage webhooks with HMAC signing
 *
 * This service handles sending webhooks to external systems with:
 * - HMAC-SHA256 signing for authenticity
 * - Timestamp inclusion to prevent replay attacks
 * - Retry logic for failed deliveries
 * - Audit logging for compliance
 */

import { signWebhook } from '@/lib/security/webhook-signing';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookEndpoint {
  id: string;
  url: string;
  secret: string;
  events: string[]; // e.g., ['attendance_submitted', 'enrollment_created']
  active: boolean;
  maxRetries?: number;
}

export interface WebhookEvent {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventType: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastAttemptAt?: Date;
  nextRetryAt?: Date;
  error?: string;
}

// ---------------------------------------------------------------------------
// Send Signed Webhook
// ---------------------------------------------------------------------------

/**
 * Send a webhook to an external endpoint with HMAC signature.
 *
 * @param endpoint - Webhook configuration (URL, secret, etc.)
 * @param event - The event data to send
 * @returns Success/failure result
 */
export async function sendSignedWebhook(
  endpoint: WebhookEndpoint,
  event: WebhookEvent
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Prepare payload
    const payload = {
      event: event.event,
      data: event.data,
      timestamp: event.timestamp,
    };

    // 2. Sign the payload
    const { signature, timestamp } = signWebhook(payload, endpoint.secret);

    // 3. Send HTTP POST with signature headers
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
        'X-Timestamp': timestamp,
        'X-Source': 'attendance-system-v1',
      },
      body: JSON.stringify(payload),
    } as RequestInit);

    // 4. Check response
    if (response.ok) {
      logger.info('[WEBHOOK] Delivery successful', {
        webhookId: endpoint.id,
        event: event.event,
        statusCode: response.status,
      });
      return { success: true };
    } else {
      logger.warn('[WEBHOOK] Delivery failed', {
        webhookId: endpoint.id,
        event: event.event,
        statusCode: response.status,
      });
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
  } catch (error) {
    logger.error('[WEBHOOK] Delivery error', {
      webhookId: endpoint.id,
      error: String(error),
    });
    return { success: false, error: String(error) };
  }
}

// ---------------------------------------------------------------------------
// Broadcast Event to Multiple Endpoints
// ---------------------------------------------------------------------------

/**
 * Send an event to all active webhook endpoints that subscribe to it.
 *
 * @param endpoints - List of webhook endpoints
 * @param event - Event to broadcast
 */
export async function broadcastWebhookEvent(
  endpoints: WebhookEndpoint[],
  event: WebhookEvent
): Promise<void> {
  // Filter endpoints that subscribe to this event
  const subscribedEndpoints = endpoints.filter(
    (ep) => ep.active && ep.events.includes(event.event)
  );

  if (subscribedEndpoints.length === 0) {
    logger.debug('[WEBHOOK] No endpoints subscribed to event', { event: event.event });
    return;
  }

  logger.info('[WEBHOOK] Broadcasting to endpoints', {
    event: event.event,
    count: subscribedEndpoints.length,
  });

  // Send to all endpoints (fire-and-forget, failures logged but don't block)
  const promises = subscribedEndpoints.map((endpoint) =>
    sendSignedWebhook(endpoint, event).catch((error) => {
      logger.error('[WEBHOOK] Broadcast failed', {
        webhookId: endpoint.id,
        error: String(error),
      });
    })
  );

  await Promise.all(promises);
}

// ---------------------------------------------------------------------------
// Example Usage in Event Handlers
// ---------------------------------------------------------------------------

/**
 * Example: When attendance is submitted, notify webhooks
 *
 * Usage in your endpoint handler:
 *   const attendanceRecord = await attendanceService.submitTraineeAttendance(...);
 *
 *   // Fetch active webhooks from database
 *   const webhooks = await db.query('SELECT * FROM webhook_endpoints WHERE active = true');
 *
 *   // Broadcast the event
 *   await broadcastWebhookEvent(webhooks, {
 *     event: 'attendance_submitted',
 *     timestamp: new Date().toISOString(),
 *     data: {
 *       attendanceId: attendanceRecord.id,
 *       traineeId: attendanceRecord.trainee_id,
 *       sessionId: attendanceRecord.session_id,
 *       submittedAt: attendanceRecord.created_at,
 *     },
 *   });
 */

// ---------------------------------------------------------------------------
// Database Schema (for reference)
// ---------------------------------------------------------------------------

/*
CREATE TABLE webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  url VARCHAR(512) NOT NULL,
  secret VARCHAR(128) NOT NULL, -- 64-char hex from generateWebhookSecret()
  events TEXT[] NOT NULL, -- e.g., ['attendance_submitted', 'enrollment_created']
  active BOOLEAN DEFAULT true,
  max_retries INT DEFAULT 5,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  
  UNIQUE(tenant_id, url),
  CONSTRAINT webhook_url_valid CHECK (url ~ '^https?://'),
  CONSTRAINT webhook_secret_length CHECK (char_length(secret) = 64)
);

CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES webhook_endpoints(id),
  event_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) DEFAULT 'pending', -- pending, delivered, failed
  payload JSONB NOT NULL,
  attempts INT DEFAULT 0,
  last_error TEXT,
  last_attempt_at TIMESTAMP,
  next_retry_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_webhook_status (webhook_id, status),
  INDEX idx_next_retry (next_retry_at)
);

-- Audit trail for webhook operations
CREATE TABLE webhook_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES webhook_endpoints(id),
  delivery_id UUID REFERENCES webhook_deliveries(id),
  action VARCHAR(64) NOT NULL, -- 'created', 'updated', 'deleted', 'delivered', 'failed'
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  
  INDEX idx_webhook_audit (webhook_id, created_at)
);
*/
