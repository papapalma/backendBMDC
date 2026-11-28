# Data Retention Policy

## Overview

This document describes the automated data retention and cleanup policies implemented for the system. These policies ensure sensitive data is appropriately managed according to legal, regulatory, and privacy requirements.

## Retention Schedules

### 1. Audit Logs (90 days)

**Purpose:** Compliance, troubleshooting, security investigation

**Data Affected:** `audit_logs` table

**Retention Window:** 90 days from creation

**Cleanup Action:** Hard delete

**Details:**
- Records older than 90 days are permanently deleted
- Contains user actions, authentication events, authorization decisions
- Essential for compliance audits and security incident investigation
- After 90 days, older records are no longer needed for operational purposes

### 2. Failed Authentication Attempts (30 days)

**Purpose:** Security, brute-force attack prevention

**Data Affected:** `audit_logs` table (filtered by `action = 'login_failed'`)

**Retention Window:** 30 days from creation

**Cleanup Action:** Hard delete

**Details:**
- Failed login attempts are logged in audit_logs with `action = 'login_failed'`
- Older records are deleted to prevent indefinite growth of security logs
- 30-day window allows investigation of brute-force patterns
- Reduces database bloat from high-volume authentication failures

### 3. Soft-Deleted Records (90 days, then hard delete)

**Purpose:** Data recovery, compliance, audit trail

**Data Affected:**
- `programs` (programs marked for deletion)
- `trainees` (trainees removed from system)
- `enrollments` (dropped/cancelled enrollments)
- `enrollment_requirements` (deleted requirements)
- `attendance` (deleted attendance records)

**Retention Window:** 90 days after soft-delete

**Cleanup Action:** Hard delete (purge)

**Details:**
- Soft-deleted records have `deleted_at` set (not NULL)
- Retained for 90 days to allow recovery if deletion was accidental
- After 90 days, records are permanently hard-deleted
- Allows administrators to recover recently deleted data
- After window expires, space is reclaimed in database

**Database Schema:**
```sql
-- All soft-delete tables have this column:
ALTER TABLE table_name ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX idx_table_deleted_at ON table_name(deleted_at);
```

**Query Pattern:**
```sql
-- Soft-deleted records (within recovery window):
SELECT * FROM table_name WHERE deleted_at IS NOT NULL AND deleted_at > NOW() - INTERVAL '90 days';

-- Hard-delete expired records:
DELETE FROM table_name WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '90 days';
```

### 4. Temporary GPS/Selfie Files (30 days, anonymization)

**Purpose:** Privacy (GDPR), data minimization

**Data Affected:** `attendance` table (GPS coordinates)

**Retention Window:** 30 days from record creation

**Cleanup Action:** Anonymization (set to NULL)

**Details:**
- GPS data (`gps_lat`, `gps_lng`, `gps_address`, `gps_accuracy`) is sensitive
- After 30 days, GPS data is cleared from attendance records
- Attendance records are preserved (not deleted)
- Only precise location data is removed
- Complies with GDPR privacy principles (data minimization)
- Selfie files themselves may be retained longer; only GPS coordinates are cleared

**Rationale:**
- GPS data is location-specific and personally identifiable
- 30-day window allows investigation and verification of attendance
- After 30 days, precise location is no longer needed
- Keeps attendance history while removing unnecessary personal data

## API Trigger

### Endpoint: `POST /api/admin/data-retention`

**Access:** Super Admin only

**Purpose:** Manually trigger retention policy execution

**Request:**
```bash
curl -X POST https://api.example.com/api/admin/data-retention \
  -H "Authorization: Bearer <super_admin_token>" \
  -H "Content-Type: application/json"
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "executedAt": "2024-10-05T14:30:00Z",
    "policies": [
      {
        "name": "audit_logs_retention",
        "description": "Delete audit logs older than 90 days",
        "retentionDays": 90,
        "recordsDeleted": 150
      },
      {
        "name": "failed_auth_retention",
        "description": "Delete failed auth attempts older than 30 days",
        "retentionDays": 30,
        "recordsDeleted": 12
      },
      {
        "name": "soft_delete_purge",
        "description": "Hard-delete soft-deleted records older than 90 days",
        "retentionDays": 90,
        "recordsDeleted": 5
      },
      {
        "name": "temporary_files_cleanup",
        "description": "Delete temporary GPS/selfie files older than 30 days",
        "retentionDays": 30,
        "recordsDeleted": 23
      }
    ],
    "totalRecordsDeleted": 190,
    "success": true
  },
  "message": "Data retention policy executed successfully. 190 records processed."
}
```

**Response (Errors):**
```json
{
  "success": true,
  "data": {
    "executedAt": "2024-10-05T14:30:00Z",
    "policies": [
      {
        "name": "audit_logs_retention",
        "recordsDeleted": 100,
        "retentionDays": 90,
        "error": "Database connection timeout"
      }
    ],
    "totalRecordsDeleted": 100,
    "success": false
  },
  "message": "Data retention policy executed with errors. Check policies array for details."
}
```

## Scheduling

### Manual Trigger
Administrators can call the API endpoint manually when needed.

### Automated Execution (Recommended)

**Option 1: GitHub Actions (Scheduled Job)**
```yaml
name: Data Retention Policy
on:
  schedule:
    - cron: '0 2 * * *'  # Every day at 2 AM UTC

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger retention policy
        run: |
          curl -X POST ${{ secrets.API_URL }}/api/admin/data-retention \
            -H "Authorization: Bearer ${{ secrets.SUPER_ADMIN_TOKEN }}" \
            -H "Content-Type: application/json"
```

**Option 2: External Scheduler (AWS Lambda, Google Cloud Scheduler)**
- Create a cron job that calls the API endpoint
- Requires authentication token in secrets

**Option 3: Built-in Database Scheduler**
Alternative: Use PostgreSQL `pg_cron` extension (future enhancement):
```sql
SELECT cron.schedule('data-retention-cleanup', '0 2 * * *', 'SELECT cleanup_expired_data()');
```

## Implementation Details

### Service: `dataRetention.ts`

**Exports:**
- `executeRetentionPolicy(): Promise<RetentionReport>` — Main cleanup function
- `logRetentionExecution(report): Promise<void>` — Logs to audit trail

**Flow:**
1. Execute all 4 policies in parallel (Promise.allSettled)
2. Collect results
3. Calculate total records deleted
4. Log execution to `audit_logs` table
5. Return report to caller

**Error Handling:**
- Non-fatal errors for individual policies
- Continues executing other policies if one fails
- Reports all errors in response

### Route: `POST /api/admin/data-retention`

**File:** `src/app/api/admin/data-retention/route.ts`

**Steps:**
1. Authenticate request
2. Verify Super Admin role
3. Execute retention policy
4. Log execution to audit trail
5. Return results

## Monitoring & Alerts

### Execution Logging
Every retention policy execution is logged to `audit_logs`:

```json
{
  "action": "data_retention_executed",
  "entity_type": "system",
  "details": {
    "totalRecordsDeleted": 190,
    "policiesExecuted": 4,
    "success": true,
    "policyResults": [
      { "name": "audit_logs_retention", "recordsDeleted": 150 },
      { "name": "failed_auth_retention", "recordsDeleted": 12 },
      { "name": "soft_delete_purge", "recordsDeleted": 5 },
      { "name": "temporary_files_cleanup", "recordsDeleted": 23 }
    ]
  }
}
```

### Recommended Monitoring
- Check for execution success/failure
- Alert if `totalRecordsDeleted` is unusually high (potential bug)
- Monitor policy execution time
- Track which policies fail and why

## Data Recovery

### Within Retention Windows

**Soft-Deleted Records (0-90 days after deletion):**
- Restore by setting `deleted_at = NULL`
- Audit trail shows deletion and recovery
- Restored records regain functionality

```sql
-- Recovery example:
UPDATE programs SET deleted_at = NULL WHERE id = 'program-123' AND deleted_at IS NOT NULL;
```

**GPS Data (0-30 days after record creation):**
- Cannot be recovered (intentionally anonymized)
- Original coordinates are permanently lost
- Audit logs may contain historical data

### After Retention Window Expires
- Records are permanently hard-deleted
- Cannot be recovered
- Backup restore may be only option (depends on backup policy)

## Legal & Compliance

### GDPR Compliance
- Data minimization: GPS data removed after 30 days
- Right to erasure: Soft-deleted records purged after 90 days
- Audit trail: All operations logged
- User notification: Implement as needed

### Compliance Checklist
- ✅ Implement retention windows (audit logs, auth failures, soft-deletes, GPS)
- ✅ Log all cleanup operations to audit trail
- ✅ Provide manual trigger for administrators
- ✅ Allow scheduled execution
- ✅ Implement recovery window (90 days for soft-deletes)
- ✅ Error handling and resilience

## Testing

### Unit Tests
- `src/lib/dataRetention.test.ts` — Service logic
- Verify each policy deletes/anonymizes correct records
- Verify error handling and resilience
- Verify retention windows

### Integration Tests
- `src/app/api/admin/data-retention/__tests__/route.test.ts` — API endpoint
- Verify authentication and authorization
- Verify response format
- Verify execution and logging

### Manual Testing
```bash
# Trigger manually
curl -X POST http://localhost:3000/api/admin/data-retention \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json"

# Check audit logs
SELECT * FROM audit_logs WHERE action = 'data_retention_executed' ORDER BY created_at DESC;
```

## Future Enhancements

1. **Database-Level Scheduling**
   - Use PostgreSQL `pg_cron` for native scheduling
   - Eliminate external scheduler dependency

2. **Policy Configuration**
   - Allow administrators to customize retention windows
   - Per-tenant retention policies
   - Exclude specific records from cleanup

3. **Advanced Anonymization**
   - Pseudonymization (keep correlations)
   - Aggregation (summary statistics only)
   - Tokenization for sensitive fields

4. **Reporting & Analytics**
   - Dashboard showing cleanup history
   - Trends over time
   - Storage reclaimed

5. **Integration**
   - Webhooks for external systems
   - Integration with backup/archive systems
   - DLP (Data Loss Prevention) system alerts

## Support & Troubleshooting

### Common Issues

**Q: Cleanup job failed with "Database connection timeout"**
- A: Check database connectivity, increase timeout, retry

**Q: GPS data not being anonymized**
- A: Verify `gps_lat`, `gps_lng` fields exist in attendance table
- A: Check that `executeRetentionPolicy` is being called

**Q: Audit logs not showing cleanup operation**
- A: Verify `audit_logs` table exists
- A: Check Super Admin permissions
- A: Ensure `logRetentionExecution` is called after cleanup

### Debug Logging

Enable verbose logging:
```typescript
// In dataRetention.ts
logger.info('[DATA_RETENTION] Starting retention policy execution');
logger.info('[DATA_RETENTION] Audit logs cleaned up', { recordsDeleted: count });
```

### Manual Verification

```sql
-- Check audit logs retention
SELECT COUNT(*) FROM audit_logs WHERE created_at < NOW() - INTERVAL '90 days';

-- Check soft-deleted records
SELECT COUNT(*) FROM programs WHERE deleted_at < NOW() - INTERVAL '90 days';

-- Check GPS anonymization
SELECT COUNT(*) FROM attendance 
  WHERE created_at < NOW() - INTERVAL '30 days' AND gps_lat IS NULL;
```

## Related Documentation

- [Security Hardening Plan](../../../.kiro/specs/security-hardening-plan)
- [Data Breach Notification](./dataBreachService.ts)
- [Audit Logging](./activityLogService.ts)
- [File Cleanup](./fileCleanup.ts)
