/**
 * Delete Old Training Files One by One
 * 
 * Since we can't soft-delete in bulk due to unique constraint,
 * we'll delete old files one by one, keeping only the latest.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const TRAINEE_ID = '6ffc9ceb-22ac-4413-a2c6-d1bcbe728d4a';

async function deleteOldFiles() {
  try {
    console.log('🗑️  Deleting old files...\n');

    // Get all files
    const { data: allFiles, error } = await supabase
      .from('training_requirement_files')
      .select('*')
      .eq('trainee_id', TRAINEE_ID)
      .is('deleted_at', null)
      .order('requirement_type')
      .order('uploaded_at', { ascending: false });

    if (error) {
      console.error('❌ Error:', error);
      return;
    }

    // Group by type and keep only latest
    const byType = {};
    allFiles.forEach(file => {
      if (!byType[file.requirement_type]) {
        byType[file.requirement_type] = [];
      }
      byType[file.requirement_type].push(file);
    });

    let deleted = 0;
    let kept = 0;

    for (const [type, files] of Object.entries(byType)) {
      console.log(`\n📁 ${type}:`);
      
      // Keep the first one (latest), delete the rest
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        if (i === 0) {
          console.log(`  ✅ KEEPING: ${file.file_name}`);
          console.log(`     ID: ${file.id}`);
          console.log(`     Uploaded: ${new Date(file.uploaded_at).toLocaleString()}`);
          kept++;
        } else {
          console.log(`  🗑️  DELETING: ${file.file_name}`);
          console.log(`     ID: ${file.id}`);
          
          // HARD DELETE (not soft delete) to avoid unique constraint issue
          const { error: delError } = await supabase
            .from('training_requirement_files')
            .delete()
            .eq('id', file.id);
          
          if (delError) {
            console.log(`     ❌ Error: ${delError.message}`);
          } else {
            console.log(`     ✅ Deleted`);
            deleted++;
          }
        }
      }
    }

    console.log(`\n\n📊 Summary:`);
    console.log(`   Kept: ${kept}`);
    console.log(`   Deleted: ${deleted}`);
    console.log(`\n🎉 Done! Refresh the page to see only the latest files.\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

deleteOldFiles();
