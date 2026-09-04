/**
 * Performance Monitoring API
 *
 * Implements Requirement 19.8, 19.9:
 *   - 19.8  Monitor query performance and log slow queries exceeding 1 second
 *   - 19.9  Provide a performance dashboard showing query execution times and cache hit rates
 *
 * GET /api/admin/performance
 *   Returns cache stats, connection pool metrics, slow query log, and
 *   API response time percentiles.
 *   Restricted to Super Admin role only.
 *
 * DELETE /api/admin/performance/cache
 *   Clears the in-memory cache (emergency invalidation).
 *   Restricted to Super Admin role only.
 */

import { NextRequest } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, forbiddenResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { getCacheStats, cacheClear } from '@/lib/cache';
import {
  getPoolMetrics,
  checkPoolHealth,
  getSlowQueryLog,
  resetPoolMetrics,
  DEFAULT_POOL_CONFIG,
  SLOW_QUERY_THRESHOLD_MS,
} from '@/lib/connectionPool';
import { logSecurityEvent, AuditAction } from '@/lib/auditLog';

// ---------------------------------------------------------------------------
// In-process API response time tracking
// ---------------------------------------------------------------------------

interface ResponseTimeSample {
  endpoint: string;
  method: string;
  durationMs: number;
  statusCode: number;
  timestamp: string;
  tenantId?: string;
}

const responseTimeSamples: ResponseTimeSample[] = [];
const MAX_SAMPLES = 500;

export function recordApiResponseTime(sample: Omit<ResponseTimeSample, 'timestamp'>): void {
  responseTimeSamples.unshift({ ...sample, timestamp: new Date().toISOString() });
  if (responseTimeSamples.length > MAX_SAMPLES) {
    responseTimeSamples.pop();
  }
}

function computePercentiles(values: number[]): { p50: number; p95: number; p99: number } {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const p = (pct: number) => sorted[Math.floor((pct / 100) * sorted.length)] ?? 0;
  return { p50: p(50), p95: p(95), p99: p(99) };
}

// ---------------------------------------------------------------------------
// OPTIONS
// ---------------------------------------------------------------------------

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// ---------------------------------------------------------------------------
// GET /api/admin/performance
// ---------------------------------------------------------------------------

export const GET = withErrorHandler(async (request: NextRequest) => {
  const tenantResult = requireTenantContext(request);
  if (tenantResult.error) return tenantResult.error;
  const { context } = tenantResult;

  // Super Admin only
  if (!context.isSuperAdmin) {
    return forbiddenResponse('Super Admin access required');
  }

  const cacheStats = getCacheStats();
  const poolMetrics = getPoolMetrics();
  const poolHealth = checkPoolHealth();
  const slowQueries = getSlowQueryLog();

  // Compute API response time percentiles from recent samples
  const durations = responseTimeSamples.map(s => s.durationMs);
  const percentiles = computePercentiles(durations);

  // Active users per tenant (from recent response time samples)
  const tenantActivity: Record<string, number> = {};
  for (const sample of responseTimeSamples) {
    if (sample.tenantId) {
      tenantActivity[sample.tenantId] = (tenantActivity[sample.tenantId] ?? 0) + 1;
    }
  }

  const activeUsersByTenant = Object.entries(tenantActivity)
    .map(([tenantId, requestCount]) => ({ tenantId, requestCount }))
    .sort((a, b) => b.requestCount - a.requestCount)
    .slice(0, 20);

  await logSecurityEvent({
    userId: context.userId,
    action: AuditAction.SECURITY_SUSPICIOUS,
    entityType: 'system',
    details: { event: 'performance_dashboard_viewed' },
    request,
  });

  return successResponse({
    generatedAt: new Date().toISOString(),
    cache: {
      size: cacheStats.size,
      totalHits: cacheStats.totalHits,
      totalMisses: cacheStats.totalMisses,
      hitRate: cacheStats.hitRate,
      topEntries: cacheStats.topEntries.slice(0, 20),
    },
    connectionPool: {
      config: DEFAULT_POOL_CONFIG,
      metrics: poolMetrics,
      health: poolHealth,
    },
    queryPerformance: {
      slowQueryThresholdMs: SLOW_QUERY_THRESHOLD_MS,
      slowQueryCount: slowQueries.length,
      recentSlowQueries: slowQueries.slice(0, 20),
    },
    apiResponseTimes: {
      sampleCount: responseTimeSamples.length,
      percentiles,
      recentSamples: responseTimeSamples.slice(0, 20),
    },
    activeUsersByTenant,
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/performance/cache  (emergency cache clear)
// ---------------------------------------------------------------------------

export const DELETE = withErrorHandler(async (request: NextRequest) => {
  const tenantResult = requireTenantContext(request);
  if (tenantResult.error) return tenantResult.error;
  const { context } = tenantResult;

  if (!context.isSuperAdmin) {
    return forbiddenResponse('Super Admin access required');
  }

  cacheClear();
  resetPoolMetrics();

  await logSecurityEvent({
    userId: context.userId,
    action: AuditAction.CONFIG_FEATURE_FLAG,
    entityType: 'system',
    details: { event: 'cache_cleared' },
    request,
  });

  return successResponse({ message: 'Cache cleared and pool metrics reset' });
});
