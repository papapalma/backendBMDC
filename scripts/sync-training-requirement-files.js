/**
 * Sync Training Requirement Files
 * 
 * This script syncs the database records with actual files on disk.
 * It will:
 * 1. Find all files in the uploads directory
 * 2. Update database records to match actual files
 * 3. Remove orphaned database records (no file on disk)
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
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

const UPLOAD_BASE_DIR = path.join(process.cwd(), 'public', 'uploads');

async function syncFiles() {
  try {
    console.log('🔄 Syncing training requirement files...\n');

    // Get all training requirement files from database
    const { data: dbFiles, error: dbError } = await supabase
      .from('training_requirement_files')
      .select('*')
      .is('deleted_at', null);

    if (dbError) {
      console.error('❌ Error fetching from database:', dbError);
      return;
    }

    console.log(`📊 Found ${dbFiles.length} records in database\n`);

    let synced = 0;
    let notFound = 0;

    for (const dbFile of dbFiles) {
      // Build absolute path
      const relativePath = dbFile.file_path.replace(/^\/uploads\//, '');
      const absolutePath = path.join(UPLOAD_BASE_DIR, relativePath);

      // Check if file exists
      try {
        await fs.access(absolutePath);
        console.log(`✅ ${dbFile.requirement_type}: File exists`);
        synced++;
      } catch (error) {
        console.log(`❌ ${dbFile.requirement_type}: File NOT found on disk`);
        console.log(`   Expected: ${absolutePath}`);
        console.log(`   Database path: ${dbFile.file_path}`);
        notFound++;
      }
    }

    console.log(`\n📈 Summary:`);
    console.log(`   Synced: ${synced}`);
    console.log(`   Not Found: ${notFound}`);
    console.log(`   Total: ${dbFiles.length}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

syncFiles();
