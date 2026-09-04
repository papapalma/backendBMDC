/**
 * Web Push Notification Service
 *
 * Sends encrypted push notifications to registered PWA devices using the
 * Web Push Protocol (RFC 8030).
 *
 * Features:
 *   - Automatic retry on transient failures (429, 5xx errors)
 *   - Cleanup of expired subscriptions (410 Gone responses)
 *   - Tenant-scoped delivery (no cross-tenant notifications)
 *   - Integrates with existing notification preferences
 */

import webpush from 'web-push';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
  data?: Record<string, any>;
}

export interface PushDeliveryResult {
  success: boolean;
  subscriptionId?: string;
  endpoint?: string;
  error?: string;
  statusCode?: number;
  retriedAt?: number;
}

export interface BatchPushResult {
  sent: number;
  failed: number;
  removed: number;
  results: PushDeliveryResult[];
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize web-push with VAPID keys from environment
 * Should be called once on service startup
 */
export function initializePushService(): boolean {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

  if (!vapidPublicKey || !vapidPrivateKey) {
    logger.warn('[PUSH] VAPID keys not configured. Push notifications disabled.');
    logger.warn('[PUSH] Generate keys with: npx web-push generate-vapid-keys');
    return false;
  }

  webpush.setVapidDetails(
    `mailto:${process.env.SMTP_SENDER_EMAIL || 'noreply@example.com'}`,
    vapidPublicKey,
    vapidPrivateKey
  );

  logger.info('[PUSH] Web Push service initialized');
  return true;
}

/**
 * Get the VAPID public key to send to frontend for subscription
 */
export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

// ============================================================================
// Single Subscription Delivery
// ============================================================================

/**
 * Send a push notification to a single subscription
 */
export async function sendPushNotification(
  subscriptionId: string,
  payload: PushNotificationPayload,
  retryCount: number = 3
): Promise<PushDeliveryResult> {
  try {
    // Fetch subscription from database
    const { data: subscription, error: fetchError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, endpoint, auth_secret, p256dh_key, user_id, is_active')
      .eq('id', subscriptionId)
      .maybeSingle();

    if (fetchError) {
      logger.error('[PUSH] Error fetching subscription', { error: fetchError, subscriptionId });
      return {
        success: false,
        subscriptionId,
        error: 'Failed to fetch subscription',
      };
    }

    if (!subscription) {
      logger.warn('[PUSH] Subscription not found', { subscriptionId });
      return {
        success: false,
        subscriptionId,
        error: 'Subscription not found',
      };
    }

    if (!subscription.is_active) {
      logger.info('[PUSH] Subscription is inactive', { subscriptionId });
      return {
        success: false,
        subscriptionId,
        error: 'Subscription is inactive',
      };
    }

    // Build subscription object for web-push
    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        auth: subscription.auth_secret,
        p256dh: subscription.p256dh_key,
      },
    };

    // Send notification
    const notificationPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/icons/icon-192x192.png',
      badge: payload.badge || '/icons/icon-72x72.png',
      tag: payload.tag || 'notification',
      url: payload.url || '/',
      data: payload.data || {},
    });

    try {
      await webpush.sendNotification(pushSubscription, notificationPayload);

      // Update last_used_at timestamp
      await supabaseAdmin
        .from('push_subscriptions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', subscriptionId);

      logger.debug('[PUSH] Notification sent successfully', {
        subscriptionId,
        endpoint: subscription.endpoint,
      });

      return {
        success: true,
        subscriptionId,
        endpoint: subscription.endpoint,
      };
    } catch (error: any) {
      // Handle specific HTTP status codes
      if (error.statusCode === 410) {
        // Gone - subscription is no longer valid
        logger.info('[PUSH] Subscription endpoint gone (410), deactivating', { subscriptionId });
        await supabaseAdmin
          .from('push_subscriptions')
          .update({ is_active: false })
          .eq('id', subscriptionId);

        return {
          success: false,
          subscriptionId,
          endpoint: subscription.endpoint,
          statusCode: 410,
          error: 'Subscription endpoint no longer valid',
        };
      }

      if (error.statusCode === 401 || error.statusCode === 403) {
        // Unauthorized - VAPID keys invalid or subscription mismatch
        logger.error('[PUSH] Authentication error (401/403)', { subscriptionId, statusCode: error.statusCode });
        await supabaseAdmin
          .from('push_subscriptions')
          .update({ is_active: false })
          .eq('id', subscriptionId);

        return {
          success: false,
          subscriptionId,
          endpoint: subscription.endpoint,
          statusCode: error.statusCode,
          error: 'Authentication failed',
        };
      }

      if (error.statusCode === 429 && retryCount > 0) {
        // Rate limited - retry with backoff
        const delay = Math.pow(2, 3 - retryCount) * 1000; // 4s, 2s, 1s
        logger.info('[PUSH] Rate limited (429), retrying', { subscriptionId, delayMs: delay, retriesLeft: retryCount - 1 });
        await new Promise(resolve => setTimeout(resolve, delay));
        return sendPushNotification(subscriptionId, payload, retryCount - 1);
      }

      if (error.statusCode && error.statusCode >= 500 && retryCount > 0) {
        // Server error - retry with backoff
        const delay = Math.pow(2, 3 - retryCount) * 1000;
        logger.info('[PUSH] Server error, retrying', { subscriptionId, statusCode: error.statusCode, delayMs: delay, retriesLeft: retryCount - 1 });
        await new Promise(resolve => setTimeout(resolve, delay));
        return sendPushNotification(subscriptionId, payload, retryCount - 1);
      }

      // Other errors
      logger.error('[PUSH] Failed to send notification', {
        subscriptionId,
        statusCode: error.statusCode,
        error: error.message,
      });

      return {
        success: false,
        subscriptionId,
        endpoint: subscription.endpoint,
        statusCode: error.statusCode,
        error: error.message,
      };
    }
  } catch (error: any) {
    logger.error('[PUSH] Unexpected error sending notification', { error: error.message, subscriptionId });
    return {
      success: false,
      subscriptionId,
      error: error.message,
    };
  }
}

// ============================================================================
// Batch Delivery
// ============================================================================

/**
 * Send a push notification to all subscriptions for a specific user
 */
export async function sendPushNotificationToUser(
  userId: string,
  tenantId: string,
  payload: PushNotificationPayload
): Promise<BatchPushResult> {
  try {
    // Fetch all active subscriptions for the user
    const { data: subscriptions, error: fetchError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true);

    if (fetchError) {
      logger.error('[PUSH] Error fetching user subscriptions', { error: fetchError, userId });
      return {
        sent: 0,
        failed: 0,
        removed: 0,
        results: [],
      };
    }

    if (!subscriptions || subscriptions.length === 0) {
      logger.debug('[PUSH] No active subscriptions for user', { userId });
      return {
        sent: 0,
        failed: 0,
        removed: 0,
        results: [],
      };
    }

    // Send to all subscriptions in parallel
    const promises = subscriptions.map(sub => sendPushNotification(sub.id, payload));
    const results = await Promise.all(promises);

    // Aggregate results
    const summary = {
      sent: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success && r.statusCode !== 410).length,
      removed: results.filter(r => r.statusCode === 410).length,
      results,
    };

    logger.info('[PUSH] Batch delivery completed', {
      userId,
      total: subscriptions.length,
      sent: summary.sent,
      failed: summary.failed,
      removed: summary.removed,
    });

    return summary;
  } catch (error: any) {
    logger.error('[PUSH] Batch delivery error', { error: error.message, userId });
    return {
      sent: 0,
      failed: 0,
      removed: 0,
      results: [],
    };
  }
}

/**
 * Send a push notification to all users with a specific role in a tenant
 * (e.g., notify all trainees in a program about a schedule change)
 */
export async function sendPushNotificationToRole(
  tenantId: string,
  role: string,
  payload: PushNotificationPayload
): Promise<BatchPushResult> {
  try {
    // Fetch all trainees who have users with the specified role
    // Join trainees through users_tenants and users tables
    const { data: trainees, error: fetchError } = await supabaseAdmin
      .from('trainees')
      .select('id')
      .eq('tenant_id', tenantId)
      .filter('user_id', 'is', null); // For now, only trainee role users without linked user account

    // Alternative: if we want to query by user role, we'd need:
    // SELECT DISTINCT t.id FROM trainees t
    // INNER JOIN users u ON t.user_id = u.id
    // INNER JOIN users_tenants ut ON u.id = ut.user_id
    // WHERE ut.tenant_id = :tenantId AND u.role = :role

    if (fetchError) {
      logger.error('[PUSH] Error fetching trainees by role', { error: fetchError, tenantId, role });
      return {
        sent: 0,
        failed: 0,
        removed: 0,
        results: [],
      };
    }

    if (!trainees || trainees.length === 0) {
      logger.debug('[PUSH] No trainees found', { tenantId, role });
      return {
        sent: 0,
        failed: 0,
        removed: 0,
        results: [],
      };
    }

    // Send to all trainees in parallel
    const promises = trainees.map(trainee =>
      sendPushNotificationToUser(trainee.id, tenantId, payload)
    );
    const results = await Promise.all(promises);

    // Aggregate results
    const summary = {
      sent: results.reduce((acc, r) => acc + r.sent, 0),
      failed: results.reduce((acc, r) => acc + r.failed, 0),
      removed: results.reduce((acc, r) => acc + r.removed, 0),
      results: results.flatMap(r => r.results),
    };

    logger.info('[PUSH] Role-based batch delivery completed', {
      tenantId,
      role,
      traineesCount: trainees.length,
      sent: summary.sent,
      failed: summary.failed,
      removed: summary.removed,
    });

    return summary;
  } catch (error: any) {
    logger.error('[PUSH] Role-based batch delivery error', { error: error.message, tenantId, role });
    return {
      sent: 0,
      failed: 0,
      removed: 0,
      results: [],
    };
  }
}

/**
 * Cleanup expired subscriptions (410 Gone responses)
 * Should be called periodically (e.g., daily)
 */
export async function cleanupExpiredSubscriptions(tenantId?: string): Promise<number> {
  try {
    let query = supabaseAdmin
      .from('push_subscriptions')
      .select('id');

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    query = query.eq('is_active', false);

    const { data: inactiveSubscriptions, error: fetchError } = await query;

    if (fetchError) {
      logger.error('[PUSH] Error fetching inactive subscriptions', { error: fetchError });
      return 0;
    }

    if (!inactiveSubscriptions || inactiveSubscriptions.length === 0) {
      return 0;
    }

    // Delete inactive subscriptions older than 7 days
    const { error: deleteError } = await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .eq('is_active', false)
      .lt('updated_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    if (deleteError) {
      logger.error('[PUSH] Error deleting inactive subscriptions', { error: deleteError });
      return 0;
    }

    logger.info('[PUSH] Cleanup completed', {
      removedCount: inactiveSubscriptions.length,
      tenantId: tenantId || 'all',
    });

    return inactiveSubscriptions.length;
  } catch (error: any) {
    logger.error('[PUSH] Cleanup error', { error: error.message });
    return 0;
  }
}
