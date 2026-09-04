#!/usr/bin/env node

/**
 * Verification script for Supabase connection and setup
 * Run with: node scripts/verify-supabase.js
 */

// Check if dependencies are installed
try {
  require('dotenv').config();
} catch (err) {
  console.log('❌ Dependencies not installed!\n');
  console.log('Please run: npm install\n');
  console.log('Then try again: npm run verify-supabase\n');
  process.exit(1);
}

let createClient;
try {
  createClient = require('@supabase/supabase-js').createClient;
} catch (err) {
  console.log('❌ Supabase package not installed!\n');
  console.log('Please run: npm install\n');
  console.log('Then try again: npm run verify-supabase\n');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔍 Verifying Supabase Configuration...\n');

// Check environment variables
console.log('1. Checking environment variables...');
const envChecks = {
  'NEXT_PUBLIC_SUPABASE_URL': !!supabaseUrl,
  'NEXT_PUBLIC_SUPABASE_ANON_KEY': !!supabaseAnonKey,
  'SUPABASE_SERVICE_ROLE_KEY': !!supabaseServiceKey,
  'JWT_SECRET': !!process.env.JWT_SECRET,
};

let allEnvVarsPresent = true;
Object.entries(envChecks).forEach(([key, value]) => {
  const status = value ? '✅' : '❌';
  console.log(`   ${status} ${key}: ${value ? 'Set' : 'Missing'}`);
  if (!value) allEnvVarsPresent = false;
});

if (!allEnvVarsPresent) {
  console.log('\n❌ Missing environment variables! Please check your .env file.');
  process.exit(1);
}

console.log('\n2. Validating Supabase credentials...');

// Check if credentials are still placeholder values
if (!supabaseUrl || supabaseUrl === 'your_supabase_url' || !supabaseUrl.startsWith('http')) {
  console.log('   ❌ Invalid NEXT_PUBLIC_SUPABASE_URL');
  console.log('\n⚠️  Your .env file contains placeholder values!\n');
  console.log('To fix this:');
  console.log('1. Go to https://supabase.com and create a project');
  console.log('2. Go to Project Settings → API');
  console.log('3. Copy your Project URL and API keys');
  console.log('4. Update your .env file with real values\n');
  console.log('Example:');
  console.log('NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co');
  console.log('NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...');
  console.log('SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...\n');
  console.log('See QUICKSTART.md for detailed instructions.\n');
  process.exit(1);
}

if (!supabaseAnonKey || supabaseAnonKey.includes('your_supabase') || supabaseAnonKey.length < 100) {
  console.log('   ❌ Invalid NEXT_PUBLIC_SUPABASE_ANON_KEY');
  console.log('\n⚠️  Please update your .env file with real Supabase credentials!\n');
  process.exit(1);
}

if (!supabaseServiceKey || supabaseServiceKey.includes('your_supabase') || supabaseServiceKey.length < 100) {
  console.log('   ❌ Invalid SUPABASE_SERVICE_ROLE_KEY');
  console.log('\n⚠️  Please update your .env file with real Supabase credentials!\n');
  process.exit(1);
}

console.log('   ✅ Credentials format looks valid');

console.log('\n3. Testing Supabase connection...');

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function verifyConnection() {
  try {
    // Test basic connection
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('count', { count: 'exact', head: true });

    if (error) {
      console.log('   ❌ Connection failed:', error.message);
      return false;
    }

    console.log('   ✅ Connection successful!');
    return true;
  } catch (err) {
    console.log('   ❌ Connection error:', err.message);
    return false;
  }
}

async function checkTables() {
  console.log('\n4. Checking database tables...');
  
  const tables = ['users', 'items', 'programs', 'trainees', 'lendings', 'anomalies', 'activity_logs'];
  const results = {};

  for (const table of tables) {
    try {
      const { count, error } = await supabaseAdmin
        .from(table)
        .select('id', { count: 'exact', head: true });

      if (error) {
        console.log(`   ❌ ${table}: ${error.message}`);
        results[table] = { exists: false, count: 0 };
      } else {
        console.log(`   ✅ ${table}: ${count} records`);
        results[table] = { exists: true, count };
      }
    } catch (err) {
      console.log(`   ❌ ${table}: ${err.message}`);
      results[table] = { exists: false, count: 0 };
    }
  }

  return results;
}

async function checkUsers() {
  console.log('\n5. Checking for default users...');
  
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('email, username, role')
      .in('email', ['admin@bmdc.edu.ph', 'inventory@bmdc.edu.ph', 'trainees@bmdc.edu.ph']);

    if (error) {
      console.log('   ❌ Could not fetch users:', error.message);
      return;
    }

    if (data && data.length > 0) {
      console.log('   ✅ Found default users:');
      data.forEach(user => {
        console.log(`      - ${user.email} (${user.role})`);
      });
    } else {
      console.log('   ⚠️  No default users found. Run database/seed.sql to create them.');
    }
  } catch (err) {
    console.log('   ❌ Error checking users:', err.message);
  }
}

async function runVerification() {
  const connected = await verifyConnection();
  
  if (!connected) {
    console.log('\n❌ Verification failed! Please check your Supabase configuration.');
    console.log('\nTroubleshooting:');
    console.log('1. Verify your Supabase URL is correct');
    console.log('2. Check that your API keys are valid');
    console.log('3. Ensure your Supabase project is active');
    console.log('4. Run database/schema.sql in Supabase SQL Editor');
    process.exit(1);
  }

  const tableResults = await checkTables();
  await checkUsers();

  const allTablesExist = Object.values(tableResults).every(t => t.exists);

  console.log('\n' + '='.repeat(50));
  
  if (allTablesExist) {
    console.log('✅ Supabase setup complete and verified!');
    console.log('\nNext steps:');
    console.log('1. Run: npm run dev');
    console.log('2. Test API at: http://localhost:3001');
    console.log('3. Try logging in with admin@bmdc.edu.ph / admin123');
  } else {
    console.log('⚠️  Supabase connection works, but some tables are missing.');
    console.log('\nTo fix this:');
    console.log('1. Open Supabase dashboard');
    console.log('2. Go to SQL Editor');
    console.log('3. Run database/COMPLETE-SETUP.sql');
    console.log('4. This will create all tables and seed data');
    console.log('5. (Optional) Run database/seed.sql');
    console.log('6. Run this script again');
  }
  
  console.log('='.repeat(50) + '\n');
}

runVerification().catch(err => {
  console.error('\n❌ Verification error:', err.message);
  process.exit(1);
});
