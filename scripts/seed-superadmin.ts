#!/usr/bin/env node

/**
 * Superadmin Seeder Script (TypeScript)
 * Creates or updates a superadmin user account
 * Run with: npx ts-node scripts/seed-superadmin.ts
 * 
 * This script:
 * 1. Checks if superadmin already exists
 * 2. Creates superadmin with secure bcryptjs hashing
 * 3. Provides login credentials
 * 4. Logs verification results
 */

import { createClient } from '@supabase/supabase-js';
import * as bcryptjs from 'bcryptjs';
import * as dotenv from 'dotenv';

dotenv.config();

// Types
interface SuperadminConfig {
  email: string;
  username: string;
  password: string;
  role: 'super_admin';
}

interface UserRecord {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  role: 'super_admin' | 'local_admin' | string;
  created_at: string;
  updated_at: string;
}

interface AdminUser {
  id: string;
  email: string;
  username: string;
  role: string;
  created_at: string;
}

// Configuration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SUPERADMIN_CONFIG: SuperadminConfig = {
  email: process.env.SUPERADMIN_EMAIL || 'superadmin@bmdc.gov.ph',
  username: process.env.SUPERADMIN_USERNAME || 'superadmin',
  password: process.env.SUPERADMIN_PASSWORD || 'Admin123',
  role: 'super_admin'
};

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
  const divider = '═'.repeat(60);
  console.log(divider);
  if (title) {
    console.log(title);
    console.log(divider);
  }
}

async function seedSuperadmin(): Promise<void> {
  try {
    log('Superadmin Seeder Started', '🌱');
    console.log();

    // Validate environment variables
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

    log('Superadmin Configuration:', '📋');
    console.log(`   Email: ${SUPERADMIN_CONFIG.email}`);
    console.log(`   Username: ${SUPERADMIN_CONFIG.username}`);
    console.log(`   Role: ${SUPERADMIN_CONFIG.role}\n`);

    // Check if superadmin already exists
    log('Checking if superadmin already exists...', '🔍');
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id, email, username, role')
      .eq('email', SUPERADMIN_CONFIG.email)
      .maybeSingle();

    if (checkError && (checkError as any).code !== 'PGRST116') {
      throw new Error(`Failed to check for existing superadmin: ${checkError.message}`);
    }

    if (existingUser) {
      logWarning('Superadmin account already exists:');
      console.log(`   ID: ${(existingUser as AdminUser).id}`);
      console.log(`   Email: ${(existingUser as AdminUser).email}`);
      console.log(`   Username: ${(existingUser as AdminUser).username}`);
      console.log(`   Role: ${(existingUser as AdminUser).role}\n`);
      logSuccess('No action needed. Exiting.\n');
      return;
    }

    logSuccess('Superadmin does not exist. Creating new account...\n');

    // Hash the password using bcryptjs
    log('Hashing password with bcryptjs...', '🔐');
    const passwordHash = bcryptjs.hashSync(SUPERADMIN_CONFIG.password, 10);
    logSuccess('Password hashed successfully\n');

    // Create the superadmin user
    log('Creating superadmin user...', '👤');
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

    const createdUser = newUser[0] as UserRecord;
    logSuccess('Superadmin user created successfully!\n');

    // Display credentials
    logDivider('✨ SUPERADMIN ACCOUNT CREATED');
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
    log('Verifying created user...', '🔍');
    const { data: verifyUser, error: verifyError } = await supabase
      .from('users')
      .select('id, email, username, role, created_at, updated_at')
      .eq('id', createdUser.id)
      .single();

    if (verifyError) {
      throw new Error(`Verification failed: ${verifyError.message}`);
    }

    const verified = verifyUser as UserRecord;
    logSuccess('Verification successful:');
    console.log(`   ID:       ${verified.id}`);
    console.log(`   Email:    ${verified.email}`);
    console.log(`   Username: ${verified.username}`);
    console.log(`   Role:     ${verified.role}`);
    console.log(`   Created:  ${verified.created_at}`);
    console.log(`   Updated:  ${verified.updated_at}\n`);

    // Show all admin users in the system
    log('All admin users in the system:', '👥');
    const { data: allAdmins, error: adminsError } = await supabase
      .from('users')
      .select('id, email, username, role, created_at')
      .in('role', ['super_admin', 'local_admin']);

    if (!adminsError && allAdmins) {
      (allAdmins as AdminUser[]).forEach(admin => {
        const roleLabel = admin.role === 'super_admin' ? '👑 SUPER_ADMIN' : '👨‍💼 LOCAL_ADMIN';
        console.log(`   ${roleLabel}: ${admin.email} (${admin.username})`);
      });
    }

    console.log('\n✨ Seeding completed successfully!\n');

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
seedSuperadmin();
