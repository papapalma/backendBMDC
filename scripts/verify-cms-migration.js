#!/usr/bin/env node

/**
 * CMS Migration Verification Script
 * Checks if the CMS settings migration has been applied to Supabase
 * 
 * Usage:
 *   npm run verify:cms-migration
 *   or
 *   node scripts/verify-cms-migration.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

async function verifyCMSMigration() {
  try {
    const { createClient } = require('@supabase/supabase-js');

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  CMS Settings Migration Verification            ║');
    console.log('╚════════════════════════════════════════════════╝\n');

    console.log(`📦 Target: ${SUPABASE_URL}\n`);
    console.log('🔍 Checking for CMS tables...\n');

    const tables = [
      'cms_settings',
      'cms_settings_versions',
      'cms_audit_log',
      'theme_presets'
    ];

    let allTablesExist = true;

    for (const table of tables) {
      try {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .limit(1);

        if (error && error.code === 'PGRST116') {
          console.log(`❌ Table NOT found: ${table}`);
          allTablesExist = false;
        } else if (error) {
          console.log(`⚠  Table ${table}: ${error.message}`);
        } else {
          console.log(`✅ Table exists: ${table}`);
        }
      } catch (e) {
        console.log(`❌ Cannot query table: ${table}`);
        allTablesExist = false;
      }
    }

    console.log('\n🔍 Checking for settings_data column...\n');

    try {
      // Try to query with settings_data
      const { data, error } = await supabase
        .from('cms_settings')
        .select('settings_data')
        .limit(1);

      if (error) {
        if (error.message.includes('settings_data')) {
          console.log('❌ settings_data column NOT found in cms_settings');
          allTablesExist = false;
        } else {
          console.log(`⚠  Query error: ${error.message}`);
        }
      } else {
        console.log('✅ settings_data column exists in cms_settings');
      }
    } catch (e) {
      console.log(`⚠  Cannot verify settings_data column: ${e.message}`);
    }

    console.log('\n🔍 Checking for theme_presets data...\n');

    try {
      const { data, count, error } = await supabase
        .from('theme_presets')
        .select('*', { count: 'exact' });

      if (!error && data) {
        console.log(`✅ Theme presets found: ${data.length} presets`);
        if (data.length > 0) {
          data.forEach((preset, index) => {
            console.log(`   ${index + 1}. ${preset.name}`);
          });
        }
      } else if (error) {
        console.log(`⚠  Cannot query theme_presets: ${error.message}`);
      }
    } catch (e) {
      console.log(`⚠  Cannot verify theme presets: ${e.message}`);
    }

    console.log('\n═══════════════════════════════════════════════════\n');

    if (allTablesExist) {
      console.log('✅ MIGRATION SUCCESSFUL!\n');
      console.log('All CMS tables have been created and are accessible.');
      console.log('You can now:');
      console.log('  • POST /api/cms-settings - Save customization');
      console.log('  • GET /api/cms-settings - Retrieve customization');
      console.log('  • Use admin panel landing page customization');
      console.log('\n📝 Next step: Restart the backend server\n');
      process.exit(0);
    } else {
      console.log('❌ MIGRATION NOT COMPLETE\n');
      console.log('Some CMS tables are missing. Please run the migration:');
      console.log('  npm run migrate:cms\n');
      console.log('Or apply manually via Supabase Web UI:\n');
      console.log('  1. Go to: https://supabase.com/dashboard');
      console.log('  2. Select your project');
      console.log('  3. SQL Editor > New Query');
      console.log('  4. Copy & paste: Backend/migrations/002-core-features/019_add_cms_settings_tables_FIXED.sql');
      console.log('  5. Click Run\n');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    console.log('\n📝 Make sure:');
    console.log('  • NEXT_PUBLIC_SUPABASE_URL is set in .env');
    console.log('  • SUPABASE_SERVICE_ROLE_KEY is set in .env');
    console.log('  • You have internet connection to Supabase\n');
    process.exit(1);
  }
}

verifyCMSMigration();
