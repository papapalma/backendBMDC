/**
 * Task 19: Duplicate Submission Detection
 * 
 * Detects and prevents duplicate attendance submissions within a 5-second window
 * using idempotency keys.
 * 
 * Flow:
 * 1. Client provides idempotency_key with submission
 * 2. Check if key exists in submission_idempotency_keys
 * 3. If exists and within 5 seconds → return cached record (409 Conflict)
 * 4. If exists but outside 5-second window → allow new submission
 * 5. If not exists → create new record
 * 
 * Ponytail: Simple timestamp comparison, not distributed dedup.
 * Upgrade path: Distributed cache (Redis) for multi-instance deployments.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';

const DUPLICATE_WINDOW_SECONDS = 5;

export interface CheckDuplicateResult {
  isDuplicate: boolean;
  cachedRecordId?: string;
  reason?: string;
}

/**
 * Check if a submission is a duplicate within the 5-second window.
 * 
 * @param idempotencyKey - UUID key provided by client
 * @param traineeId - trainee submitting
 * @param sessionId - session being submitted to
 * @returns { isDuplicate, cachedRecordId?, reason? }
 */
export async function checkDuplicateSubmission(
  idempotencyKey: string,
  traineeId: string,
  sessionId: string
): Promise<CheckDuplicateResult> {
  // Look up existing submission with this key
  const { data: existing, error } = await supabaseAdmin
    .from('submission_idempotency_keys')
    .select('record_id, created_at')
    .eq('key', idempotencyKey)
    .maybeSingle();

  if (error) {
    // Log error but don't fail submission
    console.error('[duplicate-detection] Query error:', error);
    return { isDuplicate: false };
  }

  if (!existing) {
    // First submission with this key
    return { isDuplicate: false };
  }

  // Calculate time difference
  const createdTime = new Date(existing.created_at).getTime();
  const now = Date.now();
  const diffSeconds = (now - createdTime) / 1000;

  // If within 5-second window, it's a duplicate
  if (diffSeconds < DUPLICATE_WINDOW_SECONDS) {
    return {
      isDuplicate: true,
      cachedRecordId: existing.record_id,
      reason: `Duplicate submission detected (submitted ${Math.round(diffSeconds)}s ago)`,
    };
  }

  // Outside window, allow new submission
  return { isDuplicate: false };
}

/**
 * Record a new submission in the idempotency table.
 * 
 * @param idempotencyKey - UUID key
 * @param traineeId - trainee submitting
 * @param sessionId - session
 * @param recordId - resulting attendance record ID
 */
export async function recordSubmission(
  idempotencyKey: string,
  traineeId: string,
  sessionId: string,
  recordId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('submission_idempotency_keys')
    .insert({
      key: idempotencyKey,
      trainee_id: traineeId,
      session_id: sessionId,
      record_id: recordId,
      created_at: new Date().toISOString(),
    });

  if (error) {
    // Log but don't fail - submission already succeeded
    console.error('[duplicate-detection] Record insertion error:', error);
  }
}

/**
 * Clean up old idempotency keys (retention policy).
 * Removes entries older than 24 hours.
 * 
 * Call this periodically (e.g., daily cron job).
 */
export async function cleanupOldIdempotencyKeys(
  olderThanHours: number = 24
): Promise<number> {
  const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);

  const { data, error } = await supabaseAdmin
    .from('submission_idempotency_keys')
    .delete()
    .lt('created_at', cutoffTime.toISOString())
    .select('*'); // Return deleted records to count

  if (error) {
    console.error('[duplicate-detection] Cleanup error:', error);
    return 0;
  }

  const deletedCount = data?.length ?? 0;
  console.log(`[duplicate-detection] Cleaned up ${deletedCount} old idempotency keys`);

  return deletedCount;
}
