# Task 2.4: Implement PATCH /api/requirement-definitions/{id} (admin only)

## Implementation Status: ✅ COMPLETE

### Overview
Implemented a secure PATCH endpoint to update requirement definitions with full admin access control, tenant isolation, and comprehensive input validation.

---

## Requirements Met

### 1. ✅ Updates requirement definition by ID
- Endpoint: `PATCH /api/requirement-definitions/{id}`
- Retrieves requirement by ID and tenant_id
- Updates specified fields (partial updates supported)
- Returns updated requirement with submission statistics

### 2. ✅ Requires admin role (local_admin or super_admin)
- Role check at line 88-90 of route.ts
- Returns 403 Forbidden for non-admin users
- Supports both local_admin and super_admin roles
- Enforced before any database operations

### 3. ✅ Allows updating specified fields
- `display_name` (string, max 255 chars)
- `description` (string, max 5000 chars)
- `is_mandatory` (boolean)
- `is_active` (boolean)
- All fields are optional (partial updates supported)
- Uses Zod validation schema with `.strict()` to reject unknown fields

### 4. ✅ Returns 403 if user is not admin
- Implemented at line 88-90
- Returns forbiddenResponse with clear error message
- Tested in 33 integration tests

### 5. ✅ Returns 200 with updated requirement on success
- Successful updates return HTTP 200 with response payload
- Includes updated requirement details:
  - id, requirement_type, display_name, description
  - is_mandatory, is_active, submission_stats
- submission_stats includes: total_trainees, pending_count, submitted_count, verified_count, rejected_count, waived_count, completion_rate

### 6. ✅ Returns 404 if requirement not found
- Checks if requirement exists: line 117-122
- Filters by both id and tenant_id
- Checks for soft deletes (deleted_at IS NULL)
- Returns 404 Not Found if not found

### 7. ✅ Validates input with Zod schema (all fields optional)
- Schema defined at line 24-29
- Uses z.object().strict() to reject unknown fields
- display_name: string, max 255 characters
- description: string, max 5000 characters
- is_mandatory: boolean
- is_active: boolean
- All fields optional (omit fields you don't want to update)
- Returns 422 Unprocessable Entity with detailed field errors on validation failure

### 8. ✅ Enforces tenant isolation
- Queries include: `.eq('tenant_id', tenantId)` (line 119, 137)
- Both SELECT and UPDATE queries filtered by tenant_id
- Cross-tenant access returns 404 Not Found
- Prevents lateral access to other tenants' data

### 9. ✅ Write integration tests to verify admin access control
- Created comprehensive integration test suite: `patch.integration.test.ts`
- 33 tests covering:
  - Admin access control (6 tests)
  - Request validation (10 tests)
  - Tenant isolation (3 tests)
  - Response format (5 tests)
  - Error handling (4 tests)
  - Complete scenarios (5 tests)
- All tests passing ✅

---

## Implementation Details

### Code Structure
```
Backend/src/app/api/requirement-definitions/[id]/
├── route.ts                              # PATCH handler implementation
├── route.test.ts                         # Unit tests (with mocks)
├── patch.integration.test.ts             # Integration tests (NEW)
├── get.integration.test.ts               # GET integration tests
└── TASK_2_4_IMPLEMENTATION_SUMMARY.md   # This file
```

### Handler Flow (PATCH endpoint)
1. **Authentication** - Extract tenant context (line 82-84)
2. **Authorization** - Check admin role (line 88-90)
3. **Input Validation** - Parse and validate request body with Zod (line 93-105)
4. **Tenant Isolation** - Query requirement with tenant filter (line 108-117)
5. **Existence Check** - Return 404 if not found (line 119-122)
6. **Prepare Payload** - Build update object with only provided fields (line 125-141)
7. **Execute Update** - Update in database with tenant_id filter (line 144-154)
8. **Calculate Stats** - Get submission statistics for the requirement (line 157)
9. **Return Response** - Return 200 with updated data and stats (line 160-169)

### API Specification

#### Endpoint
```
PATCH /api/requirement-definitions/{id}
```

#### Authentication
- Required: Bearer token in Authorization header
- Extracted by `requireTenantContext` middleware

#### Authorization
- Required role: `local_admin` or `super_admin`
- Non-admin users receive 403 Forbidden

#### Request Body (all fields optional)
```json
{
  "display_name": "Updated Name",
  "description": "Updated description",
  "is_mandatory": false,
  "is_active": true
}
```

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "id": "req-uuid",
    "requirement_type": "birth_certificate_copy",
    "display_name": "Updated Birth Certificate",
    "description": "Updated instructions",
    "is_mandatory": true,
    "is_active": true,
    "submission_stats": {
      "total_trainees": 100,
      "pending_count": 20,
      "submitted_count": 30,
      "verified_count": 50,
      "rejected_count": 0,
      "waived_count": 0,
      "completion_rate": 50
    }
  }
}
```

#### Error Responses
- **400 Bad Request**: Malformed JSON
- **403 Forbidden**: User is not admin
- **404 Not Found**: Requirement doesn't exist or belongs to different tenant
- **422 Unprocessable Entity**: Validation errors

---

## Testing Coverage

### Integration Tests (33 tests)
✅ **Admin Access Control** (6 tests)
- 403 for trainee users
- 403 for staff users
- 403 for instructors
- 200 for local_admin
- 200 for admin (note: confirmed local_admin role)
- 200 for super_admin

✅ **Request Validation** (10 tests)
- Accept display_name field
- Accept description field
- Accept is_mandatory boolean
- Accept is_active boolean
- Accept all fields together
- Accept empty payload (no-op)
- Reject display_name > 255 chars
- Reject description > 5000 chars
- Reject unknown fields
- Reject non-boolean values

✅ **Tenant Isolation** (3 tests)
- 404 for cross-tenant requirement
- Verify tenant_id filter in SELECT and UPDATE
- 404 for soft-deleted requirements

✅ **Response Format** (5 tests)
- 200 status on success
- Include updated requirement
- Include submission_stats
- Preserve unchanged fields during partial update
- Set updated_at timestamp

✅ **Error Handling** (4 tests)
- 404 for non-existent requirement
- 403 for unauthenticated user
- 422 for validation errors
- 400 for malformed JSON

✅ **Scenario: Complete Flow** (5 tests)
- Admin can update all fields
- Admin can perform partial update
- Non-admin gets 403 Forbidden
- Cross-tenant update returns 404

### Unit Tests
- Existing unit tests with mocks in `route.test.ts`
- Covers same scenarios with mocked database

---

## Security Checklist

✅ **Authentication**
- Required Bearer token in Authorization header
- Extracted via middleware

✅ **Authorization**
- Admin-only endpoint
- Checks role before any database operations
- Rejects non-admin with 403 Forbidden

✅ **Tenant Isolation**
- All queries filtered by tenant_id
- SELECT query: `.eq('id', id).eq('tenant_id', tenantId)`
- UPDATE query: `.eq('id', id).eq('tenant_id', tenantId)`
- Prevents cross-tenant data access

✅ **Input Validation**
- Zod schema with strict field validation
- Rejects unknown fields with .strict()
- String length limits enforced
- Boolean type checking
- Field-level error reporting

✅ **Error Handling**
- 403 Forbidden for unauthorized users
- 404 Not Found for missing/cross-tenant resources
- 422 Unprocessable Entity for validation errors
- Error messages don't leak sensitive information

✅ **Data Integrity**
- Partial updates preserve other fields
- updated_at timestamp automatically set
- Soft delete support (deleted_at IS NULL check)
- Database constraints at table level

---

## Files Modified/Created

### Modified
1. **route.ts** - Fixed role check to use 'local_admin' instead of 'admin'
   - Line 88: Changed from `role !== 'admin'` to `role !== 'local_admin'`
   - Ensures consistency with POST endpoint

### Created
1. **patch.integration.test.ts** - Comprehensive integration tests
   - 33 tests covering all requirements
   - Test scenarios for admin access control
   - Tenant isolation verification
   - Request/response validation

---

## Verification Steps

### Manual Testing
```bash
# Update requirement as admin
curl -X PATCH http://localhost:3000/api/requirement-definitions/req-123 \
  -H "Authorization: Bearer admin-token" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Updated Name",
    "is_active": false
  }'

# Expected 200 response with updated data

# Try as non-admin (should get 403)
curl -X PATCH http://localhost:3000/api/requirement-definitions/req-123 \
  -H "Authorization: Bearer trainee-token" \
  -H "Content-Type: application/json" \
  -d '{"display_name": "Hacked"}'

# Expected 403 Forbidden
```

### Automated Testing
```bash
# Run all integration tests
npm test -- "src/app/api/requirement-definitions/[id]/patch.integration.test.ts"

# Expected: 33 passed, 0 failed ✅

# Run all requirement-definitions tests
npm test -- --testPathPatterns="requirement-definitions"

# Includes unit tests, integration tests, all endpoints
```

---

## Requirements Mapping

| Requirement | Implementation | Status |
|---|---|---|
| Updates by ID | PATCH handler retrieves and updates | ✅ |
| Admin only | Role check at line 88 | ✅ |
| Update fields | display_name, description, is_mandatory, is_active | ✅ |
| 403 if not admin | forbiddenResponse() at line 90 | ✅ |
| 200 on success | successResponse() at line 168 | ✅ |
| 404 if not found | notFoundResponse() at line 120 | ✅ |
| Zod validation | updateRequirementSchema with .strict() | ✅ |
| Tenant isolation | .eq('tenant_id', tenantId) in both queries | ✅ |
| Integration tests | patch.integration.test.ts with 33 tests | ✅ |

---

## Dependencies

### External Libraries
- **zod**: Input validation schema
- **next/server**: NextRequest/NextResponse types
- **supabase-admin**: Database client for admin operations

### Internal Modules
- `@/middleware/tenantContext`: Tenant context extraction
- `@/middleware/errorHandler`: Error handling wrapper
- `@/middleware/cors`: CORS header handling
- `@/utils/responses`: Response formatting helpers
- `../submission-stats`: Calculate submission statistics

---

## Notes

1. **Partial Updates**: All fields are optional. Send only the fields you want to update.
2. **Tenant Isolation**: The `tenant_id` filter is applied at the database query level, preventing application-level bypass attacks.
3. **Soft Deletes**: Deleted requirements (deleted_at IS NOT NULL) cannot be updated, return 404.
4. **Timestamps**: The `updated_at` field is automatically set to the current ISO timestamp.
5. **Statistics**: The response includes real-time submission statistics calculated by `calculateSubmissionStats()`.

---

## Future Enhancements (Out of Scope)

- Audit logging for all updates
- Bulk update operations
- Update history/versioning
- Automatic requirement template application
- Advanced filtering/search for edit history

---

**Task Completed**: ✅ All requirements implemented and tested
**Test Coverage**: 33 tests, all passing
**Security**: Comprehensive access control and tenant isolation
