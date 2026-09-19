#!/usr/bin/env node

/**
 * Requirement Definitions Seeder Script (TypeScript)
 * Seeds 7 core requirement types for all active tenants
 * Run with: npx ts-node scripts/seed-requirement-definitions.ts
 *
 * This script:
 * 1. Connects to Supabase using service role key
 * 2. Fetches all active tenants
 * 3. For each tenant, creates 7 requirement definition records
 * 4. Sets appropriate display names, descriptions, and applicability rules
 * 5. Handles idempotency (checks if records already exist)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

// Types
interface RequirementDefinition {
  id: string;
  tenant_id: string;
  requirement_type: string;
  display_name: string;
  description: string;
  is_mandatory: boolean;
  is_active: boolean;
  applicability_rules: Record<string, any> | null;
  display_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface Tenant {
  id: string;
  name: string;
  created_at: string;
}

// Core requirement definitions
const CORE_REQUIREMENTS = [
  {
    requirement_type: 'accomplished_learners_profile_form',
    display_name: "Accomplished Learner's Profile Form",
    description:
      'A form documenting the trainee\'s learning journey, accomplishments, and competencies developed during the training program.',
    is_mandatory: true,
    display_order: 0
  },
  {
    requirement_type: 'birth_certificate_copy',
    display_name: 'Photocopy of Birth Certificate (NSO/PSA)',
    description:
      'A certified photocopy of your birth certificate from the National Statistics Office (NSO) or Philippine Statistics Authority (PSA). Required for legal identification purposes.',
    is_mandatory: true,
    display_order: 1
  },
  {
    requirement_type: 'marriage_certificate_copy',
    display_name: 'Photocopy of Marriage Certificate (PSA/NSO) for Married Woman',
    description:
      'A certified photocopy of your marriage certificate from the Philippine Statistics Authority (PSA) or National Statistics Office (NSO). Required only for married women trainees.',
    is_mandatory: false, // is_mandatory is false because not all trainees need it
    applicability_rules: {
      applicable_to: { marital_status: ['married'] }
    },
    display_order: 2
  },
  {
    requirement_type: 'id_pictures',
    display_name: '3 pcs 1x1 ID Picture (white background)',
    description:
      'Three (3) pieces of 1x1 inch identification photographs with a plain white background. These photos will be used for your official training ID and record-keeping.',
    is_mandatory: true,
    display_order: 3
  },
  {
    requirement_type: 'valid_id_copy',
    display_name: 'Photocopy of Valid ID',
    description:
      'A photocopy of any government-issued or company-issued valid identification card (e.g., driver\'s license, passport, SSS ID, TIN ID, company ID). Used for identity verification.',
    is_mandatory: true,
    display_order: 4
  },
  {
    requirement_type: 'report_card_tor_copy',
    display_name: 'Certified True Copy of Report Card/TOR',
    description:
      'A certified true copy of your most recent report card or transcript of records (TOR) from your last school or institution. Shows your academic performance and educational background.',
    is_mandatory: true,
    display_order: 5
  },
  {
    requirement_type: 'barangay_no_grade_certification',
    display_name: 'Certification of No Grade Completed from Barangay',
    description:
      'An official certification from your barangay office stating that you have not obtained any failing grades or pending disciplinary cases. Required for community good standing verification.',
    is_mandatory: true,
    display_order: 6
  }
];

// Helper functions
function log(message: string, emoji = '📋'): void {
  console.log(`${emoji} ${message}`);
}

function logError(message: string): void {
  console.error(`❌ ${message}`);
}

function logSuccess(message: string): void {
  console.log(`✅ ${message}`);
}

function logWarning(message: string): void {
  console.log(`⚠️  ${message}`);
}

function logDivider(title?: string): void {
  const divider = '═'.repeat(70);
  console.log(divider);
  if (title) {
    console.log(title);
    console.log(divider);
  }
}

async function seedRequirementDefinitions(): Promise<void> {
  try {
    logDivider('🌱 REQUIREMENT DEFINITIONS SEEDER');
    console.log();

    // Validate environment variables
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      logError('Missing required environment variables:');
      console.error('   Required: NEXT_PUBLIC_SUPABASE_URL');
      console.error('   Required: SUPABASE_SERVICE_ROLE_KEY');
      console.error('\nCheck your .env file\n');
      process.exit(1);
    }

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    log('Supabase connection established', '🔗');
    console.log();

    // Fetch all active tenants
    log('Fetching active tenants...', '🔍');
    const { data: tenants, error: tenantsError } = await supabase
      .from('tenants')
      .select('id, name, created_at')
      .order('created_at', { ascending: true });

    if (tenantsError) {
      throw new Error(`Failed to fetch tenants: ${tenantsError.message}`);
    }

    if (!tenants || tenants.length === 0) {
      logWarning('No tenants found in the database. Exiting.');
      console.log();
      return;
    }

    logSuccess(`Found ${tenants.length} tenant(s)\n`);

    // Process each tenant
    let totalCreated = 0;
    let totalSkipped = 0;

    for (const tenant of tenants as Tenant[]) {
      logDivider(`📌 Tenant: ${tenant.name} (${tenant.id})`);
      console.log();

      // Check existing requirement definitions for this tenant
      log('Checking for existing requirement definitions...', '🔍');
      const { data: existing, error: existingError } = await supabase
        .from('requirement_definitions')
        .select('requirement_type, display_name')
        .eq('tenant_id', tenant.id)
        .is('deleted_at', null);

      if (existingError && (existingError as any).code !== 'PGRST116') {
        throw new Error(`Failed to check existing requirements: ${existingError.message}`);
      }

      const existingTypes = new Set((existing || []).map((r: any) => r.requirement_type));

      if (existingTypes.size === CORE_REQUIREMENTS.length) {
        logWarning('All 7 requirement definitions already exist for this tenant. Skipping.');
        totalSkipped += CORE_REQUIREMENTS.length;
        console.log();
        continue;
      }

      if (existingTypes.size > 0) {
        log(`Found ${existingTypes.size} existing requirement(s):`);
        Array.from(existingTypes).forEach((type) => {
          const req = CORE_REQUIREMENTS.find((r) => r.requirement_type === type);
          if (req) console.log(`   • ${req.display_name}`);
        });
        console.log();
      }

      // Create missing requirements
      const requirementsToCreate = CORE_REQUIREMENTS.filter(
        (req) => !existingTypes.has(req.requirement_type)
      );

      if (requirementsToCreate.length === 0) {
        logSuccess('All requirements already exist for this tenant');
        console.log();
        continue;
      }

      log(`Creating ${requirementsToCreate.length} requirement definition(s)...`, '⚙️');
      console.log();

      for (const req of requirementsToCreate) {
        const requirementData = {
          id: uuidv4(),
          tenant_id: tenant.id,
          requirement_type: req.requirement_type,
          display_name: req.display_name,
          description: req.description,
          is_mandatory: req.is_mandatory,
          is_active: true,
          applicability_rules: req.applicability_rules || null,
          display_order: req.display_order,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deleted_at: null
        };

        const { data: created, error: createError } = await supabase
          .from('requirement_definitions')
          .insert(requirementData)
          .select()
          .single();

        if (createError) {
          // Check if it's a unique constraint violation (already exists)
          if ((createError as any).code === '23505') {
            logWarning(`Requirement already exists (skipped): ${req.display_name}`);
            totalSkipped++;
          } else {
            throw new Error(
              `Failed to create requirement "${req.display_name}": ${createError.message}`
            );
          }
        } else {
          logSuccess(`Created: ${req.display_name}`);
          if (req.applicability_rules) {
            console.log(`   ├─ Applicability: ${JSON.stringify(req.applicability_rules)}`);
          }
          console.log(`   ├─ Mandatory: ${req.is_mandatory}`);
          console.log(`   └─ Display Order: ${req.display_order}`);
          totalCreated++;
        }
      }

      console.log();
    }

    // Summary
    logDivider('📊 SEEDING SUMMARY');
    console.log();
    console.log(`   Total Created:  ${totalCreated}`);
    console.log(`   Total Skipped:  ${totalSkipped}`);
    console.log(`   Processed:      ${totalCreated + totalSkipped} records`);
    console.log();

    // Verify the seeding
    log('Verifying seeding across all tenants...', '🔍');
    const { data: allRequirements, error: verifyError } = await supabase
      .from('requirement_definitions')
      .select('tenant_id, requirement_type, display_name')
      .is('deleted_at', null)
      .order('tenant_id', { ascending: true })
      .order('display_order', { ascending: true });

    if (verifyError) {
      throw new Error(`Verification failed: ${verifyError.message}`);
    }

    if (allRequirements && allRequirements.length > 0) {
      const byTenant: Record<string, any[]> = {};
      (allRequirements as any[]).forEach((req) => {
        if (!byTenant[req.tenant_id]) {
          byTenant[req.tenant_id] = [];
        }
        byTenant[req.tenant_id].push(req);
      });

      log(`Requirement definitions per tenant:`, '📋');
      Object.entries(byTenant).forEach(([tenantId, reqs]) => {
        const tenant = (tenants as Tenant[]).find((t) => t.id === tenantId);
        const tenantName = tenant?.name || tenantId;
        console.log(`\n   ${tenantName}:`);
        (reqs as any[]).forEach((req) => {
          console.log(`     ${req.display_order + 1}. ${req.display_name}`);
        });
      });
    }

    console.log();
    logDivider('✨ SEEDING COMPLETED SUCCESSFULLY');
    console.log();

  } catch (error) {
    logError('Error during seeding:');
    if (error instanceof Error) {
      console.error(`   ${error.message}\n`);
    } else {
      console.error(`   ${String(error)}\n`);
    }
    process.exit(1);
  }
}

// Run the seeding
seedRequirementDefinitions();
