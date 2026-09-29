/**
 * Database Seed: Tenants
 *
 * Populates the tenants table with sample organizations for testing/development.
 *
 * Run this seed after database migration:
 * npx ts-node db/seeds/tenants.ts
 */

import { supabaseAdmin } from '@/lib/supabase-admin';

const SAMPLE_TENANTS = [
  {
    name: 'BMDC - Barangay Medic and Development Center',
    status: 'active',
    contactEmail: 'admin@bmdc.local',
    contactPhone: '+63-2-8123-4567',
    address: 'Barangay Hall, Calamba, Laguna',
  },
  {
    name: 'Training Center Alpha',
    status: 'active',
    contactEmail: 'admin@tcalpha.local',
    contactPhone: '+63-917-123-4567',
    address: 'Main Street, Manila',
  },
  {
    name: 'Community Training Institute',
    status: 'active',
    contactEmail: 'admin@cti.local',
    contactPhone: '+63-921-987-6543',
    address: 'Business District, Quezon City',
  },
];

async function seedTenants() {
  console.log('🌱 Starting tenants seed...');

  try {
    for (const tenant of SAMPLE_TENANTS) {
      // Check if tenant already exists
      const { data: existing, error: checkError } = await supabaseAdmin
        .from('tenants')
        .select('id')
        .eq('name', tenant.name)
        .maybeSingle();

      if (checkError) {
        console.error('❌ Error checking tenant:', checkError);
        continue;
      }

      if (existing) {
        console.log(`✓ Tenant '${tenant.name}' already exists`);
        continue;
      }

      // Create the tenant
      const { data: created, error: createError } = await supabaseAdmin
        .from('tenants')
        .insert({
          name: tenant.name,
          status: tenant.status,
          contact_email: tenant.contactEmail,
          contact_phone: tenant.contactPhone,
          address: tenant.address,
        })
        .select('id')
        .single();

      if (createError) {
        console.error('❌ Error creating tenant:', createError);
        continue;
      }

      console.log(`✓ Created tenant: ${created.id}`);
    }

    console.log('\\n✅ Tenant seed completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
}

// Run the seed
seedTenants();
