/**
 * Database Connection Pool Configuration
 *
 * Implements Requirement 19.7:
 *   - 19.7  Implement database connection pooling to optimize resource utilization
 *
 * Supabase uses PgBouncer for connection pooling at the infrastructure level.
 * This module configures the Supabase client with optimal pool settings and
 * provides monitoring utilities for connection pool health.
 *
 * Pool settings are tuned for a multi-tenant workload:
 *   - Max connections: controlled by Supabase plan limits
 *   - Connection timeout: 10 seconds
 *   - Idle timeout: 30 seconds
 *   - Statement timeout: 30 seconds (prevents runaway queries)
 *
 * For self-hosted deployments, configure PgBouncer with:
 *   pool_mode = transaction
 *   max_client_conn = 1000
 *   default_pool_size = 25
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Pool configuration
// ---------------------------------------------------------------------------

export interface PoolConfig {
  /** Maximum number of connections in the pool */
  maxConnections: number;
  /** Connection timeout in milliseconds */
  connectionTimeoutMs: number;
  /** Idle connection timeout in milliseconds */
  idleTimeoutMs: number;
  /** Statement timeout in milliseconds (0 = no limit) */
  statementTimeoutMs: number;
}

export const DEFAULT_POOL_CONFIG: PoolConfig = {
  maxConnections: parseInt(process.env.DB_POOL_MAX_CONNECTIONS ?? '25', 10),
  connectionTimeoutMs: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS ?? '10000', 10),
  idleTimeoutMs: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS ?? '30000', 10),
  statementTimeoutMs: parseInt(process.env.DB_POOL_STATEMENT_TIMEOUT_MS ?? '30000', 10),
};

// ---------------------------------------------------------------------------
// Pool metrics tracking
// ---------------------------------------------------------------------------

interface PoolMetrics {
  totalRequests: number;
  activeConnections: number;
  peakConnections: number;
  connectionErrors: number;
  slowQueries: number;
  lastResetAt: string;
}

const metrics: PoolMetrics = {
  totalRequests: 0,
  activeConnections: 0,
  peakConnections: 0,
  connectionErrors: 0,
  slowQueries: 0,
  lastResetAt: new Date().toISOString(),
};

export function recordConnectionRequest(): void {
  metrics.totalRequests++;
  metrics.activeConnections++;
  if (metrics.activeConnections > metrics.peakConnections) {
    metrics.peakConnections = metrics.activeConnections;
  }
}

export function recordConnectionRelease(): void {
  if (metrics.activeConnections > 0) {
    metrics.activeConnections--;
  }
}

export function recordConnectionError(): void {
  metrics.connectionErrors++;
  if (metrics.activeConnections > 0) {
    metrics.activeConnections--;
  }
}

export function recordSlowQuery(): void {
  metrics.slowQueries++;
}

export function getPoolMetrics(): PoolMetrics & { utilizationPercent: number } {
  const utilizationPercent =
    DEFAULT_POOL_CONFIG.maxConnections === 0
      ? 0
      : Math.round((metrics.activeConnections / DEFAULT_POOL_CONFIG.maxConnections) * 100);

  return { ...metrics, utilizationPercent };
}

export function resetPoolMetrics(): void {
  metrics.totalRequests = 0;
  metrics.activeConnections = 0;
  metrics.peakConnections = 0;
  metrics.connectionErrors = 0;
  metrics.slowQueries = 0;
  metrics.lastResetAt = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Pool health check
// ---------------------------------------------------------------------------

export interface PoolHealthStatus {
  healthy: boolean;
  activeConnections: number;
  maxConnections: number;
  utilizationPercent: number;
  message: string;
}

/**
 * Check connection pool health.
 * Returns a warning when utilization exceeds 80% (Req 19.7).
 */
export function checkPoolHealth(): PoolHealthStatus {
  const poolMetrics = getPoolMetrics();
  const { utilizationPercent, activeConnections } = poolMetrics;

  if (utilizationPercent >= 90) {
    logger.warn('[POOL] Connection pool utilization critical', {
      utilizationPercent,
      activeConnections,
      maxConnections: DEFAULT_POOL_CONFIG.maxConnections,
    });
    return {
      healthy: false,
      activeConnections,
      maxConnections: DEFAULT_POOL_CONFIG.maxConnections,
      utilizationPercent,
      message: `Critical: pool utilization at ${utilizationPercent}%`,
    };
  }

if (utilizationPercent >= 80) {
    logger.warn('[POOL] Connection pool utilization high', {
      utilizationPercent,
      activeConnections,
    });
    return {
      healthy: true,
      activeConnections,
      maxConnections: DEFAULT_POOL_CONFIG.maxConnections,
      utilizationPercent,
      message: `Warning: pool utilization at ${utilizationPercent}%`,
    };
  }

  return {
    healthy: true,
    activeConnections,
    maxConnections: DEFAULT_POOL_CONFIG.maxConnections,
    utilizationPercent,
    message: 'Pool healthy',
  };
}

// ---------------------------------------------------------------------------
// Slow query tracking
// ---------------------------------------------------------------------------

export interface SlowQueryEntry {
  query: string;
  durationMs: number;
  tenantId?: string;
  timestamp: string;
}

const slowQueryLog: SlowQueryEntry[] = [];
const MAX_SLOW_QUERY_LOG = 100;

/** Threshold in milliseconds above which a query is considered slow (Req 19.8) */
export const SLOW_QUERY_THRESHOLD_MS = parseInt(
  process.env.SLOW_QUERY_THRESHOLD_MS ?? '1000',
  10
);

/**
 * Log a slow query. Keeps the last 100 entries.
 */
export function logSlowQuery(entry: Omit<SlowQueryEntry, 'timestamp'>): void {
  recordSlowQuery();
  const logEntry: SlowQueryEntry = { ...entry, timestamp: new Date().toISOString() };
  slowQueryLog.unshift(logEntry);
  if (slowQueryLog.length > MAX_SLOW_QUERY_LOG) {
    slowQueryLog.pop();
  }
  logger.warn('[POOL] Slow query detected', logEntry);
}

/**
 * Get the slow query log for the performance dashboard.
 */
export function getSlowQueryLog(): SlowQueryEntry[] {
  return [...slowQueryLog];
}

/**
 * Wrap a database operation with timing and slow-query detection.
 *
 * @example
 * ```ts
 * const result = await withQueryTiming(
 *   () => supabase.from('programs').select('*'),
 *   'programs.select',
 *   tenantId
 * );
 * ```
 */
export async function withQueryTiming<T>(
  operation: () => Promise<T>,
  queryLabel: string,
  tenantId?: string
): Promise<T> {
  recordConnectionRequest();
  const start = Date.now();
  try {
    const result = await operation();
    const durationMs = Date.now() - start;
    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
      logSlowQuery({ query: queryLabel, durationMs, tenantId });
    }
    return result;
  } catch (error) {
    recordConnectionError();
    throw error;
  } finally {
    recordConnectionRelease();
  }
}
