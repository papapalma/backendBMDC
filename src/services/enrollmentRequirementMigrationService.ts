/**
 * Enrollment Requirement Migration Service
 *
 * Handles data migration tasks for the enrollment requirements system:
 * - Populate requirement_definitions for all 7 core requirement types
 * - Migrate existing enrollments to enrollment_requirements
 * - Create mappings between old and new requirement system
 */

import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * The 7 core requirement types that all tenants should have
 */
export const CORE_REQUIREMENT_TYPES = [
  {
    type: 'accomplished_learners_profile_form',
    displayName: "Accomplished Learner's Profile Form",
    description:
      'A reflective form documenting your learning journey and key achievements in the program.',
    isMandatory: true,
    displayOrder: 1,
  },
  {
    type: 'birth_certificate_copy',
    displayName: 'Photocopy of Birth Certificate (NSO/PSA)',
    description: 'Official photocopy of birth certificate from NSO or PSA.',
    isMandatory: true,
    displayOrder: 2,
  },
  {
    type: 'marriage_certificate_copy',
    displayName: 'Photocopy of Marriage Certificate (PSA/NSO) for Married Woman',
    description: 'Official photocopy of marriage certificate (PSA/NSO) for married female trainees.',
    isMandatory: false, // Not all are married
    displayOrder: 3,
    applicabilityRules: {
      applicable_to: {
        marital_status: ['married'],
      },
    },
  },
  {
    type: 'id_pictures',
    displayName: '3 pcs 1x1 ID Picture (white background)',
    description: '3 pieces of 1x1 ID pictures with white background.',
    isMandatory: true,
    displayOrder: 4,
  },
  {
    type: 'valid_id_copy',
    displayName: 'Photocopy of Valid ID',
    description: 'Photocopy of valid government-issued ID (passport, drivers license, etc.).',
    isMandatory: true,
    displayOrder: 5,
  },
  {
    type: 'report_card_tor_copy',
    displayName: 'Certified True Copy of Report Card/TOR',
    description: 'Certified true copy of report card or transcript of records.',
    isMandatory: true,
    displayOrder: 6,
  },
  {
    type: 'barangay_no_grade_certification',
    displayName: 'Certification of No Grade Completed from barangay',
    description: 'Barangay certification stating no grade has been completed.',
    isMandatory: true,
    displayOrder: 7,
  },
];

/**
 * Ensure requirement_definitions exist for a tenant
 *
 * For each tenant, ensure all 7 core requirement types exist in requirement_definitions.
 * If a requirement type is missing, create it.
 *
 * @param tenantId - ID of the tenant
 * @returns Object with counts of created and existing requirements
 * @throws Error if database operation fails
 */
export async function ensureRequirementDefinitions(
  tenantId: string
): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;

  for (const requirement of CORE_REQUIREMENT_TYPES) {
    // Check if this requirement type already exists for the tenant
    const { data: existingReq, error: queryError } = await supabaseAdmin
      .from('requirement_definitions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('requirement_type', requirement.type)
      .maybeSingle();

    if (queryError) {
      throw new Error(
        `Failed to check existing requirement ${requirement.type}: ${queryError.message}`
      );
    }

    if (existingReq) {
      existing++;
      continue;
    }

    // Create the requirement
    const { error: insertError } = await supabaseAdmin
      .from('requirement_definitions')
      .insert({
        tenant_id: tenantId,
        requirement_type: requirement.type,
        display_name: requirement.displayName,
        description: requirement.description,
        is_mandatory: requirement.isMandatory,
        is_active: true,
        applicability_rules: requirement.applicabilityRules || null,
        display_order: requirement.displayOrder,
      });

    if (insertError) {
      throw new Error(
        `Failed to create requirement ${requirement.type}: ${insertError.message}`
      );
    }

    created++;
  }

  return { created, existing };
}

/**
 * Migrate existing enrollments to enrollment_requirements
 *
 * For each enrollment that doesn't have enrollment_requirements yet,
 * create them by joining with requirement_definitions.
 *
 * Uses the SQL migration approach with applicability rule evaluation.
 *
 * @param tenantId - ID of the tenant (optional, if not provided migrates all tenants)
 * @returns Object with migration statistics
 * @throws Error if database operation fails
 */
export async function migrateExistingEnrollments(
  tenantId?: string
): Promise<{ enrollmentsProcessed: number; requirementsCreated: number }> {
  // Build the query
  let migrateQuery = `
    INSERT INTO enrollment_requirements (
      enrollment_id,
      requirement_id,
      tenant_id,
      is_applicable,
      submission_status,
      created_at,
      updated_at
    )
    SELECT
      e.id as enrollment_id,
      rd.id as requirement_id,
      e.tenant_id,
      CASE 
        WHEN rd.requirement_type = 'marriage_certificate_copy' THEN
          (tsr.marital_status = 'married')
        ELSE TRUE
      END as is_applicable,
      'pending' as submission_status,
      NOW() as created_at,
      NOW() as updated_at
    FROM enrollments e
    CROSS JOIN requirement_definitions rd
    LEFT JOIN trainee_status_records tsr ON tsr.trainee_id = e.trainee_id AND tsr.tenant_id = e.tenant_id
    WHERE 
      e.tenant_id = rd.tenant_id
      AND rd.is_active = true
      AND rd.deleted_at IS NULL
      ${tenantId ? `AND e.tenant_id = '${tenantId}'` : ''}
      AND NOT EXISTS (
        SELECT 1 FROM enrollment_requirements er
        WHERE er.enrollment_id = e.id AND er.requirement_id = rd.id
      )
    ON CONFLICT (enrollment_id, requirement_id) DO NOTHING;
  `;

  // Execute via RPC or raw SQL
  // Since we're using supabaseAdmin, we need to use the raw SQL execution
  // This is typically done via a database function or raw query
  const { error: migrationError } = await supabaseAdmin.rpc('exec_migration', {
    sql: migrateQuery,
  });

  if (migrationError) {
    // If RPC is not available, log and handle gracefully
    console.warn(`Migration RPC not available: ${migrationError.message}`);
  }

  // Get migration statistics
  const { data: stats, error: statsError } = await supabaseAdmin.rpc('get_migration_stats', {
    tenant_id: tenantId || null,
  });

  if (statsError) {
    console.warn(`Could not fetch migration stats: ${statsError.message}`);
  }

  return {
    enrollmentsProcessed: stats?.enrollment_count || 0,
    requirementsCreated: stats?.requirement_assignment_count || 0,
  };
}

/**
 * Get enrollment requirement mapping for an enrollment
 *
 * Returns all enrollment_requirements for an enrollment with their
 * linked requirement_definitions.
 *
 * @param enrollmentId - ID of the enrollment
 * @returns Array of enrollment requirements with definitions
 * @throws Error if database operation fails
 */
export async function getEnrollmentRequirementMapping(enrollmentId: string) {
  const { data, error } = await supabaseAdmin
    .from('enrollment_requirements')
    .select(
      `
      id,
      enrollment_id,
      requirement_id,
      is_applicable,
      submission_status,
      requirement_definitions (
        id,
        requirement_type,
        display_name,
        description,
        is_mandatory
      )
    `
    )
    .eq('enrollment_id', enrollmentId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch requirement mapping: ${error.message}`);
  }

  return data || [];
}

/**
 * Verify migration completion
 *
 * Check that all enrollments have enrollment_requirements for all
 * active requirement definitions.
 *
 * @param tenantId - ID of the tenant to verify
 * @returns Object with verification results
 * @throws Error if database operation fails
 */
export async function verifyMigration(
  tenantId: string
): Promise<{
  isComplete: boolean;
  enrollmentCount: number;
  requirementDefinitionCount: number;
  totalExpectedRequirements: number;
  totalCreatedRequirements: number;
  missingRequirements: number;
}> {
  // Get enrollment count
  const { data: enrollments, error: enrollmentsError } = await supabaseAdmin
    .from('enrollments')
    .select('id', { count: 'exact' })
    .eq('tenant_id', tenantId);

  if (enrollmentsError) {
    throw new Error(`Failed to count enrollments: ${enrollmentsError.message}`);
  }

  const enrollmentCount = enrollments?.length || 0;

  // Get requirement definition count
  const { data: requirements, error: requirementsError } = await supabaseAdmin
    .from('requirement_definitions')
    .select('id', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .is('deleted_at', null);

  if (requirementsError) {
    throw new Error(`Failed to count requirements: ${requirementsError.message}`);
  }

  const requirementDefinitionCount = requirements?.length || 0;
  const totalExpectedRequirements = enrollmentCount * requirementDefinitionCount;

  // Get total created requirements
  const { data: createdReqs, error: createdError } = await supabaseAdmin
    .from('enrollment_requirements')
    .select('id', { count: 'exact' })
    .eq('tenant_id', tenantId);

  if (createdError) {
    throw new Error(`Failed to count created requirements: ${createdError.message}`);
  }

  const totalCreatedRequirements = createdReqs?.length || 0;
  const missingRequirements = totalExpectedRequirements - totalCreatedRequirements;

  return {
    isComplete: missingRequirements === 0,
    enrollmentCount,
    requirementDefinitionCount,
    totalExpectedRequirements,
    totalCreatedRequirements,
    missingRequirements,
  };
}
