/**
 * Fix Training Requirement Files Unique Constraint
 * 
 * This script fixes the UNIQUE constraint on training_requirement_files table
 * to allow re-uploading files by using a partial unique index.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function runMigration() {
  try {
    console.log('🔧 Fixing training_requirement_files unique constraint...\n');

    const migrationPath = path.join(__dirname, '../migrations/011-training-requirement-files/002_fix_unique_constraint.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration SQL:');
    console.log(migrationSQL);
    console.log('\n🚀 Executing migration...\n');

    // Split by semicolon and execute each statement
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.trim()) {
        console.log(`Executing: ${statement.substring(0, 100)}...`);
        const { error } = await supabase.rpc('exec_sql', { sql: statement });
        
        if (error) {
          // Try direct query if RPC doesn't work
          const { error: directError } = await supabase.from('_').select('*').limit(0);
          
          // Since Supabase doesn't support raw SQL via JS SDK easily,
          // we'll use a workaround
          console.log('⚠️  Cannot execute via Supabase JS SDK. Please run manually.');
          console.log('\nManual SQL to run:');
          console.log('=====================================');
          console.log(migrationSQL);
          console.log('=====================================\n');
          console.log('Run this in your Supabase SQL Editor or using psql');
          return;
        }
      }
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\nThe training_requirement_files table now supports re-uploading files.');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('\nPlease run this SQL manually:');
    console.error('=====================================');
    const migrationPath = path.join(__dirname, '../migrations/011-training-requirement-files/002_fix_unique_constraint.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    console.error(migrationSQL);
    console.error('=====================================');
    process.exit(1);
  }
}

runMigration();
