/**
 * Feature Flag Utility
 *
 * Implements Requirements 23.1, 23.2, 23.3:
 *   - 23.1  Create and manage feature flags per tenant
 *   - 23.2  Store feature configuration in JSONB column
 *   - 23.3  isFeatureEnabled(tenantId, featureKey) with 5-minute cache
 *
 * Known feature keys (must match full_schema.sql documentation):
 *   inventory_management   — inventory tracking module
 *   certificate_generation — PDF certificate generation
 *   qr_code_attendance     — QR code-based attendance
 *   mobile_app_access      — trainee mobile app access
 *   whatsapp_notifications — WhatsApp Business API notifications
 *   email_notifications    — SMTP email notifications
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Known feature keys (Req 23.1)
// ---------------------------------------------------------------------------

export const FeatureKey = {
  INVENTORY_MANAGEMENT:      'inventory_management',
  CERTIFICATE_GENERATION:    'certificate_generation',
  QR_CODE_ATTENDANCE:        'qr_code_attendance',
  MOBILE_APP_ACCESS:         'mobile_app_access',
  WHATSAPP_NOTIFICATIONS:    'whatsapp_notifications',
  EMAIL_NOTIFICATIONS:       'email_notifications',
  SOCIAL_PROGRAM_SHARING:    'social_program_sharing',
} as const;

export type FeatureKeyType = typeof FeatureKey[keyof typeof FeatureKey];

// ---------------------------------------------------------------------------
// In-memory cache (Req 23.3 — 5-minute TTL)
// ---------------------------------------------------------------------------

interface CacheEntry {
  enabled: boolean;
  configuration: Record<string, unknown> | null;
  expiresAt: number;
}

/** Cache TTL: 5 minutes in milliseconds (Req 23.3) */
const CACHE_TTL_MS = 5 * 60 * 1000;

const flagCache = new Map<string, CacheEntry>();

function cacheKey(tenantId: string, featureKey: string): string {
  return `${tenantId}:${featureKey}`;
}

function getCached(tenantId: string, featureKey: string): CacheEntry | null {
  const entry = flagCache.get(cacheKey(tenantId, featureKey));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    flagCache.delete(cacheKey(tenantId, featureKey));
    return null;
  }
  return entry;
}

function setCached(
  tenantId: string,
  featureKey: string,
  enabled: boolean,
  configuration: Record<string, unknown> | null
): void {
  flagCache.set(cacheKey(tenantId, featureKey), {
    enabled,
    configuration,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Invalidate the cache for a specific tenant + feature key.
 * Call this after creating, updating, or deleting a feature flag.
 */
export function invalidateFeatureFlagCache(tenantId: string, featureKey?: string): void {
  if (featureKey) {
    flagCache.delete(cacheKey(tenantId, featureKey));
  } else {
    // Invalidate all flags for this tenant
    for (const key of flagCache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        flagCache.delete(key);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Core utility function (Req 23.3)
// ---------------------------------------------------------------------------

/**
 * Check whether a feature is enabled for a given tenant.
 *
 * Results are cached for 5 minutes to reduce database load (Req 23.3).
 * If the feature flag row does not exist, the feature is considered disabled.
 *
 * @param tenantId   - UUID of the tenant
 * @param featureKey - Feature key string (use FeatureKey constants)
 * @returns true if the feature is enabled, false otherwise
 */
export async function isFeatureEnabled(
  tenantId: string,
  featureKey: string
): Promise<boolean> {
  // Check cache first (Req 23.3)

const cached = getCached(tenantId, featureKey);
  if (cached !== null) {
    return cached.enabled;
  }

  // Query database
  try {
    const { data, error } = await supabaseAdmin
      .from('feature_flags')
      .select('enabled, configuration')
      .eq('tenant_id', tenantId)
      .eq('feature_key', featureKey)
      .maybeSingle();

    if (error) {
      logger.warn('[FEATURE_FLAGS] Failed to query feature flag', {
        tenantId,
        featureKey,
        error: error.message,
      });
      // Fail open — if we can't check, allow the feature
      return true;
    }

const enabled = data?.enabled ?? false;
    const configuration = (data?.configuration as Record<string, unknown>) ?? null;

    // Cache the result
    setCached(tenantId, featureKey, enabled, configuration);

    return enabled;
  } catch (err) {
    logger.warn('[FEATURE_FLAGS] Unexpected error checking feature flag', {
      tenantId,
      featureKey,
      err,
    });
    // Fail open

return true;
  }
}

/**
 * Get the configuration JSONB for a feature flag.
 * Returns null if the flag doesn't exist or has no configuration.
 */
export async function getFeatureFlagConfig(
  tenantId: string,
  featureKey: string
): Promise<Record<string, unknown> | null> {
  const cached = getCached(tenantId, featureKey);
  if (cached !== null) {
    return cached.configuration;
  }

const { data } = await supabaseAdmin
    .from('feature_flags')
    .select('enabled, configuration')
    .eq('tenant_id', tenantId)
    .eq('feature_key', featureKey)
    .maybeSingle();

  const enabled = data?.enabled ?? false;
  const configuration = (data?.configuration as Record<string, unknown>) ?? null;
  setCached(tenantId, featureKey, enabled, configuration);

  return configuration;
}

/**
 * Require a feature to be enabled, returning a 403 response if not.
 *
 * Usage in route handlers:
 * ```ts
 * const featureCheck = await requireFeature(tenantId, FeatureKey.CERTIFICATE_GENERATION);
 * if (featureCheck) return featureCheck; // 403 response
 * ```
 *
 * @returns null if feature is enabled, or a 403 Response if disabled (Req 23.3)
 */
export async function requireFeature(
  tenantId: string,
  featureKey: string
): Promise<Response | null> {
  const enabled = await isFeatureEnabled(tenantId, featureKey);
  if (!enabled) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `Feature "${featureKey}" is not enabled for this tenant`,
        feature_key: featureKey,
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
  return null;
}
