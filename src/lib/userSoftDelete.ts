import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';

const CACHE_TTL_MS = 5_000;

interface CachedUserStatus {
  deleted: boolean;
  expiresAt: number;
}

const userSoftDeleteCache = new Map<string, CachedUserStatus>();

/**
 * Detect Postgres / PostgREST errors caused by querying `users.deleted_at`
 * before migration 017-user-soft-delete has been applied.
 */
export function isMissingDeletedAtColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string };
  return (
    err.code === '42703' ||
    err.code === 'PGRST204' ||
    Boolean(err.message && err.message.includes('deleted_at'))
  );
}

/**
 * Mark a user as soft-deleted in the local TTL cache for immediate session cutoff.
 */
export function markUserSoftDeleted(userId: string): void {
  if (!userId) return;
  userSoftDeleteCache.set(userId, {
    deleted: true,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Evict cached status for a user (e.g. immediately after restore).
 */
export function clearUserSoftDeleted(userId: string): void {
  if (!userId) return;
  userSoftDeleteCache.delete(userId);
}

/**
 * Test helper to clear all cached soft-delete entries.
 */
export function resetUserSoftDeleteCache(): void {
  userSoftDeleteCache.clear();
}

/**
 * Returns true strictly when the user is confirmed soft-deleted (`deleted_at IS NOT NULL`).
 * Degrades safely (returns false) if migration 017 has not been applied yet or if a unit
 * test mock does not implement the `users` lookup.
 */
export async function isUserSoftDeleted(userId: string): Promise<boolean> {
  if (!userId) return false;

  const now = Date.now();
  const cached = userSoftDeleteCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return cached.deleted;
  }

  try {
    const query = supabaseAdmin?.from?.('users');
    if (!query || typeof query.select !== 'function') {
      return false;
    }

    const { data, error } = await query
      .select('deleted_at')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      if (!isMissingDeletedAtColumnError(error)) {
        logger.debug('[USER_SOFT_DELETE] Skipping status check due to query error', {
          userId,
          code: (error as { code?: string }).code,
        });
      }
      return false;
    }

    const deleted = Boolean(data?.deleted_at);
    if (data) {
      userSoftDeleteCache.set(userId, { deleted, expiresAt: now + CACHE_TTL_MS });
    }
    return deleted;
  } catch {
    return false;
  }
}
