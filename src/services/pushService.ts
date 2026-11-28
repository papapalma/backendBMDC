/**
 * Web Push Notification Service
 *
 * Sends encrypted push notifications to registered PWA devices using the
 * Web Push Protocol (RFC 8030).
 *
 * Aligned to the live Supabase `push_subscriptions` schema:
 *   id, tenant_id, trainee_id, user_id, subscription (jsonb), created_at, updated_at
 *
 * Features:
 *   - Lazy VAPID initialization from Backend/.env
 *   - Automatic retry on transient failures (429, 5xx)
 *   - Deactivation of expired subscriptions (404/410 Gone, 401/403)
 *   - Tenant-scoped delivery matching either `user_id` or `trainee_id`
 */

import webpush from 'web-push';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface StoredSubscriptionPayload {
  endpoint: string;
  keys: {
    auth: string;
    p256dh: string;
  };
  deviceIdentifier?: string | null;
  userAgent?: string | null;
  isActive?: boolean;
  lastUsedAt?: string | null;
}

export interface PushSubscriptionRow {
  id: string;
  tenant_id: string;
  user_id?: string | null;
  trainee_id?: string | null;
  subscription: StoredSubscriptionPayload | Record<string, any> | null;
  created_at?: string;
  updated_at?: string;
}

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
// Initialization & Helpers
// ============================================================================

let vapidInitialized = false;

/**
 * Initialize web-push with VAPID keys from environment.
 * Safe to call repeatedly; lazily invoked before sending.
 */
export function initializePushService(): boolean {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

  if (!vapidPublicKey || !vapidPrivateKey) {
    logger.warn('[PUSH] VAPID keys not configured. Push notifications disabled.');
    return false;
  }

  webpush.setVapidDetails(
    `mailto:${process.env.SMTP_SENDER_EMAIL || 'noreply@bmdc.site'}`,
    vapidPublicKey,
    vapidPrivateKey
  );

  vapidInitialized = true;
  return true;
}

function ensurePushInitialized(): boolean {
  if (vapidInitialized) return true;
  return initializePushService();
}

/**
 * Get the VAPID public key to send to frontend for subscription
 */
export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/**
 * Normalize a JSONB `subscription` payload from `push_subscriptions`.
 */
export function parseStoredSubscription(
  raw: StoredSubscriptionPayload | Record<string, any> | null | undefined
): StoredSubscriptionPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint : '';
  const auth = typeof raw.keys?.auth === 'string' ? raw.keys.auth : '';
  const p256dh = typeof raw.keys?.p256dh === 'string' ? raw.keys.p256dh : '';
  if (!endpoint || !auth || !p256dh) return null;

  return {
    endpoint,
    keys: { auth, p256dh },
    deviceIdentifier: raw.deviceIdentifier ?? null,
    userAgent: raw.userAgent ?? null,
    isActive: raw.isActive !== false,
    lastUsedAt: raw.lastUsedAt ?? null,
  };
}

// ============================================================================
// Single Subscription Delivery
// ============================================================================

/**
 * Send a push notification to an already-loaded subscription row.
 */
async function deliverToSubscriptionRow(
  row: PushSubscriptionRow,
  payload: PushNotificationPayload,
  retryCount: number = 3
): Promise<PushDeliveryResult> {
  if (!ensurePushInitialized()) {
    return {
      success: false,
      subscriptionId: row.id,
      error: 'Push notifications not configured (missing VAPID keys)',
    };
  }

  const parsed = parseStoredSubscription(row.subscription);
  if (!parsed) {
    return {
      success: false,
      subscriptionId: row.id,
      error: 'Stored push subscription payload is malformed',
    };
  }

  if (parsed.isActive === false) {
    return {
      success: false,
      subscriptionId: row.id,
      endpoint: parsed.endpoint,
      error: 'Subscription is inactive',
    };
  }

  const notificationPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: payload.icon || '/icons/bmdc-logo-192x192.png',
    badge: payload.badge || '/icons/bmdc-logo-72x72.png',
    tag: payload.tag || 'notification',
    url: payload.url || '/',
    data: payload.data || {},
  });

  try {
    await webpush.sendNotification(
      { endpoint: parsed.endpoint, keys: parsed.keys },
      notificationPayload
    );

    const nowIso = new Date().toISOString();
    await supabaseAdmin
      .from('push_subscriptions')
      .update({
        subscription: { ...parsed, isActive: true, lastUsedAt: nowIso },
        updated_at: nowIso,
      })
      .eq('id', row.id);

    return {
      success: true,
      subscriptionId: row.id,
      endpoint: parsed.endpoint,
    };
  } catch (error: any) {
    const statusCode = error?.statusCode as number | undefined;

    if (statusCode === 410 || statusCode === 404 || statusCode === 401 || statusCode === 403) {
      const nowIso = new Date().toISOString();
      logger.info('[PUSH] Deactivating invalid/expired push subscription', {
        subscriptionId: row.id,
        statusCode,
      });
      await supabaseAdmin
        .from('push_subscriptions')
        .update({
          subscription: { ...parsed, isActive: false },
          updated_at: nowIso,
        })
        .eq('id', row.id);

      return {
        success: false,
        subscriptionId: row.id,
        endpoint: parsed.endpoint,
        statusCode,
        error: statusCode === 410 || statusCode === 404
          ? 'Subscription endpoint no longer valid'
          : 'Authentication failed',
      };
    }

    if ((statusCode === 429 || (statusCode && statusCode >= 500)) && retryCount > 0) {
      const delay = Math.pow(2, 3 - retryCount) * 1000;
      logger.info('[PUSH] Transient push failure, retrying', {
        subscriptionId: row.id,
        statusCode,
        delayMs: delay,
        retriesLeft: retryCount - 1,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
      return deliverToSubscriptionRow(row, payload, retryCount - 1);
    }

    logger.error('[PUSH] Failed to send notification', {
      subscriptionId: row.id,
      statusCode,
      error: error?.message,
    });

    return {
      success: false,
      subscriptionId: row.id,
      endpoint: parsed.endpoint,
      statusCode,
      error: error?.message || 'Failed to send push notification',
    };
  }
}

/**
 * Send a push notification to a single subscription by ID.
 */
export async function sendPushNotification(
  subscriptionId: string,
  payload: PushNotificationPayload,
  retryCount: number = 3
): Promise<PushDeliveryResult> {
  try {
    const { data: row, error: fetchError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, tenant_id, user_id, trainee_id, subscription, created_at, updated_at')
      .eq('id', subscriptionId)
      .maybeSingle();

    if (fetchError) {
      logger.error('[PUSH] Error fetching subscription', { error: fetchError, subscriptionId });
      return { success: false, subscriptionId, error: 'Failed to fetch subscription' };
    }

    if (!row) {
      return { success: false, subscriptionId, error: 'Subscription not found' };
    }

    return deliverToSubscriptionRow(row as PushSubscriptionRow, payload, retryCount);
  } catch (error: any) {
    logger.error('[PUSH] Unexpected error sending notification', { error: error?.message, subscriptionId });
    return { success: false, subscriptionId, error: error?.message || 'Unexpected error' };
  }
}

// ============================================================================
// Batch Delivery
// ============================================================================

function summarizeResults(results: PushDeliveryResult[]): BatchPushResult {
  return {
    sent: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success && r.statusCode !== 410 && r.statusCode !== 404).length,
    removed: results.filter((r) => r.statusCode === 410 || r.statusCode === 404).length,
    results,
  };
}

/**
 * Send a push notification to all active subscriptions belonging to a user or trainee.
 * Matches either `user_id` or `trainee_id` within the same tenant.
 */
export async function sendPushNotificationToUser(
  userOrTraineeId: string,
  tenantId: string,
  payload: PushNotificationPayload
): Promise<BatchPushResult> {
  try {
    const { data: rows, error: fetchError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, tenant_id, user_id, trainee_id, subscription, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .or(`user_id.eq.${userOrTraineeId},trainee_id.eq.${userOrTraineeId}`);

    if (fetchError) {
      logger.error('[PUSH] Error fetching user subscriptions', { error: fetchError, userOrTraineeId });
      return { sent: 0, failed: 0, removed: 0, results: [] };
    }

    const activeRows = ((rows || []) as PushSubscriptionRow[]).filter((row) => {
      const parsed = parseStoredSubscription(row.subscription);
      return Boolean(parsed && parsed.isActive !== false);
    });

    if (activeRows.length === 0) {
      return { sent: 0, failed: 0, removed: 0, results: [] };
    }

    const results = await Promise.all(
      activeRows.map((row) => deliverToSubscriptionRow(row, payload))
    );
    return summarizeResults(results);
  } catch (error: any) {
    logger.error('[PUSH] Batch delivery error', { error: error?.message, userOrTraineeId });
    return { sent: 0, failed: 0, removed: 0, results: [] };
  }
}

/**
 * Send a push notification to many trainees/users in one tenant in a single batched DB lookup.
 */
export async function sendPushNotificationToTargets(
  tenantId: string,
  targets: { userIds?: string[]; traineeIds?: string[] },
  payload: PushNotificationPayload
): Promise<BatchPushResult> {
  try {
    const userIds = Array.from(new Set((targets.userIds || []).filter(Boolean)));
    const traineeIds = Array.from(new Set((targets.traineeIds || []).filter(Boolean)));
    if (userIds.length === 0 && traineeIds.length === 0) {
      return { sent: 0, failed: 0, removed: 0, results: [] };
    }

    const matchedById = new Map<string, PushSubscriptionRow>();

    if (userIds.length > 0) {
      const { data: byUser, error: uErr } = await supabaseAdmin
        .from('push_subscriptions')
        .select('id, tenant_id, user_id, trainee_id, subscription, created_at, updated_at')
        .eq('tenant_id', tenantId)
        .in('user_id', userIds);
      if (uErr) {
        logger.error('[PUSH] Failed fetching subscriptions by user_id', { error: uErr, tenantId });
      } else {
        for (const r of (byUser || []) as PushSubscriptionRow[]) {
          matchedById.set(r.id, r);
        }
      }
    }

    if (traineeIds.length > 0) {
      const { data: byTrainee, error: tErr } = await supabaseAdmin
        .from('push_subscriptions')
        .select('id, tenant_id, user_id, trainee_id, subscription, created_at, updated_at')
        .eq('tenant_id', tenantId)
        .in('trainee_id', traineeIds);
      if (tErr) {
        logger.error('[PUSH] Failed fetching subscriptions by trainee_id', { error: tErr, tenantId });
      } else {
        for (const r of (byTrainee || []) as PushSubscriptionRow[]) {
          matchedById.set(r.id, r);
        }
      }
    }

    const activeRows = Array.from(matchedById.values()).filter((row) => {
      const parsed = parseStoredSubscription(row.subscription);
      return Boolean(parsed && parsed.isActive !== false);
    });

    if (activeRows.length === 0) {
      return { sent: 0, failed: 0, removed: 0, results: [] };
    }

    const results = await Promise.all(
      activeRows.map((row) => deliverToSubscriptionRow(row, payload))
    );
    return summarizeResults(results);
  } catch (error: any) {
    logger.error('[PUSH] Multi-target push delivery error', { error: error?.message, tenantId });
    return { sent: 0, failed: 0, removed: 0, results: [] };
  }
}

/**
 * Send a push notification to all users with a specific role in a tenant.
 */
export async function sendPushNotificationToRole(
  tenantId: string,
  role: string,
  payload: PushNotificationPayload
): Promise<BatchPushResult> {
  try {
    const { data: tenantUsers, error: fetchError } = await supabaseAdmin
      .from('users_tenants')
      .select('user_id, user:users!inner(id, role)')
      .eq('tenant_id', tenantId)
      .eq('user.role', role);

    if (fetchError) {
      logger.error('[PUSH] Error fetching users by role', { error: fetchError, tenantId, role });
      return { sent: 0, failed: 0, removed: 0, results: [] };
    }

    const userIds = (tenantUsers || []).map((r: any) => r.user_id).filter(Boolean);
    return sendPushNotificationToTargets(tenantId, { userIds }, payload);
  } catch (error: any) {
    logger.error('[PUSH] Role-based batch delivery error', { error: error?.message, tenantId, role });
    return { sent: 0, failed: 0, removed: 0, results: [] };
  }
}

/**
 * Cleanup expired/inactive subscriptions older than 7 days.
 */
export async function cleanupExpiredSubscriptions(tenantId?: string): Promise<number> {
  try {
    const cutoffIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    let query = supabaseAdmin
      .from('push_subscriptions')
      .select('id, subscription, updated_at')
      .lt('updated_at', cutoffIso);

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data: rows, error: fetchError } = await query;
    if (fetchError || !rows || rows.length === 0) return 0;

    const inactiveIds = rows
      .filter((r: any) => {
        const parsed = parseStoredSubscription(r.subscription);
        return !parsed || parsed.isActive === false;
      })
      .map((r: any) => r.id);

    if (inactiveIds.length === 0) return 0;

    const { error: deleteError } = await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .in('id', inactiveIds);

    if (deleteError) {
      logger.error('[PUSH] Error deleting inactive subscriptions', { error: deleteError });
      return 0;
    }

    return inactiveIds.length;
  } catch (error: any) {
    logger.error('[PUSH] Cleanup error', { error: error?.message });
    return 0;
  }
}
