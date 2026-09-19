/**
 * Shared utility functions for requirement-definitions endpoints
 */

import { supabaseAdmin } from '@/lib/supabase-admin';

export interface SubmissionStats {
  total_trainees: number;
  pending_count: number;
  submitted_count: number;
  verified_count: number;
  rejected_count: number;
  waived_count: number;
  completion_rate: number;
}

/**
 * Calculate submission statistics for a requirement across all trainees
 * in an enrollment.
 */
export async function calculateSubmissionStats(
  requirementId: string,
  tenantId: string
): Promise<SubmissionStats> {
  // Query enrollment_requirements table to get submission counts
  // For now, since the table might not exist yet, we'll return zero stats
  // In a production implementation, this would query the actual table

  // Once enrollment_requirements table exists (Task 13), this query will be:
  /*
  const { data, error } = await supabaseAdmin
    .from('enrollment_requirements')
    .select('submission_status', { count: 'exact' })
    .eq('requirement_id', requirementId)
    .eq('tenant_id', tenantId)
    .eq('is_applicable', true);

  if (error) throw error;

  const stats = {
    total_trainees: 0,
    pending_count: 0,
    submitted_count: 0,
    verified_count: 0,
    rejected_count: 0,
    waived_count: 0,
  };

  data?.forEach((item: any) => {
    stats.total_trainees++;
    switch (item.submission_status) {
      case 'pending':
        stats.pending_count++;
        break;
      case 'submitted':
        stats.submitted_count++;
        break;
      case 'verified':
        stats.verified_count++;
        break;
      case 'rejected':
        stats.rejected_count++;
        break;
      case 'waived':
        stats.waived_count++;
        break;
    }
  });
  */

  // For now, return empty stats as enrollment_requirements doesn't exist yet
  const stats = {
    total_trainees: 0,
    pending_count: 0,
    submitted_count: 0,
    verified_count: 0,
    rejected_count: 0,
    waived_count: 0,
  };

  const completion_rate =
    stats.total_trainees === 0
      ? 0
      : ((stats.verified_count + stats.waived_count) / stats.total_trainees) * 100;

  return {
    ...stats,
    completion_rate: Math.round(completion_rate * 100) / 100, // Round to 2 decimals
  };
}

/**
 * Apply sorting to requirement definitions
 */
export function applySorting(
  definitions: any[],
  sortBy: 'name' | 'mandatory' | 'completion_rate'
): any[] {
  const sorted = [...definitions];

  switch (sortBy) {
    case 'name':
      sorted.sort((a, b) => a.display_name.localeCompare(b.display_name));
      break;
    case 'mandatory':
      sorted.sort((a, b) => {
        // Sort mandatory first, then optional
        if (a.is_mandatory === b.is_mandatory) {
          return a.display_name.localeCompare(b.display_name);
        }
        return a.is_mandatory ? -1 : 1;
      });
      break;
    case 'completion_rate':
      sorted.sort((a, b) => {
        const rateA = a.submission_stats.completion_rate;
        const rateB = b.submission_stats.completion_rate;
        return rateB - rateA; // Descending order
      });
      break;
  }

  return sorted;
}
