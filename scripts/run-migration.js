#!/usr/bin/env node

/**
 * Migration runner - applies SQL migrations to the database via Supabase SQL Editor
 * Usage: node scripts/run-migration.js [migration-file]
 * Example: node scripts/run-migration.js migrations/002-core-features/021_add_deleted_at_to_programs.sql
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in environment variables');
  console.error('   NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? '✓' : '✗');
  process.exit(1);
}

const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('❌ No migration file specified');
  console.error('Usage: node scripts/run-migration.js [migration-file]');
  console.error('Example: node scripts/run-migration.js migrations/002-core-features/021_add_deleted_at_to_programs.sql');
  process.exit(1);
}

const fullPath = path.resolve(migrationFile);

if (!fs.existsSync(fullPath)) {
  console.error(`❌ Migration file not found: ${fullPath}`);
  process.exit(1);
}

async function runMigration() {
  try {
    console.log(`🚀 Applying migration: ${migrationFile}\n`);
    
    const sqlContent = fs.readFileSync(fullPath, 'utf-8');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Split SQL into individual statements
    const statements = sqlContent
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--'));
    
    console.log(`📋 Found ${statements.length} SQL statement(s)\n`);
    
    let executed = 0;
    for (const statement of statements) {
      try {
        console.log(`⏳ Executing: ${statement.substring(0, 70).replace(/\n/g, ' ')}...`);
        
        // Use rpc to execute - this requires postgres_write permission
        const { error } = await supabase.rpc('exec_sql', { sql_string: statement });
        
        if (error && error.code !== 'PGRST204') { // PGRST204 is expected for DDL
          throw error;
        }
        
        console.log(`   ✅ Success\n`);
        executed++;
      } catch (e) {
        // Check if it's a known error that's actually OK
        if (e.message && e.message.includes('already exists')) {
          console.log(`   ⚠️  ${e.message}\n`);
          executed++;
        } else {
          throw e;
        }
      }
    }

    console.log(`✅ Migration completed! (${executed}/${statements.length} statements executed)`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    console.error('\n📝 To apply this migration manually via Supabase SQL Editor:');
    console.error('   1. Open Supabase Dashboard: https://app.supabase.com');
    console.error('   2. Go to SQL Editor (left sidebar)');
    console.error('   3. Click "New Query"');
    console.error(`   4. Copy-paste the contents of: ${fullPath}`);
    console.error('   5. Click "Run"');
    console.error('\n💡 Alternatively, if you have direct database access, you can run:');
    console.error(`   psql $DATABASE_URL -f ${fullPath}`);
    process.exit(1);
  }
}

runMigration();
