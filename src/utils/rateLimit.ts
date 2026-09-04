/**
 * Simple in-process rate limiter.
 *
 * NOTE: This implementation uses an in-memory Map and is suitable for a
 * single-process deployment (local / single-server).  For multi-instance
 * deployments (Vercel edge, multiple pods) replace the Map with a shared
 * store such as Redis or Supabase.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number; // epoch ms
}

const store = new Map<string, RateLimitEntry>();

// Evict expired entries periodically to avoid unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}, 60_000); // every minute

export interface RateLimitOptions {
  /** Maximum requests allowed in the window */
  limit: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

/**
 * Check whether the given key has exceeded the rate limit.
 *
 * @returns `null` when the request is allowed, or a `Response` (429) when
 *          the limit has been exceeded.
 */
export function checkRateLimit(key: string, options: RateLimitOptions): Response | null {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + options.windowMs });
    return null;
  }

  entry.count += 1;

  if (entry.count > options.limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Too many requests. Please try again later.',
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter),
        },
      }
    );
  }

  return null;
}

/**
 * Extract a reasonable rate-limit key from a Next.js request.
 * Uses the x-forwarded-for header (set by Vercel / proxies) or the
 * x-real-ip header, falling back to a static string so it still works
 * locally without a reverse proxy.
 */
export function getRateLimitKey(request: Request, prefix: string): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const ip = forwarded?.split(',')[0].trim() ?? realIp ?? 'unknown';
  return `${prefix}:${ip}`;
}
