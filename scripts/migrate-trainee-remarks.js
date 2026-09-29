/**
 * Migration script for trainee_remarks table
 * Reads and executes the SQL migration file
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL,
  });

  try {
    console.log('🔄 Starting trainee_remarks migration...');
    
    // Read the migration file
    const migrationPath = path.join(
      __dirname,
      '../migrations/012-trainee-remarks/001_create_trainee_remarks_table.sql'
    );
    
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute the migration
    await pool.query(sql);
    
    console.log('✅ Migration completed successfully!');
    console.log('   - Created trainee_remarks table');
    console.log('   - Created indexes');
    console.log('   - Added foreign key constraints');
    
    // Verify the table was created
    const result = await pool.query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'trainee_remarks'
      ORDER BY ordinal_position
    `);
    
    console.log('\n📊 Table structure:');
    result.rows.forEach(row => {
      console.log(`   - ${row.column_name}: ${row.data_type}`);
    });
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    if (error.code === '42P07') {
      console.log('ℹ️  Table already exists. Skipping migration.');
    } else {
      throw error;
    }
  } finally {
    await pool.end();
  }
}

runMigration()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
