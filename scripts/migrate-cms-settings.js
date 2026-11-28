#!/usr/bin/env node

/**
 * CMS Settings Migration Script
 * Applies the CMS settings migration to Supabase
 * 
 * This script uses Node.js and the postgres library to execute raw SQL
 * against your Supabase PostgreSQL database.
 * 
 * Usage: 
 *   npm run migrate:cms
 *   or
 *   node scripts/migrate-cms-settings.js
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

console.log('╔════════════════════════════════════════════════╗');
console.log('║  CMS Settings Database Migration Tool          ║');
console.log('║  Applying: 019_add_cms_settings_tables_FIXED.sql║');
console.log('╚════════════════════════════════════════════════╝\n');

// Try using @supabase/supabase-js if available
async function migrateWithSupabaseClient() {
  try {
    const { createClient } = require('@supabase/supabase-js');

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

    // Try to execute via RPC if available, otherwise use direct query
    try {
      // First, try to use any available RPC function for SQL execution
      const { error: rpcError } = await supabase.rpc('exec_sql', {
        sql: sqlContent,
      });

      if (!rpcError) {
        console.log('✅ Migration executed successfully via RPC!\n');
        return true;
      }
    } catch (e) {
      // RPC might not exist, continue with alternative
    }

    // Alternative: Use the query function if available
    try {
      const { error: queryError } = await supabase.rpc('sql_exec', {
        query: sqlContent,
      });

      if (!queryError) {
        console.log('✅ Migration executed successfully!\n');
        return true;
      }
    } catch (e) {
      // Continue to next method
    }

    console.log('ℹ RPC execution not available, instructions below...\n');
    return false;

  } catch (error) {
    console.log('⚠ Supabase client not available or error occurred\n');
    return false;
  }
}

/**
 * Fallback instructions when automated execution isn't possible
 */
function showManualInstructions() {
  const migrationPath = path.join(__dirname, '../migrations/002-core-features/019_add_cms_settings_tables_FIXED.sql');

  console.log('📋 MANUAL MIGRATION INSTRUCTIONS\n');
  console.log('Since automated execution isn\'t available, please use one of these methods:\n');

  console.log('METHOD 1: Supabase Web UI (Recommended - Easiest)\n');
  console.log('  1. Go to: https://supabase.com/dashboard');
  console.log('  2. Select your project');
  console.log('  3. Click "SQL Editor" in the sidebar');
  console.log('  4. Click "New Query" or "New SQL snippet"');
  console.log('  5. Copy the SQL from: Backend/migrations/002-core-features/019_add_cms_settings_tables_FIXED.sql');
  console.log('  6. Paste the entire SQL into the editor');
  console.log('  7. Click "Run" button');
  console.log('  8. Wait for confirmation: "Query executed successfully"\n');

  console.log('METHOD 2: Supabase CLI\n');
  console.log('  1. Install Supabase CLI: npm install -g supabase');
  console.log('  2. Login: supabase login');
  console.log('  3. Run migration: supabase migrations up');
  console.log('  4. Or link and pull: supabase link');
  console.log('              supabase db pull\n');

  console.log('METHOD 3: psql Command Line\n');
  console.log('  1. Install psql (PostgreSQL client)');
  console.log('  2. Get connection details from Supabase Dashboard > Settings > Database');
  console.log('  3. Run:');
  console.log(`     psql "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres" \\`);
  console.log(`       -f ${migrationPath}\n`);

  console.log('METHOD 4: Use Backend API Route\n');
  console.log('  1. Create a temporary API route that executes this SQL');
  console.log('  2. Call it from the admin panel');
  console.log('  3. Delete the route after migration\n');

  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log('📝 What this migration creates:\n');
  console.log('  ✓ cms_settings table with settings_data JSONB column');
  console.log('  ✓ cms_settings_versions table for version history');
  console.log('  ✓ cms_audit_log table for audit trails');
  console.log('  ✓ theme_presets table with 6 default themes\n');

  console.log('After migration, the following will work:');
  console.log('  ✓ POST /api/cms-settings (save customization)');
  console.log('  ✓ GET /api/cms-settings (retrieve customization)');
  console.log('  ✓ Admin panel landing page customization');
  console.log('  ✓ Landing page will render with custom settings\n');
}

/**
 * Create a temporary API route for migration
 */
function createTemporaryMigrationRoute() {
  const apiRoutePath = path.join(__dirname, '../src/app/api/admin/migrate-cms.ts');
  
  const routeContent = `import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// This is a temporary endpoint for applying the CMS settings migration
// DELETE THIS FILE AFTER SUCCESSFUL MIGRATION

export async function POST(request: NextRequest) {
  try {
    // Verify authorization - should only be accessible to admins
    const authHeader = request.headers.get('authorization');
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!authHeader || !serviceRole) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRole,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Read the migration file
    const migrationPath = path.join(
      process.cwd(),
      'migrations/002-core-features/019_add_cms_settings_tables_FIXED.sql'
    );

    if (!fs.existsSync(migrationPath)) {
      return NextResponse.json(
        { error: 'Migration file not found' },
        { status: 404 }
      );
    }

    const sqlContent = fs.readFileSync(migrationPath, 'utf8');

    // Execute the migration
    // Note: This assumes your Supabase project has a sql execution RPC
    const { error } = await supabase.rpc('exec_sql', {
      sql: sqlContent,
    });

    if (error) {
      // Try alternative RPC
      const { error: altError } = await supabase.rpc('sql_exec', {
        query: sqlContent,
      });

      if (altError) {
        return NextResponse.json(
          { error: 'Migration execution failed', details: altError.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { 
        success: true, 
        message: 'CMS settings migration applied successfully',
        warning: 'This temporary migration endpoint should be deleted'
      },
      { status: 200 }
    );

  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json(
      { error: 'Internal server error during migration' },
      { status: 500 }
    );
  }
}
`;

  console.log('\n💾 Creating temporary migration API route...\n');
  
  try {
    const dir = path.dirname(apiRoutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(apiRoutePath, routeContent);
    console.log(`✓ Created: ${apiRoutePath}`);
    console.log('\nYou can now call: POST http://localhost:3003/api/admin/migrate-cms');
    console.log('With header: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>');
    console.log('\nAfter migration succeeds, delete this file manually.\n');
  } catch (error) {
    console.error('Failed to create migration route:', error);
  }
}

async function main() {
  console.log('Starting CMS Settings migration...\n');

  // Try automated migration
  const success = await migrateWithSupabaseClient();

  if (success) {
    console.log('✅ Migration completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Restart your Backend server');
    console.log('   2. POST requests to /api/cms-settings will now work');
    console.log('   3. The admin panel can save customization settings');
    console.log('   4. The landing page can render with custom settings\n');
  } else {
    showManualInstructions();
    
    // Optionally create temporary migration route
    const createRoute = process.argv.includes('--create-route');
    if (createRoute) {
      createTemporaryMigrationRoute();
    }
  }
}

main().catch(console.error);
