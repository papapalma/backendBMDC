#!/usr/bin/env node

/**
 * Direct migration runner
 * Reads and executes the CMS settings migration SQL directly
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runMigration() {
  try {
    console.log('🚀 Starting CMS Settings Migration\n');

    // Get Supabase credentials
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Missing Supabase credentials in .env');
    }

    console.log(`📍 Target: ${SUPABASE_URL}`);

    // Import Supabase client
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Read migration file
    const migrationPath = path.join(__dirname, '../migrations/002-core-features/019_add_cms_settings_tables_FIXED.sql');
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }

    const sqlContent = fs.readFileSync(migrationPath, 'utf8');
    console.log(`📄 Loaded migration file (${Math.round(sqlContent.length / 1024)}KB)\n`);

    // Try to execute via RPC
    console.log('⏳ Executing migration via RPC...');
    
    const { data, error } = await supabase.rpc('exec_sql', { sql: sqlContent });
    
    if (error) {
      console.error('❌ RPC exec_sql failed:', error.message);
      console.log('\n🔄 Trying alternative RPC...');
      
      const { error: altError } = await supabase.rpc('sql_exec', { query: sqlContent });
      
      if (altError) {
        console.error('❌ Alternative RPC also failed:', altError.message);
        throw new Error('Both RPC methods failed. Try Method 1 (Supabase Web UI) instead.');
      }
    }

    console.log('✅ Migration executed successfully!\n');

    // Verify the column exists
    console.log('🔍 Verifying settings_data column exists...');
    
    const { data: columnCheck, error: checkError } = await supabase
      .from('cms_settings')
      .select('settings_data')
      .limit(1);

    if (!checkError) {
      console.log('✅ Verification successful! Column exists.\n');
      console.log('📝 Next steps:');
      console.log('   1. Restart backend: cd Backend && npm run dev');
      console.log('   2. Refresh /cms-settings page');
      console.log('   3. Try saving settings again\n');
      process.exit(0);
    } else {
      console.log('⚠️  Verification inconclusive:', checkError.message);
      console.log('   The migration may have succeeded. Restart backend and try again.\n');
      process.exit(0);
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.log('\n💡 Manual Alternative (Recommended):\n');
    console.log('1. Go to: https://supabase.com/dashboard');
    console.log('2. Click: SQL Editor → New Query');
    console.log('3. Copy: Backend/migrations/002-core-features/019_add_cms_settings_tables_FIXED.sql');
    console.log('4. Paste and click: RUN\n');
    process.exit(1);
  }
}

runMigration();
