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
  const { data: definition, error: definitionError } = await supabaseAdmin
    .from('requirement_definitions')
    .select('requirement_type')
    .eq('id', requirementId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .single();

  if (definitionError) {
    throw definitionError;
  }

  const { data: enrollmentRequirements, error: enrollmentError } = await supabaseAdmin
    .from('enrollment_requirements')
    .select('submission_status,enrollment_id')
    .eq('requirement_id', requirementId)
    .eq('tenant_id', tenantId)
    .eq('is_applicable', true);

  if (enrollmentError) {
    throw enrollmentError;
  }

  const enrollmentIds = (enrollmentRequirements || [])
    .map((item: { enrollment_id?: string }) => item.enrollment_id)
    .filter((enrollmentId): enrollmentId is string => Boolean(enrollmentId));

  const traineeByEnrollment = new Map<string, string>();
  if (enrollmentIds.length > 0) {
    const { data: enrollments, error: enrollmentsError } = await supabaseAdmin
      .from('enrollments')
      .select('id,trainee_id')
      .in('id', enrollmentIds)
      .eq('tenant_id', tenantId);

    if (enrollmentsError) {
      throw enrollmentsError;
    }

    (enrollments || []).forEach((enrollment: { id: string; trainee_id: string }) => {
      traineeByEnrollment.set(enrollment.id, enrollment.trainee_id);
    });
  }

  const statusByTrainee = new Map<string, string>();
  (enrollmentRequirements || []).forEach(
    (item: { submission_status: string; enrollment_id?: string }, index: number) => {
      const traineeKey = item.enrollment_id
        ? traineeByEnrollment.get(item.enrollment_id) || `enrollment:${item.enrollment_id}`
        : `enrollment:${index}`;
      statusByTrainee.set(traineeKey, item.submission_status);
    }
  );

  const { data: uploadedFiles, error: filesError } = await supabaseAdmin
    .from('training_requirement_files')
    .select('trainee_id')
    .eq('tenant_id', tenantId)
    .eq('requirement_type', definition.requirement_type)
    .is('deleted_at', null);

  if (filesError) {
    throw filesError;
  }

  // A real upload means the trainee has submitted the requirement. Preserve
  // verified, rejected, and waived decisions made by staff.
  (uploadedFiles || []).forEach((file: { trainee_id?: string }) => {
    if (!file.trainee_id) return;
    const currentStatus = statusByTrainee.get(file.trainee_id);
    if (!currentStatus || currentStatus === 'pending') {
      statusByTrainee.set(file.trainee_id, 'submitted');
    }
  });

  const stats = {
    total_trainees: statusByTrainee.size,
    pending_count: 0,
    submitted_count: 0,
    verified_count: 0,
    rejected_count: 0,
    waived_count: 0,
  };

  statusByTrainee.forEach((status) => {
    switch (status) {
      case 'pending': stats.pending_count++; break;
      case 'submitted': stats.submitted_count++; break;
      case 'verified': stats.verified_count++; break;
      case 'rejected': stats.rejected_count++; break;
      case 'waived': stats.waived_count++; break;
    }
  });

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
