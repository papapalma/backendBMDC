#!/usr/bin/env node

/**
 * Superadmin Seeder Script
 * Creates or updates a superadmin user account
 * Run with: node scripts/seed-superadmin.js or npm run seed:superadmin
 * 
 * This script:
 * 1. Checks if superadmin already exists
 * 2. Creates superadmin with secure bcryptjs hashing
 * 3. Provides login credentials
 * 4. Logs verification results
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const bcryptjs = require('bcryptjs');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Superadmin configuration (can be overridden via environment variables)
const SUPERADMIN_CONFIG = {
  email: process.env.SUPERADMIN_EMAIL || 'superadmin@bmdc.gov.ph',
  username: process.env.SUPERADMIN_USERNAME || 'superadmin',
  password: process.env.SUPERADMIN_PASSWORD || 'Admin123',
  role: 'super_admin'
};

console.log('🌱 Superadmin Seeder Started\n');

// Validate environment variables
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:\n');
  console.error('   Required: NEXT_PUBLIC_SUPABASE_URL');
  console.error('   Required: SUPABASE_SERVICE_ROLE_KEY\n');
  console.error('Check your .env file\n');
  process.exit(1);
}

// Create Supabase client with service role key (bypasses RLS)
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function seedSuperadmin() {
  try {
    console.log('📋 Superadmin Configuration:');
    console.log(`   Email: ${SUPERADMIN_CONFIG.email}`);
    console.log(`   Username: ${SUPERADMIN_CONFIG.username}`);
    console.log(`   Role: ${SUPERADMIN_CONFIG.role}\n`);

    // Check if superadmin already exists
    console.log('🔍 Checking if superadmin already exists...');
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id, email, username, role')
      .eq('email', SUPERADMIN_CONFIG.email)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      throw new Error(`Failed to check for existing superadmin: ${checkError.message}`);
    }

    if (existingUser) {
      console.log(`⚠️  Superadmin account already exists:`);
      console.log(`   ID: ${existingUser.id}`);
      console.log(`   Email: ${existingUser.email}`);
      console.log(`   Username: ${existingUser.username}`);
      console.log(`   Role: ${existingUser.role}\n`);
      console.log('✅ No action needed. Exiting.\n');
      return;
    }

    console.log('✅ Superadmin does not exist. Creating new account...\n');

    // Hash the password using bcryptjs
    console.log('🔐 Hashing password with bcryptjs...');
    const passwordHash = bcryptjs.hashSync(SUPERADMIN_CONFIG.password, 10);
    console.log('✅ Password hashed successfully\n');

    // Create the superadmin user
    console.log('👤 Creating superadmin user...');
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        email: SUPERADMIN_CONFIG.email,
        username: SUPERADMIN_CONFIG.username,
        password_hash: passwordHash,
        role: SUPERADMIN_CONFIG.role,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select();

    if (createError) {
      throw new Error(`Failed to create superadmin: ${createError.message}`);
    }

    if (!newUser || newUser.length === 0) {
      throw new Error('Superadmin creation returned no data');
    }

    const createdUser = newUser[0];
    console.log('✅ Superadmin user created successfully!\n');

    // Display credentials
    console.log('═'.repeat(60));
    console.log('✨ SUPERADMIN ACCOUNT CREATED');
    console.log('═'.repeat(60));
    console.log('\n📝 Login Credentials:');
    console.log(`   Email:    ${SUPERADMIN_CONFIG.email}`);
    console.log(`   Username: ${SUPERADMIN_CONFIG.username}`);
    console.log(`   Password: ${SUPERADMIN_CONFIG.password}`);
    console.log(`   Role:     ${SUPERADMIN_CONFIG.role}`);
    console.log(`\n   User ID: ${createdUser.id}`);
    console.log(`   Created: ${createdUser.created_at}`);
    console.log('\n⚠️  SECURITY REMINDER:');
    console.log('   1. ⚠️  CHANGE THIS PASSWORD IMMEDIATELY after first login');
    console.log('   2. ⚠️  Store these credentials securely (password manager, vault)');
    console.log('   3. ⚠️  Do NOT commit credentials to version control');
    console.log('   4. ⚠️  Do NOT share credentials with unauthorized personnel');
    console.log('\n' + '═'.repeat(60) + '\n');

    // Verify the created user
    console.log('🔍 Verifying created user...');
    const { data: verifyUser, error: verifyError } = await supabase
      .from('users')
      .select('id, email, username, role, created_at, updated_at')
      .eq('id', createdUser.id)
      .single();

    if (verifyError) {
      throw new Error(`Verification failed: ${verifyError.message}`);
    }

    console.log('✅ Verification successful:');
    console.log(`   ID:       ${verifyUser.id}`);
    console.log(`   Email:    ${verifyUser.email}`);
    console.log(`   Username: ${verifyUser.username}`);
    console.log(`   Role:     ${verifyUser.role}`);
    console.log(`   Created:  ${verifyUser.created_at}`);
    console.log(`   Updated:  ${verifyUser.updated_at}\n`);

    // Show all admin users in the system
    console.log('👥 All admin users in the system:');
    const { data: allAdmins, error: adminsError } = await supabase
      .from('users')
      .select('id, email, username, role, created_at')
      .in('role', ['super_admin', 'local_admin']);

    if (!adminsError && allAdmins) {
      allAdmins.forEach(admin => {
        const roleLabel = admin.role === 'super_admin' ? '👑 SUPER_ADMIN' : '👨‍💼 LOCAL_ADMIN';
        console.log(`   ${roleLabel}: ${admin.email} (${admin.username})`);
      });
    }

    console.log('\n✨ Seeding completed successfully!\n');

  } catch (error) {
    console.error('❌ Error during seeding:');
    console.error(`   ${error.message}\n`);
    process.exit(1);
  }
}

// Run the seeding
seedSuperadmin();
