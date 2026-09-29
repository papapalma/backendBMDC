/**
 * Archive Page Test Data Fixture
 * 
 * Sets up test data for archive page E2E and integration tests
 * Creates test tenants, users with different roles, programs, trainees,
 * and trainee status records with realistic soft-deletion timestamps
 */

import { createClient } from '@supabase/supabase-js';
import { hashPassword } from '@/lib/auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://uhhavzjgdsznlokozocr.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Test data constants
const TEST_TENANT_ID = 'test-tenant-archive-' + Date.now();
const ADMIN_USER_ID = 'admin-archive-' + Date.now();
const COORDINATOR_USER_ID = 'coordinator-archive-' + Date.now();
const TRAINEE_USER_ID = 'trainee-archive-' + Date.now();

const TEST_CREDENTIALS = {
  admin: { email: 'admin-archive-test@test.com', password: 'TestPassword123' },
  coordinator: { email: 'coordinator-archive-test@test.com', password: 'TestPassword123' },
  trainee: { email: 'trainee-archive-test@test.com', password: 'TestPassword123' },
};

/**
 * Set up test data for archive page tests
 * Returns IDs and credentials for use in tests
 */
export async function setupArchiveTestData() {
  try {
    // Step 1: Create test tenant
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .insert({
        id: TEST_TENANT_ID,
        name: 'Archive Test Tenant',
        slug: 'archive-test-' + Date.now(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (tenantError) throw new Error(`Failed to create tenant: ${tenantError.message}`);

    // Step 2: Hash passwords for test users
    const adminPasswordHash = await hashPassword(TEST_CREDENTIALS.admin.password);
    const coordinatorPasswordHash = await hashPassword(TEST_CREDENTIALS.coordinator.password);
    const traineePasswordHash = await hashPassword(TEST_CREDENTIALS.trainee.password);

    // Step 3: Create test users with different roles
    await supabaseAdmin
      .from('users')
      .insert([
        {
          id: ADMIN_USER_ID,
          email: TEST_CREDENTIALS.admin.email,
          username: 'admin-archive-test',
          password_hash: adminPasswordHash,
          role: 'local_admin',
          tenant_id: TEST_TENANT_ID,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: COORDINATOR_USER_ID,
          email: TEST_CREDENTIALS.coordinator.email,
          username: 'coordinator-archive-test',
          password_hash: coordinatorPasswordHash,
          role: 'staff_training_coordinator',
          tenant_id: TEST_TENANT_ID,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: TRAINEE_USER_ID,
          email: TEST_CREDENTIALS.trainee.email,
          username: 'trainee-archive-test',
          password_hash: traineePasswordHash,
          role: 'trainee',
          tenant_id: TEST_TENANT_ID,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);

    // Step 4: Create test programs (1 active, 2 soft-deleted)
    await supabaseAdmin
      .from('programs')
      .insert([
        {
          id: 'program-active-001',
          name: 'Active Program',
          description: 'A program that is not deleted',
          tenant_id: TEST_TENANT_ID,
          status: 'active',
          deleted_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'program-deleted-5d',
          name: 'Deleted Program - 5 days ago',
          description: 'Deleted 5 days ago (not eligible for purge)',
          tenant_id: TEST_TENANT_ID,
          status: 'archived',
          deleted_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'program-deleted-35d',
          name: 'Deleted Program - 35 days ago',
          description: 'Deleted 35 days ago (eligible for purge)',
          tenant_id: TEST_TENANT_ID,
          status: 'archived',
          deleted_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);

    // Step 5: Create test trainees (1 active, 3 soft-deleted)
    const traineeDefaults = {
      phone: '+63-900-000-0001',
      sex: 'Male' as const,
      birth_date: '1995-01-01',
      birth_place: 'Manila',
      civil_status: 'Single' as const,
      province: 'Manila',
      municipality: 'Manila City',
      barangay: 'Test Barangay',
      street: '123 Test Street',
      educational_attainment: 'College' as const,
      course: 'Information Technology',
      year_graduated: '2020',
      classification: 'Unemployed' as const,
      employment_status: 'Unemployed' as const,
      status: 'active' as const,
      program_id: 'program-active-001',
      tenant_id: TEST_TENANT_ID,
    };

    await supabaseAdmin
      .from('trainees')
      .insert([
        {
          id: 'trainee-active-001',
          first_name: 'John',
          last_name: 'Doe',
          email: 'john-active@test.com',
          deleted_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...traineeDefaults,
        },
        {
          id: 'trainee-deleted-2d',
          first_name: 'Jane',
          last_name: 'Smith',
          email: 'jane-deleted@test.com',
          deleted_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...traineeDefaults,
        },
        {
          id: 'trainee-deleted-15d',
          first_name: 'Bob',
          last_name: 'Johnson',
          email: 'bob-deleted@test.com',
          deleted_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...traineeDefaults,
        },
        {
          id: 'trainee-deleted-40d',
          first_name: 'Alice',
          last_name: 'Williams',
          email: 'alice-deleted@test.com',
          deleted_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...traineeDefaults,
        },
      ]);

    // Step 6: Create test trainee status records (1 active, 2 soft-deleted)
    await supabaseAdmin
      .from('trainee_status_records')
      .insert([
        {
          id: 'status-active-001',
          enrollment_id: 'enrollment-001',
          trainee_id: 'trainee-active-001',
          tenant_id: TEST_TENANT_ID,
          graduation_status: 'pending',
          employment_status: 'pending',
          recorded_by: ADMIN_USER_ID,
          recorded_at: new Date().toISOString(),
          remarks: 'On track',
          deleted_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'status-deleted-8d',
          enrollment_id: 'enrollment-002',
          trainee_id: 'trainee-deleted-2d',
          tenant_id: TEST_TENANT_ID,
          graduation_status: 'graduated',
          employment_status: 'employed',
          job_title: 'Software Engineer',
          employer_name: 'Tech Corp',
          recorded_by: ADMIN_USER_ID,
          recorded_at: new Date().toISOString(),
          remarks: 'Archived status - 8 days',
          deleted_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'status-deleted-32d',
          enrollment_id: 'enrollment-003',
          trainee_id: 'trainee-deleted-15d',
          tenant_id: TEST_TENANT_ID,
          graduation_status: 'graduated',
          employment_status: 'unemployed',
          recorded_by: ADMIN_USER_ID,
          recorded_at: new Date().toISOString(),
          remarks: 'Archived status - 32 days (eligible for purge)',
          deleted_at: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);

    return {
      TEST_TENANT_ID,
      ADMIN_USER_ID,
      COORDINATOR_USER_ID,
      TRAINEE_USER_ID,
    };
  } catch (error) {
    console.error('Error setting up archive test data:', error);
    throw error;
  }
}

/**
 * Clean up test data after tests
 */
export async function cleanupArchiveTestData() {
  try {
    // Cleanup in reverse dependency order
    await supabaseAdmin
      .from('trainee_status_records')
      .delete()
      .eq('tenant_id', TEST_TENANT_ID);

    await supabaseAdmin
      .from('trainees')
      .delete()
      .eq('tenant_id', TEST_TENANT_ID);

    await supabaseAdmin
      .from('programs')
      .delete()
      .eq('tenant_id', TEST_TENANT_ID);

    await supabaseAdmin
      .from('users')
      .delete()
      .eq('tenant_id', TEST_TENANT_ID);

    await supabaseAdmin
      .from('tenants')
      .delete()
      .eq('id', TEST_TENANT_ID);
  } catch (error) {
    console.error('Error cleaning up archive test data:', error);
    throw error;
  }
}

export { TEST_CREDENTIALS };
