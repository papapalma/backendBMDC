import { supabaseAdmin } from '@/lib/supabase-admin';

export interface ResolvedTrainee {
  id: string;
  tenant_id: string | null;
  status: string | null;
}

/**
 * Resolve the canonical `trainees.id` for an authenticated request.
 *
 * - For `role === 'trainee'`, resolves strictly from the authenticated `userId`
 *   via `trainee_accounts` -> `trainees.user_id` (preventing ID spoofing and fixing
 *   clients that pass `users.id` instead of `trainees.id`), with a safe fallback to
 *   `providedTraineeId` only if `trainees.id` exists and is unlinked or owned by `userId`.
 * - For staff/admin roles calling on behalf of a trainee, looks up `providedTraineeId`.
 */
export async function resolveTraineeForUser(
  userId: string,
  role: string,
  providedTraineeId?: string
): Promise<ResolvedTrainee | null> {
  if (role === 'trainee') {
    // 1. Primary normalized mapping: trainee_accounts(user_id -> trainee_id)
    const accountQuery = supabaseAdmin.from('trainee_accounts');
    const accountRes = accountQuery
      ? await accountQuery.select('trainee_id').eq('user_id', userId).maybeSingle()
      : null;
    const accountLink = accountRes?.data;

    if (accountLink?.trainee_id) {
      const traineeQuery = supabaseAdmin.from('trainees');
      const traineeRes = traineeQuery
        ? await traineeQuery
            .select('id, tenant_id, status')
            .eq('id', accountLink.trainee_id)
            .is('deleted_at', null)
            .maybeSingle()
        : null;

      if (traineeRes?.data) return traineeRes.data as ResolvedTrainee;
    }

    // 2. Direct trainees.user_id link
    const traineeByUserQuery = supabaseAdmin.from('trainees');
    const traineeByUserRes = traineeByUserQuery
      ? await traineeByUserQuery
          .select('id, tenant_id, status')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .maybeSingle()
      : null;

    if (traineeByUserRes?.data) return traineeByUserRes.data as ResolvedTrainee;

    // 3. Fallback if a caller/test passed the actual trainees.id (never allow hijacking another user's trainee row)
    if (providedTraineeId) {
      const traineeByIdQuery = supabaseAdmin.from('trainees');
      const traineeByIdRes = traineeByIdQuery
        ? await traineeByIdQuery
            .select('id, tenant_id, status, user_id')
            .eq('id', providedTraineeId)
            .maybeSingle()
        : null;
      const traineeById = traineeByIdRes?.data;

      if (traineeById && (!traineeById.user_id || traineeById.user_id === userId)) {
        return {
          id: traineeById.id,
          tenant_id: traineeById.tenant_id,
          status: traineeById.status,
        };
      }
    }

    return null;
  }

  // Staff/admin caller: require an explicit trainee_id
  if (!providedTraineeId) return null;

  const staffTraineeQuery = supabaseAdmin.from('trainees');
  const staffTraineeRes = staffTraineeQuery
    ? await staffTraineeQuery
        .select('id, tenant_id, status')
        .eq('id', providedTraineeId)
        .maybeSingle()
    : null;

  return (staffTraineeRes?.data as ResolvedTrainee | null) ?? null;
}
