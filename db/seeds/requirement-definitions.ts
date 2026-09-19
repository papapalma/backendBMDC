/**
 * Database Seed: Requirement Definitions
 *
 * Populates the requirement_definitions table with the 7 core requirement types
 * for each existing tenant.
 *
 * The 7 requirement types are:
 * 1. Accomplished Learner's Profile Form
 * 2. Photocopy of Birth Certificate (NSO/PSA)
 * 3. Photocopy of Marriage Certificate (PSA/NSO) for Married Woman
 * 4. 3 pcs 1x1 ID Picture (white background)
 * 5. Photocopy of Valid ID
 * 6. Certified True Copy of Report Card/TOR
 * 7. Certification of No Grade Completed from barangay
 *
 * Applicability Rules:
 * - Marriage certificate: only for married trainees
 * - All others: apply to all trainees
 *
 * Run this seed after database migration:
 * npx ts-node db/seeds/requirement-definitions.ts
 */

import { supabaseAdmin } from '@/lib/supabase-admin';

const CORE_REQUIREMENTS = [
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

async function seedRequirementDefinitions() {
  console.log('🌱 Starting requirement definitions seed...');

  try {
    // Step 1: Get all existing tenants
    const { data: tenants, error: tenantsError } = await supabaseAdmin
      .from('tenants')
      .select('id, name')
      .not('deleted_at', 'is', null);

    if (tenantsError) {
      console.error('❌ Failed to fetch tenants:', tenantsError);
      process.exit(1);
    }

    if (!tenants || tenants.length === 0) {
      console.warn('⚠️  No tenants found to seed');
      process.exit(0);
    }

    console.log(`✓ Found ${tenants.length} tenant(s)`);

    // Step 2: For each tenant, create requirement definitions
    for (const tenant of tenants) {
      console.log(`\n  Seeding requirement definitions for tenant: ${tenant.name} (${tenant.id})`);

      let createdCount = 0;
      let existingCount = 0;

      for (const requirement of CORE_REQUIREMENTS) {
        // Check if requirement already exists
        const { data: existing, error: checkError } = await supabaseAdmin
          .from('requirement_definitions')
          .select('id')
          .eq('tenant_id', tenant.id)
          .eq('requirement_type', requirement.type)
          .maybeSingle();

        if (checkError) {
          console.error(`    ❌ Error checking requirement ${requirement.type}:`, checkError);
          continue;
        }

        if (existing) {
          console.log(`    ✓ ${requirement.type} already exists`);
          existingCount++;
          continue;
        }

        // Create the requirement
        const { data: created, error: createError } = await supabaseAdmin
          .from('requirement_definitions')
          .insert({
            tenant_id: tenant.id,
            requirement_type: requirement.type,
            display_name: requirement.displayName,
            description: requirement.description,
            is_mandatory: requirement.isMandatory,
            is_active: true,
            applicability_rules: requirement.applicabilityRules || null,
            display_order: requirement.displayOrder,
          })
          .select('id')
          .single();

        if (createError) {
          console.error(`    ❌ Error creating requirement ${requirement.type}:`, createError);
          continue;
        }

        console.log(`    ✓ Created: ${requirement.displayName}`);
        createdCount++;
      }

      console.log(`  Summary: Created ${createdCount}, Already exist ${existingCount}`);
    }

    console.log('\n✅ Requirement definitions seed completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
}

// Run the seed
seedRequirementDefinitions();
