# Archive Query Helper Implementation - Task 1

## Overview

Task 1 of the **archive-page-soft-delete** spec implements a lightweight query helper utility for fetching soft-deleted (archived) items across any table in the system.

## Files Created

1. **`Backend/src/utils/archiveQuery.ts`** - Main implementation
2. **`Backend/src/utils/__tests__/archiveQuery.test.ts`** - Comprehensive unit tests (42 passing tests)
3. **`Backend/src/utils/archiveQuery.demo.ts`** - Usage examples and demos

## Key Features

### 1. Single Export Function: `queryArchivedItems()`

```typescript
async function queryArchivedItems(
  supabaseClient: SupabaseClient,
  tableName: string,
  tenantId: string,
  filters?: ArchiveQueryFilters
): Promise<ArchiveQueryResult>
```

- **Reuses** the Supabase client (already available)
- **Fetches only** records where `deleted_at IS NOT NULL`
- **Filters by** `tenant_id` for multi-tenant isolation
- **Supports** pagination, sorting, and search
- **Returns** paginated results with total count and page metadata

### 2. ARCHIVE_TABLES Constant

Maps entity types to database table names:

```typescript
export const ARCHIVE_TABLES = {
  trainee: 'trainees',
  program: 'programs',
  trainee_status: 'trainee_status_records',
  training_requirement_file: 'training_requirement_files',
};
```

### 3. Pagination Support

- `page` (default: 1) - Current page number
- `limit` (default: 20) - Items per page (capped at 1000 to prevent abuse)
- `totalPages` - Calculated in response for UI navigation
- Enforces minimum values (page ≥ 1, limit ≥ 1)

### 4. Sorting Support

- `sortBy` (default: 'deleted_at') - Field to sort by
- `sortOrder` (default: 'desc') - Sort direction ('asc' or 'desc')
- Common sortable fields: `deleted_at`, `name`, `email`, `first_name`, `last_name`

### 5. Search Filtering

- `search` - Searches on table-specific fields:
  - **trainees**: first_name, last_name, email
  - **programs**: name
  - **trainee_status_records**: (limited search)
  - **training_requirement_files**: name, file_name
- Uses PostgreSQL `ilike` operator for case-insensitive partial matching

### 6. Response Structure

```typescript
interface ArchiveQueryResult {
  data: any[];           // Array of soft-deleted records
  count: number;         // Total count of archived records for this tenant
  page: number;          // Current page
  limit: number;         // Items per page
  totalPages: number;    // Ceil(count / limit)
}
```

## Restoration Flow

Use existing service methods to restore soft-deleted items:

```typescript
// Restore a trainee
const restored = await traineeService.restoreTrainee(id);

// Restore a trainee status record
await traineeStatusService.restoreTraineeStatus(id, tenantId);

// Restore a program (use direct Supabase update)
await supabaseAdmin
  .from('programs')
  .update({ deleted_at: null })
  .eq('id', id);
```

## Purge (Hard Delete) Flow

Directly call Supabase delete (no wrapper needed):

```typescript
const { error } = await supabaseAdmin
  .from('trainees')
  .delete()
  .eq('id', id)
  .eq('tenant_id', tenantId);
```

## No New Error Classes

- Throws standard JavaScript `Error` with descriptive message on failure
- Consistent with existing error handling patterns in codebase

## Testing

### Test Coverage (42 tests, all passing)

1. **Query Filtering** (3 tests)
   - ✅ Filters `deleted_at IS NOT NULL`
   - ✅ Respects `tenant_id` isolation
   - ✅ Doesn't return active records

2. **Pagination** (9 tests)
   - ✅ Correct offset calculation for each page
   - ✅ Default values (page 1, limit 20)
   - ✅ Handles fractional page counts
   - ✅ Limits enforced (min 1, max 1000)

3. **Sorting** (6 tests)
   - ✅ Default sort: `deleted_at desc`
   - ✅ Supports ascending/descending for all fields
   - ✅ Works with name, email, first_name, last_name

4. **Tenant Isolation** (4 tests)
   - ✅ Returns only records for specified tenant
   - ✅ Excludes other tenants' data
   - ✅ Empty result when no records for tenant

5. **ARCHIVE_TABLES** (5 tests)
   - ✅ All entity types mapped correctly
   - ✅ Type-safe entity type lookups

6. **Search** (4 tests)
   - ✅ Handles empty search
   - ✅ Trims whitespace
   - ✅ Case-insensitive matching

7. **Response Structure** (6 tests)
   - ✅ Data array included
   - ✅ Count and pagination metadata
   - ✅ Handles zero results

8. **Integration Scenarios** (5 tests)
   - ✅ Multiple table queries
   - ✅ Page navigation
   - ✅ Sort changes

Run tests:
```bash
npm test -- src/utils/__tests__/archiveQuery.test.ts --forceExit
```

## Usage Examples

See `Backend/src/utils/archiveQuery.demo.ts` for 10 complete demos:

### Example 1: Query archived trainees with pagination
```typescript
const result = await queryArchivedItems(
  supabaseAdmin,
  'trainees',
  'tenant-123',
  {
    page: 1,
    limit: 20,
    sortBy: 'deleted_at',
    sortOrder: 'desc',
  }
);

console.log(`Total archived: ${result.count}`);
console.log(`Pages: ${result.totalPages}`);
result.data.forEach(trainee => {
  console.log(`- ${trainee.first_name} (deleted: ${trainee.deleted_at})`);
});
```

### Example 2: Search and restore
```typescript
const result = await queryArchivedItems(
  supabaseAdmin,
  'trainees',
  'tenant-123',
  { search: 'John' }
);

const trainee = result.data[0];
await traineeService.restoreTrainee(trainee.id);
```

### Example 3: Pagination navigation
```typescript
// Page 1
const page1 = await queryArchivedItems(supabaseAdmin, 'trainees', tenantId, {
  page: 1,
  limit: 20
});

// Page 2 (if available)
if (page1.totalPages > 1) {
  const page2 = await queryArchivedItems(supabaseAdmin, 'trainees', tenantId, {
    page: 2,
    limit: 20
  });
}
```

## Design Decisions (Ponytail Philosophy)

1. **Single Function** - Not a full service class. One query builder function reuses existing Supabase client.

2. **No New Classes** - Uses existing error handling, no custom error types.

3. **Reuse Existing Services** - Restoration delegates to `traineeService.restoreTrainee()`, `traineeStatusService.restoreTraineeStatus()`, not new wrapper methods.

4. **Direct Supabase for Purge** - No wrapper for hard delete. Direct `.delete()` call prevents abstraction bloat.

5. **Minimal Code** - ~100 lines of actual code + ~30 lines of types/exports.

6. **Tenant Isolation Built-In** - All queries enforce `tenant_id` filtering for security.

7. **Search Field Mapping** - Uses table-specific fields, not generic search (trainee searches first_name/last_name, programs search name).

## Integration Points

- **Restoration**: Routes will call `traineeService.restoreTrainee()`, `traineeStatusService.restoreTraineeStatus()`
- **Logging**: Routes will call `activityLogService.logAction()` after restore/purge
- **UI**: Frontend will call `GET /api/archive?entityType=trainee&page=1&limit=20`

## Next Steps

Phase 2 will implement archive API routes that:
1. Call `queryArchivedItems()` for GET requests
2. Call existing service restore methods for PATCH requests
3. Call direct Supabase delete for purge DELETE requests
4. Log all operations via `activityLogService`

## Status

✅ **Task 1 Complete**
- ✅ Implementation: `archiveQuery.ts` created
- ✅ Tests: 42/42 passing
- ✅ Documentation: Demo file with 10 usage examples
- ✅ No new dependencies or services added
