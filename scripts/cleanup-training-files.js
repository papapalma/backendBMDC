/**
 * Cleanup Training Requirement Files
 * 
 * This script will:
 * 1. Show all files in database for a trainee
 * 2. Soft-delete all old files
 * 3. Keep only the LATEST file for each requirement type
 */

const { createClient } = require('@supabase/supabase-js');
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

const TRAINEE_ID = '6ffc9ceb-22ac-4413-a2c6-d1bcbe728d4a';

async function cleanup() {
  try {
    console.log('🔍 Checking training requirement files...\n');

    // Get ALL files for this trainee (including soft-deleted)
    const { data: allFiles, error: fetchError } = await supabase
      .from('training_requirement_files')
      .select('*')
      .eq('trainee_id', TRAINEE_ID)
      .order('requirement_type')
      .order('uploaded_at', { ascending: false });

    if (fetchError) {
      console.error('❌ Error fetching files:', fetchError);
      return;
    }

    console.log(`📊 Found ${allFiles.length} total records\n`);

    // Group by requirement type
    const byType = {};
    allFiles.forEach(file => {
      if (!byType[file.requirement_type]) {
        byType[file.requirement_type] = [];
      }
      byType[file.requirement_type].push(file);
    });

    console.log('📁 Files by type:\n');
    for (const [type, files] of Object.entries(byType)) {
      console.log(`  ${type}:`);
      files.forEach((file, index) => {
        const status = file.deleted_at ? '❌ DELETED' : '✅ ACTIVE';
        const isLatest = index === 0 ? '🌟 LATEST' : '';
        console.log(`    ${status} ${isLatest}`);
        console.log(`       File: ${file.file_name}`);
        console.log(`       Uploaded: ${new Date(file.uploaded_at).toLocaleString()}`);
        if (file.deleted_at) {
          console.log(`       Deleted: ${new Date(file.deleted_at).toLocaleString()}`);
        }
        console.log();
      });
    }

    // Count active vs deleted
    const active = allFiles.filter(f => !f.deleted_at);
    const deleted = allFiles.filter(f => f.deleted_at);

    console.log(`\n📈 Summary:`);
    console.log(`   Active: ${active.length}`);
    console.log(`   Deleted: ${deleted.length}`);
    console.log(`   Total: ${allFiles.length}\n`);

    // Prompt to cleanup
    console.log('🧹 Starting cleanup...\n');

    // Step 1: Soft delete ALL files
    const { error: deleteAllError } = await supabase
      .from('training_requirement_files')
      .update({ deleted_at: new Date().toISOString() })
      .eq('trainee_id', TRAINEE_ID)
      .is('deleted_at', null);

    if (deleteAllError) {
      console.error('❌ Error deleting files:', deleteAllError);
      return;
    }

    console.log('✅ Step 1: Soft-deleted all files\n');

    // Step 2: Find the LATEST file for each requirement type
    const latestFiles = {};
    for (const [type, files] of Object.entries(byType)) {
      // Sort by uploaded_at DESC to get the latest
      const sorted = files.sort((a, b) => 
        new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
      );
      latestFiles[type] = sorted[0];
    }

    console.log('🌟 Keeping these files:\n');
    for (const [type, file] of Object.entries(latestFiles)) {
      console.log(`  ${type}:`);
      console.log(`     ${file.file_name}`);
      console.log(`     Uploaded: ${new Date(file.uploaded_at).toLocaleString()}\n`);

      // Restore this file (set deleted_at to null)
      const { error: restoreError } = await supabase
        .from('training_requirement_files')
        .update({ deleted_at: null })
        .eq('id', file.id);

      if (restoreError) {
        console.error(`❌ Error restoring ${type}:`, restoreError);
      }
    }

    console.log('\n✅ Cleanup complete!\n');

    // Verify final state
    const { data: finalFiles, error: finalError } = await supabase
      .from('training_requirement_files')
      .select('requirement_type, file_name, uploaded_at')
      .eq('trainee_id', TRAINEE_ID)
      .is('deleted_at', null)
      .order('requirement_type');

    if (finalError) {
      console.error('❌ Error verifying:', finalError);
      return;
    }

    console.log('✅ Final active files:\n');
    finalFiles.forEach(file => {
      console.log(`  ✓ ${file.requirement_type}: ${file.file_name}`);
    });

    console.log('\n🎉 Done! Refresh the trainee edit page to see the changes.\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

cleanup();
