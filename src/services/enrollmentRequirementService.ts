/**
 * Enrollment Requirement Service
 *
 * Manages enrollment requirements initialization, applicability logic,
 * and requirement tracking for trainees.
 *
 * Key Responsibilities:
 * - Initialize requirements for new enrollments based on requirement_definitions
 * - Evaluate applicability rules (e.g., marriage_certificate only for married trainees)
 * - Update requirement applicability when trainee profile changes
 * - Track submission status and verification
 */

import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * Interface for trainee profile data used in applicability evaluation
 */
export interface TraineeProfileData {
  id: string;
  marital_status?: string | null;
  [key: string]: any; // Allow other profile fields
}

/**
 * Interface for requirement applicability rules
 */
export interface ApplicabilityRules {
  applicable_to?: {
    marital_status?: string[];
    [key: string]: any;
  };
  [key: string]: any;
}

/**
 * Interface for requirement definition
 */
export interface RequirementDefinition {
  id: string;
  tenant_id: string;
  requirement_type: string;
  display_name: string;
  description?: string;
  is_mandatory: boolean;
  is_active: boolean;
  applicability_rules?: ApplicabilityRules | null;
  display_order: number;
}

/**
 * Interface for enrollment requirement record to be created
 */
export interface CreateEnrollmentRequirement {
  enrollment_id: string;
  requirement_id: string;
  tenant_id: string;
  is_applicable: boolean;
  submission_status: 'pending' | 'submitted' | 'verified' | 'rejected' | 'waived';
}

/**
 * Evaluate applicability rules for a trainee
 *
 * Rules are evaluated as AND conditions within each field:
 * - If applicability_rules is null/empty, requirement applies to all trainees
 * - If marital_status is specified, only apply to trainees with matching marital_status
 *
 * Example rule:
 * {
 *   "applicable_to": {
 *     "marital_status": ["married"]
 *   }
 * }
 *
 * This rule means: requirement only applies if marital_status is "married"
 *
 * @param rules - Applicability rules from requirement_definitions
 * @param traineeProfile - Trainee profile data
 * @returns true if requirement applies to this trainee, false otherwise
 */
export function evaluateApplicabilityRules(
  rules: ApplicabilityRules | null | undefined,
  traineeProfile: TraineeProfileData
): boolean {
  // No rules = applies to all trainees
  if (!rules) {
    return true;
  }

  // Check applicable_to conditions
  const applicableTo = rules.applicable_to;
  if (!applicableTo) {
    return true;
  }

  // Evaluate marital_status condition if present
  if (applicableTo.marital_status) {
    const allowedStatuses = applicableTo.marital_status;
    const traineeStatus = traineeProfile.marital_status;

    if (!traineeStatus || !allowedStatuses.includes(traineeStatus)) {
      return false;
    }
  }

  // All conditions passed
  return true;
}

/**
 * Initialize enrollment requirements for a new enrollment
 *
 * When a trainee enrolls in a program:
 * 1. Fetch all active requirement definitions for the tenant
 * 2. Evaluate applicability for each requirement based on trainee profile
 * 3. Create enrollment_requirements records with appropriate applicability status
 *
 * @param enrollmentId - ID of the new enrollment
 * @param traineeId - ID of the trainee
 * @param tenantId - ID of the tenant
 * @returns Array of created enrollment requirement records
 * @throws Error if enrollment or trainee not found, or if database operation fails
 */
export async function initializeEnrollmentRequirements(
  enrollmentId: string,
  traineeId: string,
  tenantId: string
): Promise<CreateEnrollmentRequirement[]> {
  // 1. Fetch trainee profile to get marital status and other fields
  const { data: traineeProfile, error: traineeError } = await supabaseAdmin
    .from('trainee_status_records')
    .select('id, marital_status')
    .eq('trainee_id', traineeId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (traineeError) {
    throw new Error(`Failed to fetch trainee profile: ${traineeError.message}`);
  }

  if (!traineeProfile) {
    // If no trainee_status_record exists, create with default marital_status
    // This handles edge cases where trainee exists but profile not yet created
    console.warn(`No trainee_status_record found for trainee ${traineeId}, using defaults`);
  }

  // 2. Fetch all active requirement definitions for the tenant
  const { data: requirements, error: requirementsError } = await supabaseAdmin
    .from('requirement_definitions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('display_order', { ascending: true });

  if (requirementsError) {
    throw new Error(`Failed to fetch requirement definitions: ${requirementsError.message}`);
  }

  // 3. Evaluate applicability and create enrollment_requirements records
  const enrollmentRequirements: CreateEnrollmentRequirement[] = (requirements || []).map(
    (requirement: RequirementDefinition) => {
      const isApplicable = evaluateApplicabilityRules(
        requirement.applicability_rules,
        traineeProfile || { id: traineeId }
      );

      return {
        enrollment_id: enrollmentId,
        requirement_id: requirement.id,
        tenant_id: tenantId,
        is_applicable: isApplicable,
        submission_status: 'pending' as const,
      };
    }
  );

  // 4. Bulk insert enrollment_requirements records
  if (enrollmentRequirements.length > 0) {
    const { error: insertError } = await supabaseAdmin
      .from('enrollment_requirements')
      .insert(enrollmentRequirements);

    if (insertError) {
      throw new Error(`Failed to create enrollment requirements: ${insertError.message}`);
    }
  }

  return enrollmentRequirements;
}

/**
 * Update applicability for all enrollment requirements when trainee profile changes
 *
 * This handles cases where a trainee's profile is updated (e.g., marital status changes)
 * and we need to re-evaluate which requirements apply.
 *
 * For example: if a trainee changes from "single" to "married", the
 * marriage_certificate requirement should become applicable.
 *
 * @param traineeId - ID of the trainee whose profile changed
 * @param tenantId - ID of the tenant
 * @returns Number of requirements updated
 * @throws Error if database operation fails
 */
export async function updateEnrollmentRequirementsApplicability(
  traineeId: string,
  tenantId: string
): Promise<number> {
  // 1. Fetch updated trainee profile
  const { data: traineeProfile, error: traineeError } = await supabaseAdmin
    .from('trainee_status_records')
    .select('id, marital_status')
    .eq('trainee_id', traineeId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (traineeError) {
    throw new Error(`Failed to fetch trainee profile: ${traineeError.message}`);
  }

  if (!traineeProfile) {
    console.warn(`No trainee_status_record found for trainee ${traineeId}`);
    return 0;
  }

  // 2. Fetch all enrollments for this trainee
  const { data: enrollments, error: enrollmentsError } = await supabaseAdmin
    .from('enrollments')
    .select('id')
    .eq('trainee_id', traineeId)
    .eq('tenant_id', tenantId);

  if (enrollmentsError) {
    throw new Error(`Failed to fetch enrollments: ${enrollmentsError.message}`);
  }

  if (!enrollments || enrollments.length === 0) {
    return 0;
  }

  // 3. For each enrollment, fetch enrollment_requirements with linked requirement_definitions
  let updatedCount = 0;

  for (const enrollment of enrollments) {
    const { data: enrollmentReqs, error: reqsError } = await supabaseAdmin
      .from('enrollment_requirements')
      .select(
        `
        id,
        requirement_id,
        is_applicable,
        requirement_definitions:requirement_id (
          id,
          applicability_rules
        )
      `
      )
      .eq('enrollment_id', enrollment.id)
      .eq('tenant_id', tenantId);

    if (reqsError) {
      console.error(
        `Failed to fetch enrollment requirements for enrollment ${enrollment.id}: ${reqsError.message}`
      );
      continue;
    }

    // 4. For each requirement, re-evaluate applicability
    for (const enrollmentReq of enrollmentReqs || []) {
      const reqDef = (enrollmentReq.requirement_definitions as any) || {};
      const newApplicability = evaluateApplicabilityRules(
        reqDef.applicability_rules,
        traineeProfile
      );

      // Only update if applicability changed
      if (newApplicability !== enrollmentReq.is_applicable) {
        const { error: updateError } = await supabaseAdmin
          .from('enrollment_requirements')
          .update({
            is_applicable: newApplicability,
            updated_at: new Date().toISOString(),
          })
          .eq('id', enrollmentReq.id);

        if (updateError) {
          console.error(
            `Failed to update enrollment requirement ${enrollmentReq.id}: ${updateError.message}`
          );
        } else {
          updatedCount++;
        }
      }
    }
  }

  return updatedCount;
}

/**
 * Get enrollment requirements with requirement details for a trainee
 *
 * @param enrollmentId - ID of the enrollment
 * @param includeNonApplicable - Whether to include non-applicable requirements (default: false)
 * @returns Array of enrollment requirements with requirement definition details
 * @throws Error if database operation fails
 */
export async function getEnrollmentRequirementsWithDetails(
  enrollmentId: string,
  includeNonApplicable: boolean = false
) {
  let query = supabaseAdmin
    .from('enrollment_requirements')
    .select(
      `
      id,
      requirement_id,
      is_applicable,
      submission_status,
      document_url,
      submitted_at,
      verified_at,
      verified_by,
      rejection_reason,
      created_at,
      updated_at,
      requirement_definitions (
        id,
        requirement_type,
        display_name,
        description,
        is_mandatory,
        display_order
      )
    `
    )
    .eq('enrollment_id', enrollmentId);

  if (!includeNonApplicable) {
    query = query.eq('is_applicable', true);
  }

  query = query.order('created_at', { ascending: true });

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch enrollment requirements: ${error.message}`);
  }

  return data || [];
}
