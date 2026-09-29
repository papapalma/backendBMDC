/**
 * Archive Query Helper - Demo & Usage Examples
 *
 * This file demonstrates how to use the queryArchivedItems() function
 * to retrieve soft-deleted records across different tables.
 *
 * NOT EXECUTED - This is a reference guide for developers.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { queryArchivedItems, ARCHIVE_TABLES } from './archiveQuery';
import { traineeService } from '@/services/traineeService';
import { traineeStatusService } from '@/services/traineeStatusService';

/**
 * DEMO 1: Query archived trainees with pagination
 * 
 * Fetch page 1 of soft-deleted trainees for a tenant,
 * sorted by deletion date (newest first).
 */
async function demo_queryArchivedTrainees() {
  console.log('\n=== DEMO 1: Query Archived Trainees ===');

  const tenantId = 'tenant-abc-123';
  const result = await queryArchivedItems(
    supabaseAdmin,
    'trainees',
    tenantId,
    {
      page: 1,
      limit: 20,
      sortBy: 'deleted_at',
      sortOrder: 'desc',
    }
  );

  console.log('Archived trainees (page 1):');
  console.log(`  Total: ${result.count}`);
  console.log(`  Page: ${result.page} of ${result.totalPages}`);
  console.log(`  Items:`, result.data);

  // Result structure:
  // {
  //   data: [
  //     { id: 'trainee-1', first_name: 'John', ..., deleted_at: '2024-01-15T10:00:00Z' },
  //     { id: 'trainee-2', first_name: 'Jane', ..., deleted_at: '2024-01-14T15:30:00Z' },
  //     ...20 items total...
  //   ],
  //   count: 125,           // Total archived trainees for this tenant
  //   page: 1,              // Current page
  //   limit: 20,            // Items per page
  //   totalPages: 7         // Ceil(125 / 20)
  // }
}

/**
 * DEMO 2: Search archived trainees
 * 
 * Find deleted trainees matching a search term (first_name, last_name, email).
 */
async function demo_searchArchivedTrainees() {
  console.log('\n=== DEMO 2: Search Archived Trainees ===');

  const tenantId = 'tenant-abc-123';
  const result = await queryArchivedItems(
    supabaseAdmin,
    'trainees',
    tenantId,
    {
      page: 1,
      limit: 20,
      search: 'John',
      sortBy: 'name',
      sortOrder: 'asc',
    }
  );

  console.log(`Search results for "John":`);
  console.log(`  Found: ${result.count}`);
  result.data.forEach((trainee) => {
    console.log(`  - ${trainee.first_name} ${trainee.last_name} (deleted: ${trainee.deleted_at})`);
  });
}

/**
 * DEMO 3: Sort by different fields
 * 
 * Example: Sort deleted trainees by name (A-Z).
 */
async function demo_sortByName() {
  console.log('\n=== DEMO 3: Sort by Name (A-Z) ===');

  const tenantId = 'tenant-abc-123';
  const result = await queryArchivedItems(
    supabaseAdmin,
    'trainees',
    tenantId,
    {
      page: 1,
      limit: 50,
      sortBy: 'first_name',
      sortOrder: 'asc',
    }
  );

  console.log('Archived trainees sorted by first name:');
  result.data.forEach((trainee) => {
    console.log(`  - ${trainee.first_name}`);
  });
}

/**
 * DEMO 4: Query archived programs
 * 
 * Fetch deleted programs for a tenant.
 */
async function demo_queryArchivedPrograms() {
  console.log('\n=== DEMO 4: Query Archived Programs ===');

  const tenantId = 'tenant-abc-123';
  const result = await queryArchivedItems(
    supabaseAdmin,
    'programs',
    tenantId,
    {
      page: 1,
      limit: 10,
      sortBy: 'deleted_at',
      sortOrder: 'desc',
    }
  );

  console.log('Archived programs:');
  result.data.forEach((program) => {
    console.log(`  - ${program.name} (deleted: ${program.deleted_at})`);
  });
}

/**
 * DEMO 5: Query archived trainee status records
 * 
 * Fetch deleted status records (minimal search on this table).
 */
async function demo_queryArchivedStatusRecords() {
  console.log('\n=== DEMO 5: Query Archived Trainee Status Records ===');

  const tenantId = 'tenant-abc-123';
  const result = await queryArchivedItems(
    supabaseAdmin,
    'trainee_status_records',
    tenantId,
    {
      page: 1,
      limit: 30,
      sortBy: 'deleted_at',
      sortOrder: 'desc',
    }
  );

  console.log('Archived status records:');
  console.log(`  Total: ${result.count}`);
  result.data.forEach((record) => {
    console.log(`  - ID: ${record.id}, Status: ${record.graduation_status}, Deleted: ${record.deleted_at}`);
  });
}

/**
 * DEMO 6: Restore archived trainee
 * 
 * Use existing traineeService.restoreTrainee() to restore a soft-deleted trainee.
 * This clears the deleted_at field, making the trainee visible again.
 */
async function demo_restoreTrainee() {
  console.log('\n=== DEMO 6: Restore Archived Trainee ===');

  const traineeId = 'trainee-1';

  // Step 1: Find the trainee in archive
  console.log('Step 1: Query archived trainees...');
  const result = await queryArchivedItems(
    supabaseAdmin,
    'trainees',
    'tenant-abc-123',
    { page: 1, limit: 20 }
  );

  const traineeToRestore = result.data.find((t) => t.id === traineeId);
  if (!traineeToRestore) {
    console.log('  Trainee not found in archive');
    return;
  }

  console.log(`  Found trainee: ${traineeToRestore.first_name} ${traineeToRestore.last_name}`);
  console.log(`  Deleted at: ${traineeToRestore.deleted_at}`);

  // Step 2: Restore using existing service
  console.log('\nStep 2: Restore trainee...');
  const restored = await traineeService.restoreTrainee(traineeId);
  console.log(`  ✅ Restored: ${restored.first_name} ${restored.last_name}`);
  console.log(`  Deleted at: ${restored.deleted_at} (should be null now)`);

  // Step 3: Verify restoration (query archive again - should be gone)
  console.log('\nStep 3: Verify restoration...');
  const afterRestore = await queryArchivedItems(
    supabaseAdmin,
    'trainees',
    'tenant-abc-123',
    { page: 1, limit: 20 }
  );
  const stillArchived = afterRestore.data.find((t) => t.id === traineeId);
  console.log(`  Trainee in archive now: ${!!stillArchived} (should be false)`);
}

/**
 * DEMO 7: Restore archived trainee status record
 * 
 * Use traineeStatusService.restoreTraineeStatus() to restore a soft-deleted status record.
 */
async function demo_restoreStatusRecord() {
  console.log('\n=== DEMO 7: Restore Archived Status Record ===');

  const statusId = 'status-record-1';
  const tenantId = 'tenant-abc-123';

  // Step 1: Find the status record in archive
  console.log('Step 1: Query archived status records...');
  const result = await queryArchivedItems(
    supabaseAdmin,
    'trainee_status_records',
    tenantId,
    { page: 1, limit: 20 }
  );

  const recordToRestore = result.data.find((r) => r.id === statusId);
  if (!recordToRestore) {
    console.log('  Status record not found in archive');
    return;
  }

  console.log(`  Found status record: ${recordToRestore.id}`);
  console.log(`  Deleted at: ${recordToRestore.deleted_at}`);

  // Step 2: Restore using existing service
  console.log('\nStep 2: Restore status record...');
  await traineeStatusService.restoreTraineeStatus(statusId, tenantId);
  console.log(`  ✅ Restored status record: ${statusId}`);

  // Step 3: Verify restoration
  console.log('\nStep 3: Verify restoration...');
  const afterRestore = await queryArchivedItems(
    supabaseAdmin,
    'trainee_status_records',
    tenantId,
    { page: 1, limit: 20 }
  );
  const stillArchived = afterRestore.data.find((r) => r.id === statusId);
  console.log(`  Status record in archive now: ${!!stillArchived} (should be false)`);
}

/**
 * DEMO 8: Purge (hard delete) archived item
 * 
 * Permanently delete an archived trainee after verifying retention period.
 */
async function demo_purgeArchivedTrainee() {
  console.log('\n=== DEMO 8: Purge (Hard Delete) Archived Trainee ===');

  const traineeId = 'trainee-1';
  const tenantId = 'tenant-abc-123';
  const RETENTION_DAYS = 30;

  // Step 1: Query to get the trainee
  console.log('Step 1: Query archived trainees...');
  const result = await queryArchivedItems(
    supabaseAdmin,
    'trainees',
    tenantId,
    { page: 1, limit: 20 }
  );

  const traineeToPurge = result.data.find((t) => t.id === traineeId);
  if (!traineeToPurge) {
    console.log('  Trainee not found in archive');
    return;
  }

  // Step 2: Check if retention period has passed
  console.log('\nStep 2: Check retention period...');
  const deletedDate = new Date(traineeToPurge.deleted_at);
  const now = new Date();
  const daysArchived = Math.floor((now.getTime() - deletedDate.getTime()) / (1000 * 60 * 60 * 24));
  const daysRemaining = RETENTION_DAYS - daysArchived;

  console.log(`  Deleted at: ${traineeToPurge.deleted_at}`);
  console.log(`  Days archived: ${daysArchived}`);
  console.log(`  Days remaining before purge: ${Math.max(0, daysRemaining)}`);

  if (daysRemaining > 0) {
    console.log(`  ⚠️  Cannot purge yet. ${daysRemaining} days remaining.`);
    return;
  }

  // Step 3: Hard delete (purge)
  console.log('\nStep 3: Hard delete (purge) trainee...');
  const { error } = await supabaseAdmin
    .from('trainees')
    .delete()
    .eq('id', traineeId)
    .eq('tenant_id', tenantId);

  if (error) {
    console.log(`  ❌ Failed to purge: ${error.message}`);
    return;
  }

  console.log(`  ✅ Purged trainee: ${traineeId}`);

  // Step 4: Verify purge
  console.log('\nStep 4: Verify purge...');
  const afterPurge = await queryArchivedItems(
    supabaseAdmin,
    'trainees',
    tenantId,
    { page: 1, limit: 20 }
  );
  const stillInArchive = afterPurge.data.find((t) => t.id === traineeId);
  console.log(`  Trainee still in archive: ${!!stillInArchive} (should be false)`);
  console.log(`  Total archived trainees: ${afterPurge.count}`);
}

/**
 * DEMO 9: Pagination navigation
 * 
 * Example of navigating between pages of archived items.
 */
async function demo_paginationNavigation() {
  console.log('\n=== DEMO 9: Pagination Navigation ===');

  const tenantId = 'tenant-abc-123';
  const pageSize = 20;

  // Fetch page 1
  console.log('Fetching page 1...');
  const page1 = await queryArchivedItems(
    supabaseAdmin,
    'trainees',
    tenantId,
    { page: 1, limit: pageSize }
  );
  console.log(`  Page 1: ${page1.data.length} items, Total: ${page1.count}, Pages: ${page1.totalPages}`);

  // Fetch page 2
  if (page1.totalPages > 1) {
    console.log('\nFetching page 2...');
    const page2 = await queryArchivedItems(
      supabaseAdmin,
      'trainees',
      tenantId,
      { page: 2, limit: pageSize }
    );
    console.log(`  Page 2: ${page2.data.length} items`);
  }

  // Fetch last page
  if (page1.totalPages > 2) {
    console.log(`\nFetching page ${page1.totalPages}...`);
    const lastPage = await queryArchivedItems(
      supabaseAdmin,
      'trainees',
      tenantId,
      { page: page1.totalPages, limit: pageSize }
    );
    console.log(`  Page ${page1.totalPages}: ${lastPage.data.length} items`);
  }
}

/**
 * DEMO 10: Use ARCHIVE_TABLES constant
 * 
 * Show how to use the entity type to table mapping.
 */
async function demo_archiveTablesConstant() {
  console.log('\n=== DEMO 10: ARCHIVE_TABLES Constant ===');

  console.log('Entity type to table mapping:');
  console.log(`  trainee -> ${ARCHIVE_TABLES.trainee}`);
  console.log(`  program -> ${ARCHIVE_TABLES.program}`);
  console.log(`  trainee_status -> ${ARCHIVE_TABLES.trainee_status}`);
  console.log(`  training_requirement_file -> ${ARCHIVE_TABLES.training_requirement_file}`);

  // Example: Dynamic table lookup
  const entityType: 'trainee' = 'trainee';
  const tableName = ARCHIVE_TABLES[entityType];
  console.log(`\nDynamic lookup for '${entityType}': ${tableName}`);
}

/**
 * Uncomment below to run demos (for testing/development only)
 * 
 * Note: These require a live database connection and test data.
 * They are meant as reference examples for developers.
 */

// (async () => {
//   try {
//     await demo_queryArchivedTrainees();
//     await demo_searchArchivedTrainees();
//     await demo_sortByName();
//     await demo_queryArchivedPrograms();
//     await demo_queryArchivedStatusRecords();
//     // await demo_restoreTrainee();
//     // await demo_restoreStatusRecord();
//     // await demo_purgeArchivedTrainee();
//     await demo_paginationNavigation();
//     await demo_archiveTablesConstant();
//   } catch (error) {
//     console.error('Demo error:', error);
//   }
// })();
