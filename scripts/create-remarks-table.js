/**
 * Script to create trainee_remarks table
 * Run with: node scripts/create-remarks-table.js
 */

const fs = require('fs');
const path = require('path');

// Read the DATABASE_URL from .env file
const envPath = path.join(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const dbUrlMatch = envContent.match(/(?:DATABASE_URL|SUPABASE_DB_URL)=(.+)/);

if (!dbUrlMatch) {
  console.error('❌ DATABASE_URL or SUPABASE_DB_URL not found in .env file');
  process.exit(1);
}

const DATABASE_URL = dbUrlMatch[1].trim();

console.log('🔄 Creating trainee_remarks table...');
console.log('Database:', DATABASE_URL.replace(/:[^:@]+@/, ':****@')); // Hide password

// SQL to create the table
const sql = `
-- Create trainee_remarks table
CREATE TABLE IF NOT EXISTS trainee_remarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id UUID NOT NULL,
  remark TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  tenant_id UUID NOT NULL,
  
  CONSTRAINT fk_trainee_remarks_trainee 
    FOREIGN KEY (trainee_id) 
    REFERENCES trainees(id) 
    ON DELETE CASCADE,
  
  CONSTRAINT fk_trainee_remarks_creator 
    FOREIGN KEY (created_by) 
    REFERENCES users(id) 
    ON DELETE CASCADE,
  
  CONSTRAINT fk_trainee_remarks_tenant 
    FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) 
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trainee_remarks_trainee_id ON trainee_remarks(trainee_id);
CREATE INDEX IF NOT EXISTS idx_trainee_remarks_tenant_id ON trainee_remarks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_trainee_remarks_created_at ON trainee_remarks(created_at DESC);
`;

// Use fetch to execute SQL via Supabase REST API
const supabaseUrl = DATABASE_URL.match(/https?:\/\/[^\/]+/)?.[0];
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (supabaseUrl && supabaseKey) {
  console.log('Using Supabase REST API...');
  fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`
    },
    body: JSON.stringify({ query: sql })
  })
  .then(res => res.json())
  .then(data => {
    console.log('✅ Table created successfully!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err.message);
    console.log('\n📋 Please run this SQL manually in Supabase SQL Editor:');
    console.log(sql);
    process.exit(1);
  });
} else {
  console.log('\n⚠️  Cannot execute automatically. Please run this SQL in Supabase SQL Editor:\n');
  console.log(sql);
  console.log('\n📝 Steps:');
  console.log('1. Open Supabase Dashboard');
  console.log('2. Go to SQL Editor');
  console.log('3. Copy the SQL above');
  console.log('4. Paste and click "Run"');
  process.exit(0);
}
