/**
 * Tenant-Scoped In-Memory Cache
 *
 * Implements Requirements 19.4, 19.5, 19.6:
 *   - 19.4  Cache frequently accessed tenant-specific data
 *   - 19.5  Cache tenant configuration for 15 minutes
 *   - 19.6  Cache aggregated reports for 1 hour
 *
 * Uses tenant-scoped cache keys in the format:
 *   tenant:{tenant_id}:{key}
 *
 * This is a lightweight in-process cache suitable for single-instance
 * deployments. For multi-instance deployments, replace the Map with a
 * Redis client (the interface is identical).
 *
 * TTL constants (Req 19.5, 19.6):
 *   - Tenant configuration: 15 minutes
 *   - Feature flags:        5 minutes  (defined in featureFlags.ts)
 *   - Aggregated reports:   1 hour
 *   - General query cache:  5 minutes
 */

import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// TTL constants (milliseconds)
// ---------------------------------------------------------------------------

export const TTL = {
  /** Tenant configuration (branding, settings) — 15 minutes (Req 19.5) */
  TENANT_CONFIG: 15 * 60 * 1000,
  /** Aggregated cross-tenant reports — 1 hour (Req 19.6) */
  AGGREGATED_REPORT: 60 * 60 * 1000,
  /** General tenant-scoped query results — 5 minutes (Req 19.4) */
  QUERY: 5 * 60 * 1000,
  /** Feature flags — 5 minutes (Req 23.3, defined here for reference) */
  FEATURE_FLAG: 5 * 60 * 1000,
} as const;

// ---------------------------------------------------------------------------
// Cache entry
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  /** ISO timestamp when this entry was created (for monitoring) */
  createdAt: string;
  /** Number of times this entry has been read (for hit-rate monitoring) */
  hits: number;
}

// ---------------------------------------------------------------------------
// Cache store
// ---------------------------------------------------------------------------

const store = new Map<string, CacheEntry<unknown>>();

/** Total cache hits since process start */
let totalHits = 0;
/** Total cache misses since process start */
let totalMisses = 0;

// Evict expired entries every 2 minutes to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  let evicted = 0;
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
      evicted++;
    }
  }

if (evicted > 0) {
    logger.debug('[CACHE] Evicted expired entries', { evicted, remaining: store.size });
  }
}, 2 * 60 * 1000);

// ---------------------------------------------------------------------------
// Key builders
// ---------------------------------------------------------------------------

/**
 * Build a tenant-scoped cache key.
 * Format: `tenant:{tenant_id}:{key}`
 */
export function tenantCacheKey(tenantId: string, key: string): string {
  return `tenant:${tenantId}:${key}`;
}

/**
 * Build a platform-level (cross-tenant) cache key.
 * Format: `platform:{key}`
 */
export function platformCacheKey(key: string): string {
  return `platform:${key}`;
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/**
 * Get a cached value. Returns `undefined` on miss or expiry.
 */
export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) {
    totalMisses++;
    return undefined;
  }

if (Date.now() > entry.expiresAt) {
    store.delete(key);
    totalMisses++;
    return undefined;
  }
  entry.hits++;
  totalHits++;
  return entry.value;
}

/**
 * Set a cached value with a TTL in milliseconds.
 */
export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    createdAt: new Date().toISOString(),
    hits: 0,
  });
}

/**
 * Delete a specific cache entry.
 */
export function cacheDelete(key: string): void {
  store.delete(key);
}

/**
 * Delete all cache entries matching a prefix.
 * Useful for invalidating all entries for a specific tenant.
 */
export function cacheDeleteByPrefix(prefix: string): void {
  let deleted = 0;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      deleted++;
    }
  }

if (deleted > 0) {
    logger.debug('[CACHE] Invalidated entries by prefix', { prefix, deleted });
  }
}

/**
 * Invalidate all cache entries for a specific tenant.
 */
export function invalidateTenantCache(tenantId: string): void {
  cacheDeleteByPrefix(tenantCacheKey(tenantId, ''));
}

/**
 * Clear the entire cache (useful for testing or emergency invalidation).
 */
export function cacheClear(): void {
  store.clear();
  logger.info('[CACHE] Cache cleared');
}

// ---------------------------------------------------------------------------
// Cache-aside helper
// ---------------------------------------------------------------------------

/**
 * Get-or-set pattern: return cached value if present, otherwise call
 * `fetcher`, cache the result, and return it.
 *
 * @example
 * ```ts
 * const config = await cacheGetOrSet(
 *   tenantCacheKey(tenantId, 'config'),
 *   TTL.TENANT_CONFIG,
 *   () => tenantConfigurationService.getConfiguration(tenantId)
 * );
 * ```
 */
export async function cacheGetOrSet<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = cacheGet<T>(key);
  if (cached !== undefined) {
    return cached;
  }

const value = await fetcher();
  cacheSet(key, value, ttlMs);
  return value;
}

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

export interface CacheStats {
  /** Total number of entries currently in the cache */
  size: number;
  /** Total cache hits since process start */
  totalHits: number;
  /** Total cache misses since process start */
  totalMisses: number;
  /** Hit rate as a percentage (0–100) */
  hitRate: number;
  /** Per-entry details for the top 50 most-accessed entries */
  topEntries: Array<{
    key: string;
    hits: number;
    expiresAt: string;
    createdAt: string;
  }>;
}

/**
 * Return cache statistics for the performance monitoring dashboard.
 */
export function getCacheStats(): CacheStats {
  const total = totalHits + totalMisses;
  const hitRate = total === 0 ? 0 : Math.round((totalHits / total) * 100);

  const entries = Array.from(store.entries())
    .map(([key, entry]) => ({
      key,
      hits: entry.hits,
      expiresAt: new Date(entry.expiresAt).toISOString(),
      createdAt: entry.createdAt,
    }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 50);

  return {
    size: store.size,
    totalHits,
    totalMisses,
    hitRate,
    topEntries: entries,
  };
}
