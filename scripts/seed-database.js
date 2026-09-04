#!/usr/bin/env node

/**
 * Database seeding script for Supabase
 * Run with: node scripts/seed-database.js or npm run seed
 */

// Check if dependencies are installed
try {
  require('dotenv').config();
} catch (err) {
  console.log('❌ Dependencies not installed!\n');
  console.log('Please run: npm install\n');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');

let createClient;
try {
  createClient = require('@supabase/supabase-js').createClient;
} catch (err) {
  console.log('❌ Supabase package not installed!\n');
  console.log('Please run: npm install\n');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🌱 Starting Database Seeding Process...\n');

// Check environment variables
if (!supabaseUrl || !supabaseServiceKey) {
  console.log('❌ Missing required environment variables!\n');
  console.log('Make sure you have:');
  console.log('  - NEXT_PUBLIC_SUPABASE_URL');
  console.log('  - SUPABASE_SERVICE_ROLE_KEY');
  console.log('\nCheck your .env.local file\n');
  process.exit(1);
}

// Create Supabase client with service role key (bypasses RLS)
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function seedDatabase() {
  try {
    console.log('📖 Reading seed.sql file...');
    const seedFilePath = path.join(__dirname, '../database/seed.sql');
    const seedSQL = fs.readFileSync(seedFilePath, 'utf8');

    console.log('✅ Seed file loaded\n');

    // Split SQL into individual statements (simple split on semicolons)
    // Skip empty statements
    const statements = seedSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log(`📝 Found ${statements.length} SQL statements to execute\n`);

    let successCount = 0;
    let errorCount = 0;

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Get a short description of the statement for logging
      const firstLine = statement.split('\n')[0].substring(0, 60);
      
      try {
        console.log(`[${i + 1}/${statements.length}] Executing: ${firstLine}...`);
        
        const { data, error } = await supabase.rpc('exec_sql', { 
          sql: statement 
        });

        if (error) {
          // Try direct execution as fallback
          const { error: directError } = await supabase
            .from('_direct_sql')
            .insert({ query: statement });

          if (directError) {
            // If both methods fail, we need to use the SQL editor in Supabase dashboard
            console.log(`   ⚠️  Cannot execute via RPC (expected - will use schema/policies)`);
            errorCount++;
          } else {
            console.log(`   ✅ Success`);
            successCount++;
          }
        } else {
          console.log(`   ✅ Success`);
          successCount++;
        }
      } catch (err) {
        console.log(`   ⚠️  Skipped: ${err.message}`);
        errorCount++;
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 Seeding Summary:');
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ⚠️  Skipped/Errors: ${errorCount}`);
    console.log('='.repeat(50) + '\n');

    // Since direct SQL execution via API is limited, provide instructions
    if (errorCount > 0) {
      console.log('⚠️  Note: Some statements could not be executed via API.');
      console.log('   This is normal - Supabase restricts direct SQL execution via client API.\n');
      console.log('📋 To complete seeding:');
      console.log('   1. Go to your Supabase Dashboard');
      console.log('   2. Navigate to SQL Editor');
      console.log('   3. Copy and paste the contents of database/seed.sql');
      console.log('   4. Click "Run" to execute\n');
      console.log(`   Or run: cat database/seed.sql | supabase db execute\n`);
    } else {
      console.log('✅ Database seeding completed successfully!\n');
    }

    // Verify seeded data
    console.log('🔍 Verifying seeded data...\n');

    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('email, username, role');

    if (!usersError && users) {
      console.log(`✅ Users table: ${users.length} users found`);
      users.forEach(u => console.log(`   - ${u.email} (${u.role})`));
    }

    const { data: programs, error: programsError } = await supabase
      .from('programs')
      .select('name, status');

    if (!programsError && programs) {
      console.log(`\n✅ Programs table: ${programs.length} programs found`);
      programs.forEach(p => console.log(`   - ${p.name} (${p.status})`));
    }

    const { data: items, error: itemsError } = await supabase
      .from('items')
      .select('name, category, quantity');

    if (!itemsError && items) {
      console.log(`\n✅ Items table: ${items.length} items found`);
      items.forEach(i => console.log(`   - ${i.name} (${i.category}) - Qty: ${i.quantity}`));
    }

    console.log('\n✨ Seeding process complete!\n');

  } catch (error) {
    console.error('❌ Error during seeding:', error);
    process.exit(1);
  }
}

// Run the seeding
seedDatabase();
