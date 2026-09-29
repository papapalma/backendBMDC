# Archive Query Helper - Quick Reference

## Quick Start

### Import
```typescript
import { queryArchivedItems, ARCHIVE_TABLES } from '@/utils/archiveQuery';
import { supabaseAdmin } from '@/lib/supabase-admin';
```

### Basic Query
```typescript
const result = await queryArchivedItems(
  supabaseAdmin,
  'trainees',           // or 'programs', 'trainee_status_records', etc.
  'tenant-id',          // Required for tenant isolation
  {
    page: 1,            // Optional, default: 1
    limit: 20,          // Optional, default: 20 (max: 1000)
    sortBy: 'deleted_at', // Optional, default: 'deleted_at'
    sortOrder: 'desc',  // Optional, default: 'desc' ('asc' or 'desc')
    search: 'John',     // Optional, searches table-specific fields
  }
);

// Result structure:
// {
//   data: [...items...],        // Soft-deleted records
//   count: 125,                 // Total count
//   page: 1,                    // Current page
//   limit: 20,                  // Items per page
//   totalPages: 7              // Total pages available
// }
```

## Common Patterns

### 1. Get Page 1 of Archived Trainees
```typescript
const result = await queryArchivedItems(
  supabaseAdmin, 'trainees', tenantId,
  { page: 1, limit: 20 }
);
```

### 2. Search for Deleted Trainees
```typescript
const result = await queryArchivedItems(
  supabaseAdmin, 'trainees', tenantId,
  { search: 'John Doe', page: 1, limit: 20 }
);
```

### 3. Sort by Name (A-Z)
```typescript
const result = await queryArchivedItems(
  supabaseAdmin, 'trainees', tenantId,
  { sortBy: 'first_name', sortOrder: 'asc', page: 1, limit: 20 }
);
```

### 4. Get Oldest Deleted Items
```typescript
const result = await queryArchivedItems(
  supabaseAdmin, 'programs', tenantId,
  { sortBy: 'deleted_at', sortOrder: 'asc', page: 1, limit: 20 }
);
```

### 5. Restore an Archived Item
```typescript
// Step 1: Query to find it
const result = await queryArchivedItems(supabaseAdmin, 'trainees', tenantId, {
  search: 'John',
  page: 1,
  limit: 20
});

// Step 2: Restore using existing service
const trainee = result.data[0];
await traineeService.restoreTrainee(trainee.id);
```

### 6. Purge an Old Item
```typescript
// Only if retention period (30 days) has passed
const { error } = await supabaseAdmin
  .from('trainees')
  .delete()
  .eq('id', traineeId)
  .eq('tenant_id', tenantId);

if (error) throw error;
console.log('Item permanently deleted');
```

## Supported Tables

| Entity Type | Table Name |
|---|---|
| `trainee` | `trainees` |
| `program` | `programs` |
| `trainee_status` | `trainee_status_records` |
| `training_requirement_file` | `training_requirement_files` |

## Searchable Fields

| Table | Searchable Fields |
|---|---|
| trainees | first_name, last_name, email |
| programs | name |
| trainee_status_records | (limited) |
| training_requirement_files | name, file_name |

## Error Handling

```typescript
try {
  const result = await queryArchivedItems(
    supabaseAdmin, 'trainees', tenantId
  );
} catch (error) {
  console.error('Failed to query archived items:', error.message);
  // Use existing error response patterns
}
```

## Limits & Constraints

- **Page minimum**: 1 (enforced)
- **Limit minimum**: 1 (enforced)
- **Limit maximum**: 1000 (capped to prevent abuse)
- **Tenant ID**: Always required for isolation
- **Result size**: Full records returned (filtered by Supabase RLS later)

## Files

- **Implementation**: `Backend/src/utils/archiveQuery.ts`
- **Tests**: `Backend/src/utils/__tests__/archiveQuery.test.ts` (42 tests)
- **Demos**: `Backend/src/utils/archiveQuery.demo.ts`
- **Documentation**: `Backend/ARCHIVE_QUERY_IMPLEMENTATION.md`

## Run Tests

```bash
cd Backend
npm test -- src/utils/__tests__/archiveQuery.test.ts --forceExit
```

Expected: 42/42 passing ✅
