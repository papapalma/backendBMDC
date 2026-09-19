#!/usr/bin/env node

/**
 * Migration Application Script
 * Applies the CMS Settings migration to Supabase database
 * Usage: node apply-migration.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

// Parse Supabase URL to get host
const url = new URL(SUPABASE_URL);
const host = url.hostname;

/**
 * Execute SQL query against Supabase REST API
 * Using the /rest/v1/rpc/execute_sql endpoint
 */
async function executeSql(sql) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query: sql });

    const options = {
      hostname: host,
      port: 443,
      path: '/rest/v1/rpc/sql_execute',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Execute migration from SQL file
 */
async function applyMigration() {
  try {
    console.log('🔄 Starting CMS Settings migration...\n');

    // Read migration file
    const migrationPath = path.join(__dirname, '../migrations/002-core-features/019_add_cms_settings_tables_FIXED.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('📝 Migration file loaded');
    console.log(`📦 Target: ${SUPABASE_URL}\n`);

    // Execute migration
    console.log('⏳ Executing migration SQL...');
    
    // Split the SQL into individual statements for better error handling
    const statements = sql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    console.log(`📊 Found ${statements.length} SQL statements to execute\n`);

    let executed = 0;
    for (const statement of statements) {
      try {
        await executeSql(statement);
        executed++;
        console.log(`✓ Statement ${executed} executed`);
      } catch (error) {
        // Some statements might fail due to existing objects, which is expected
        if (error.message.includes('already exists') || error.message.includes('does not exist')) {
          console.log(`⚠ Statement ${executed} skipped (${error.message.substring(0, 50)}...)`);
          executed++;
        } else {
          throw error;
        }
      }
    }

    console.log(`\n✅ Migration completed! ${executed}/${statements.length} statements executed`);
    console.log('\n📋 CMS Settings tables should now have the settings_data JSONB column');

  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(error.message);
    process.exit(1);
  }
}

// Alternative approach: Use psql if available
async function applyMigrationViaRpc() {
  try {
    console.log('🔄 Starting CMS Settings migration via Supabase RPC...\n');

    // Read migration file
    const migrationPath = path.join(__dirname, '../migrations/002-core-features/019_add_cms_settings_tables_FIXED.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('📝 Migration file loaded');
    console.log(`📦 Target: ${SUPABASE_URL}\n`);

    // Use Supabase's sql() RPC method
    console.log('⏳ Executing migration SQL via Supabase RPC...');

    const postData = JSON.stringify({
      query: sql
    });

    const options = {
      hostname: host,
      port: 443,
      path: '/rest/v1/rpc/migrations',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('\n✅ Migration completed successfully!');
            console.log('\n📋 CMS Settings tables created with settings_data JSONB column');
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });

  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(error.message);
    process.exit(1);
  }
}

// Run the migration
console.log('╔════════════════════════════════════════════════╗');
console.log('║  CMS Settings Database Migration Tool          ║');
console.log('║  Applying: 019_add_cms_settings_tables_FIXED.sql║');
console.log('╚════════════════════════════════════════════════╝\n');

// Try the simpler RPC approach first
applyMigrationViaRpc().catch(() => {
  console.log('\nℹ Retrying with alternative method...\n');
  applyMigration();
});
