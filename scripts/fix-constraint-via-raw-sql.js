/**
 * Fix the unique constraint using raw SQL
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fix() {
  console.log('🔧 Attempting to fix constraint...\n');
  
  // Try using rpc if available
  const sql = `
    ALTER TABLE training_requirement_files 
      DROP CONSTRAINT IF EXISTS training_requirement_files_tenant_id_trainee_id_requirement_key;
    
    DROP INDEX IF EXISTS idx_training_req_files_unique_active;
    
    CREATE UNIQUE INDEX idx_training_req_files_unique_active
      ON training_requirement_files(tenant_id, trainee_id, requirement_type)
      WHERE deleted_at IS NULL;
  `;
  
  console.log('SQL to execute:');
  console.log(sql);
  console.log('\n❌ Unfortunately, Supabase JS client cannot execute raw DDL SQL.\n');
  console.log('📋 Please copy the SQL above and run it in Supabase SQL Editor.\n');
  console.log('OR ask someone with Supabase dashboard access to run it.\n');
}

fix();
