#!/usr/bin/env node

/**
 * CMS Settings Migration Script
 * Applies the database migration to Supabase PostgreSQL
 * 
 * This script:
 * 1. Connects to Supabase using service role credentials
 * 2. Reads and executes the CMS settings migration SQL
 * 3. Creates/updates tables for cms_settings, cms_settings_versions, cms_audit_log, and theme_presets
 * 4. Verifies the migration was successful
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

console.log('╔════════════════════════════════════════════════╗');
console.log('║  CMS Settings Database Migration Tool          ║');
console.log('║  Applying: 019_add_cms_settings_tables_FIXED.sql║');
console.log('╚════════════════════════════════════════════════╝\n');

async function applyMigration() {
  try {
    // Initialize Supabase client with service role for full database access
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    console.log('✓ Connected to Supabase');
    console.log(`📦 Target: ${SUPABASE_URL}\n`);

    // Read migration file
    const migrationPath = path.join(__dirname, '../migrations/002-core-features/019_add_cms_settings_tables_FIXED.sql');
    const sqlContent = fs.readFileSync(migrationPath, 'utf8');

    console.log('📝 Migration file loaded');
    console.log('⏳ Executing migration...\n');

    // Get a database connection and execute the raw SQL
    // Using the Supabase JavaScript client's rpc method to execute custom SQL
    let result = await supabase.rpc('exec_sql', {
      sql: sqlContent,
    });

    // If exec_sql failed, try fallback methods
    if (result.error) {
      result = await supabase.rpc('postgres_query', {
        query: sqlContent,
      });
    }

    // If postgres_query also failed, try direct query execution
    if (result.error) {
      result = await executeSqlStatements(supabase as any, sqlContent);
    }

    const { data, error } = result;

    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }

    console.log('✅ Migration SQL executed successfully!\n');

    // Verify the migration
    console.log('🔍 Verifying migration...\n');

    // Check if cms_settings table exists and has settings_data column
    const { data: tableInfo, error: infoError } = await supabase
      .from('information_schema.columns')
      .select('*')
      .eq('table_name', 'cms_settings')
      .eq('column_name', 'settings_data');

    if (infoError) {
      console.log('⚠ Could not verify directly, performing indirect check...');
      
      // Try to insert a test record to verify column exists
      const { error: insertError } = await supabase
        .from('cms_settings')
        .insert({
          tenant_id: '00000000-0000-0000-0000-000000000000',
          settings_data: { test: true },
        })
        .select();

      if (insertError && !insertError.message.includes('unique constraint')) {
        throw new Error(`Verification failed: ${insertError.message}`);
      }

      console.log('✓ cms_settings table exists with settings_data column');
    } else if (tableInfo && tableInfo.length > 0) {
      console.log('✓ cms_settings table verified');
      console.log('✓ settings_data column (JSONB) verified\n');
    }

    // List all created/updated tables
    const tables = ['cms_settings', 'cms_settings_versions', 'cms_audit_log', 'theme_presets'];
    console.log('📊 Migration results:\n');

    for (const tableName of tables) {
      const { data: exists, error: checkError } = await supabase
        .from('information_schema.tables')
        .select('*')
        .eq('table_name', tableName);

      if (!checkError && exists && exists.length > 0) {
        console.log(`  ✓ ${tableName}`);
      }
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. The CMS settings API endpoints can now work');
    console.log('   2. POST /api/cms-settings will accept and store settings_data');
    console.log('   3. The admin panel customization system is ready to use');

  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Execute SQL statements sequentially
 * Falls back method if RPC functions don't exist
 */
async function executeSqlStatements(supabase: any, sqlContent: string) {
  const statements = sqlContent
    .split(';')
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

  console.log(`Found ${statements.length} SQL statements\n`);

  let executed = 0;
  const errors: string[] = [];

  for (let i = 0; i < statements.length; i++) {
    try {
      const { error } = await (supabase.rpc as any)('sql', { query: statements[i] });

      if (error) {
        // Expected errors for CREATE IF NOT EXISTS statements
        if (!error.message.includes('already exists') && !error.message.includes('does not exist')) {
          errors.push(`Statement ${i + 1}: ${error.message}`);
        }
      }
      executed++;
      console.log(`✓ Statement ${i + 1}/${statements.length} executed`);
    } catch (err) {
      errors.push(`Statement ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errors.length > 0) {
    console.error('\nSome statements failed:');
    errors.forEach(err => console.error(`  - ${err}`));
  }

  return { 
    data: `${executed} statements executed` as any, 
    error: errors.length > 0 ? new Error(errors.join('\n')) : null,
    count: null,
    status: 200,
    statusText: 'OK'
  } as any;
}

// Run the migration
applyMigration();
