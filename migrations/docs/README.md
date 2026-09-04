# Database Migrations

This directory contains SQL migration scripts for the multi-tenant LGU system.

## Naming Convention

```
{sequence}_{description}.sql
{sequence}_{description}_rollback.sql
```

- `{sequence}` — zero-padded three-digit number (e.g. `001`, `002`)
- `{description}` — snake_case summary of what the migration does
- `_rollback.sql` suffix — companion script that reverts the migration

## Migration Order and Dependencies

| # | Migration File | Rollback File | Description | Depends On |
|---|----------------|---------------|-------------|------------|
| 001 | `001_create_core_multi_tenant_schema.sql` | `001_create_core_multi_tenant_schema_rollback.sql` | Creates `tenants`, `users`, `users_tenants`, `feature_flags`, `extension_requests` tables with indexes and `updated_at` triggers | — |
| 002 | `002_add_tenant_id_columns.sql` | `002_rollback_add_tenant_id_columns.sql` | Adds `tenant_id` columns to `programs`, `trainees`, `items`, `audit_logs`; creates single-column and composite indexes | 001 |
| 003 | `003_create_new_multi_tenant_tables.sql` | `003_rollback_create_new_multi_tenant_tables.sql` | Creates `enrollments`, `attendance_records`, `certificates`, `audit_logs` tables with indexes and `updated_at` triggers | 001, 002 |
| 004 | `004_implement_rls_policies.sql` | `004_implement_rls_policies_rollback.sql` | Enables Row-Level Security and creates tenant isolation + Super Admin bypass policies on all tenant-scoped tables | 001, 002, 003 |
| 005 | `005_migrate_existing_data_to_bmdc_tenant.sql` | *(see file for rollback instructions)* | Migrates all existing records to the default BMDC tenant | 001–004 |

## How to Apply Migrations

### Using Supabase SQL Editor
1. Open the Supabase dashboard for your project.
2. Navigate to **SQL Editor**.
3. Paste the contents of each migration file in sequence order.
4. Execute each script and verify no errors before proceeding to the next.

### Using psql (direct connection)
```bash
psql "$DATABASE_URL" -f migrations/001_create_core_multi_tenant_schema.sql
psql "$DATABASE_URL" -f migrations/002_add_tenant_id_columns.sql
psql "$DATABASE_URL" -f migrations/003_create_new_multi_tenant_tables.sql
psql "$DATABASE_URL" -f migrations/004_implement_rls_policies.sql
psql "$DATABASE_URL" -f migrations/005_migrate_existing_data_to_bmdc_tenant.sql
```

### Rolling Back
To revert migrations, run the corresponding `_rollback.sql` files **in reverse order**:
```bash
psql "$DATABASE_URL" -f migrations/003_rollback_create_new_multi_tenant_tables.sql
psql "$DATABASE_URL" -f migrations/002_rollback_add_tenant_id_columns.sql
psql "$DATABASE_URL" -f migrations/001_create_core_multi_tenant_schema_rollback.sql
```

> **Warning**: Rollback scripts drop tables and permanently delete data. Only run them in development or when explicitly required.

---

## Migration 001 — Core Multi-Tenant Schema

**File**: `001_create_core_multi_tenant_schema.sql`  
**Rollback**: `001_create_core_multi_tenant_schema_rollback.sql`  
**Requirements**: 1.1, 1.2, 1.3, 1.4, 13.2, 13.3

### Tables Created

| Table | Purpose |
|-------|---------|
| `tenants` | Stores LGU tenant metadata (name, status, contact info, JSONB configuration) |
| `users` | Global user accounts decoupled from any single tenant |
| `users_tenants` | Junction table supporting multi-tenant user associations |
| `feature_flags` | Per-tenant feature gating without code deployments |
| `extension_requests` | LGU requests for new features or customisations |

### Indexes Created

| Index | Table | Column(s) |
|-------|-------|-----------|
| `idx_tenants_name` | `tenants` | `name` |
| `idx_tenants_status` | `tenants` | `status` |
| `idx_users_email` | `users` | `email` |
| `idx_users_role` | `users` | `role` |
| `idx_users_tenants_user` | `users_tenants` | `user_id` |
| `idx_users_tenants_tenant` | `users_tenants` | `tenant_id` |
| `idx_feature_flags_tenant` | `feature_flags` | `tenant_id` |
| `idx_feature_flags_key` | `feature_flags` | `feature_key` |
| `idx_extension_requests_tenant` | `extension_requests` | `tenant_id` |
| `idx_extension_requests_status` | `extension_requests` | `status` |
| `idx_extension_requests_priority` | `extension_requests` | `priority` |

### Triggers

A shared `trigger_set_updated_at()` function is created and attached to all tables that have an `updated_at` column, ensuring the timestamp is automatically updated on every `UPDATE` operation.

---

## Migration 002 — Add tenant_id Columns to Existing Tables

**File**: `002_add_tenant_id_columns.sql`  
**Rollback**: `002_rollback_add_tenant_id_columns.sql`  
**Requirements**: 2.1, 13.1, 13.5, 19.1, 19.2

### What This Migration Does

Adds a `tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE` column to each existing tenant-scoped table, then creates the single-column and composite indexes required for performant multi-tenant queries.

> **Note**: `enrollments`, `attendance_records`, and `certificates` are **new** tables created in migration 003 and include `tenant_id` in their `CREATE TABLE` definitions — no `ALTER TABLE` is needed for them here.

### Columns Added

| Table | Column | Type | Constraint |
|-------|--------|------|------------|
| `programs` | `tenant_id` | `UUID` | `REFERENCES tenants(id) ON DELETE CASCADE` |
| `trainees` | `tenant_id` | `UUID` | `REFERENCES tenants(id) ON DELETE CASCADE` |
| `items` | `tenant_id` | `UUID` | `REFERENCES tenants(id) ON DELETE CASCADE` |
| `audit_logs` | `tenant_id` | `UUID` | `REFERENCES tenants(id) ON DELETE CASCADE` (nullable — NULL = platform-level event) |

### Indexes Created

#### Single-Column Indexes (Requirement 19.1)

| Index | Table | Column | Notes |
|-------|-------|--------|-------|
| `idx_programs_tenant` | `programs` | `tenant_id` | |
| `idx_trainees_tenant` | `trainees` | `tenant_id` | |
| `idx_items_tenant` | `items` | `tenant_id` | |
| `idx_audit_logs_tenant` | `audit_logs` | `tenant_id` | Partial: `WHERE tenant_id IS NOT NULL` |

#### Composite Indexes (Requirement 19.2)

| Index | Table | Columns | Use Case |
|-------|-------|---------|----------|
| `idx_programs_tenant_status` | `programs` | `(tenant_id, status)` | Filter programs by status within a tenant |
| `idx_programs_tenant_dates` | `programs` | `(tenant_id, start_date, end_date)` | Date-range queries for program scheduling |
| `idx_trainees_tenant_program` | `trainees` | `(tenant_id, program_id)` | Enrollment lookups per program per tenant |
| `idx_trainees_tenant_status` | `trainees` | `(tenant_id, status)` | Active/inactive trainee filtering |
| `idx_trainees_tenant_email` | `trainees` | `(tenant_id, email)` | Unique-within-tenant email lookups |
| `idx_items_tenant_category` | `items` | `(tenant_id, category)` | Inventory category filtering |
| `idx_items_tenant_status` | `items` | `(tenant_id, status)` | Stock-level status filtering |
| `idx_audit_logs_tenant_created` | `audit_logs` | `(tenant_id, created_at)` | Time-range audit queries (partial) |
| `idx_audit_logs_tenant_action` | `audit_logs` | `(tenant_id, action)` | Action-type filtering per tenant (partial) |

### Rollback

Running `002_rollback_add_tenant_id_columns.sql` drops all indexes listed above and then removes the `tenant_id` columns in reverse order. **This permanently deletes tenant association data** — only run in development or when explicitly required.

---

## Migration 003 — Create New Multi-Tenant Tables

**File**: `003_create_new_multi_tenant_tables.sql`  
**Rollback**: `003_rollback_create_new_multi_tenant_tables.sql`  
**Requirements**: 7.5, 7.6, 7.7, 16.1, 16.2, 16.3

### Tables Created

| Table | Purpose |
|-------|---------|
| `enrollments` | Tracks trainee-program associations with status and grade |
| `attendance_records` | Records per-session attendance for each enrollment |
| `certificates` | Stores issued certificates with QR code and verification URL |
| `audit_logs` | Centralised audit trail for all tenant-scoped and platform events |

All new tables include `tenant_id NOT NULL REFERENCES tenants(id) ON DELETE CASCADE` (except `audit_logs` where `tenant_id` is nullable to allow platform-level events).

### Indexes Created

| Index | Table | Columns |
|-------|-------|---------|
| `idx_enrollments_tenant` | `enrollments` | `tenant_id` |
| `idx_enrollments_trainee` | `enrollments` | `(tenant_id, trainee_id)` |
| `idx_enrollments_program` | `enrollments` | `(tenant_id, program_id)` |
| `idx_enrollments_status` | `enrollments` | `(tenant_id, status)` |
| `idx_attendance_tenant` | `attendance_records` | `tenant_id` |
| `idx_attendance_enrollment` | `attendance_records` | `(tenant_id, enrollment_id)` |
| `idx_attendance_date` | `attendance_records` | `(tenant_id, session_date)` |
| `idx_certificates_tenant` | `certificates` | `tenant_id` |
| `idx_certificates_enrollment` | `certificates` | `enrollment_id` |
| `idx_certificates_number` | `certificates` | `certificate_number` |
| `idx_certificates_qr` | `certificates` | `qr_code` |
| `idx_audit_logs_tenant` | `audit_logs` | `tenant_id` |
| `idx_audit_logs_user` | `audit_logs` | `user_id` |
| `idx_audit_logs_action` | `audit_logs` | `action` |
| `idx_audit_logs_entity` | `audit_logs` | `(entity_type, entity_id)` |
| `idx_audit_logs_created` | `audit_logs` | `created_at` |

---

## Migration 004 — Row-Level Security Policies

**File**: `004_implement_rls_policies.sql`  
**Rollback**: `004_implement_rls_policies_rollback.sql`  
**Requirements**: 2.2, 2.3, 2.4, 2.8, 14.3

Enables RLS on all tenant-scoped tables and creates:
- **Tenant isolation policies** using `current_setting('app.current_tenant_id')::uuid`
- **Super Admin bypass policies** using `current_setting('app.is_super_admin', true)::boolean`

---

## Migration 005 — Migrate Existing Data to BMDC Tenant

**File**: `005_migrate_existing_data_to_bmdc_tenant.sql`  
**Requirements**: 13.6, 13.7, 13.8

Creates the default BMDC tenant record and updates all existing records to reference it. Includes data integrity verification steps.
