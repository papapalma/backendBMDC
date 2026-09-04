# Database Seeding Guide

This document describes the seeding scripts for the multi-tenant LGU system and explains how to use them in development and testing environments.

---

## Overview

Two seed scripts are provided:

| Script | Purpose |
|--------|---------|
| `seed_default_bmdc_tenant.sql` | Creates the default BMDC tenant with realistic sample data |
| `seed_test_tenants.sql` | Creates two additional test tenants (Calapan, Naujan) for isolation testing |

> **These scripts are for development and testing only. Do not run them against a production database.**

---

## Prerequisites

All four schema migrations must be applied before running any seed script:

```
001_create_core_multi_tenant_schema.sql
002_add_tenant_id_to_existing_tables.sql
003_create_new_multi_tenant_tables.sql
004_implement_rls_policies.sql
```

See `README.md` in this directory for migration instructions.

---

## Seed Script Details

### `seed_default_bmdc_tenant.sql`

Creates the primary BMDC (Bongabong Manpower Development Center) tenant that represents the original single-tenant instance migrated to multi-tenancy.

**What it inserts:**

| Entity | Count | Notes |
|--------|-------|-------|
| Tenant | 1 | BMDC, `id = 00000000-0000-0000-0000-000000000001` |
| Users | 4 | Super Admin, Local Admin, Training Coordinator, Inventory Manager |
| Feature flags | 6 | All features enabled except WhatsApp notifications |
| Programs | 3 | Bread & Pastry (completed), Electrical (active), Welding (upcoming) |
| Trainees | 5 | Mix of completed, active, and enrolled statuses |
| Enrollments | 5 | Matching trainee/program combinations |
| Attendance records | 4 | Sample sessions for the active Electrical program |
| Certificates | 2 | Issued for the two completed Bread & Pastry enrollments |

**Fixed UUIDs used:**

- Tenant: `00000000-0000-0000-0000-000000000001`
- Users: `00000000-0000-0000-0001-00000000000{1–4}`
- Programs: `00000000-0000-0000-0002-00000000000{1–3}`
- Trainees: `00000000-0000-0000-0003-00000000000{1–5}`
- Enrollments: `00000000-0000-0000-0004-00000000000{1–5}`
- Certificates: `00000000-0000-0000-0006-00000000000{1–2}`

---

### `seed_test_tenants.sql`

Creates two additional tenants used to verify tenant isolation in integration and security tests.

**Tenant A — Calapan City Manpower Training Center**

- Tenant ID: `00000000-0000-0000-0000-000000000002`
- Users: Local Admin (`calapan_admin`), Training Coordinator (`calapan_training`)
- Programs: Food & Beverage (completed), Housekeeping (active)
- Trainees: 2 (one completed, one active)
- Enrollments: 2
- Certificates: 1 (for the completed enrollment)

**Tenant B — Naujan Skills Development Institute**

- Tenant ID: `00000000-0000-0000-0000-000000000003`
- Users: Local Admin (`naujan_admin`), Training Coordinator (`naujan_training`)
- Programs: Agricultural Crops (active), Driving NC II (upcoming)
- Trainees: 2 (one active, one enrolled)
- Enrollments: 2
- Certificates: 0

---

## Default Credentials

All seeded users share the same password for convenience in development:

| Role | Email | Password |
|------|-------|----------|
| Super Admin | `superadmin@bmdc.gov.ph` | `Password123!` |
| BMDC Local Admin | `localadmin@bmdc.gov.ph` | `Password123!` |
| BMDC Training Coordinator | `training.coord@bmdc.gov.ph` | `Password123!` |
| BMDC Inventory Manager | `inventory@bmdc.gov.ph` | `Password123!` |
| Calapan Local Admin | `localadmin@calapan-mtc.gov.ph` | `Password123!` |
| Calapan Training Coordinator | `training@calapan-mtc.gov.ph` | `Password123!` |
| Naujan Local Admin | `localadmin@naujan-sdi.gov.ph` | `Password123!` |
| Naujan Training Coordinator | `training@naujan-sdi.gov.ph` | `Password123!` |

> The stored `password_hash` values are bcrypt hashes of `Password123!` at cost factor 12.  
> **Change all passwords before deploying to any shared or production environment.**

---

## How to Apply Seeds

### Using psql (recommended)

```bash
# 1. Apply the BMDC seed first
psql "$DATABASE_URL" -f migrations/seed_default_bmdc_tenant.sql

# 2. Apply the test tenants seed (depends on BMDC seed)
psql "$DATABASE_URL" -f migrations/seed_test_tenants.sql
```

### Using Supabase SQL Editor

1. Open the Supabase dashboard for your project.
2. Navigate to **SQL Editor**.
3. Paste the contents of `seed_default_bmdc_tenant.sql` and execute.
4. Paste the contents of `seed_test_tenants.sql` and execute.

### Using npm script (if configured)

```bash
npm run db:seed
```

> Check `package.json` for the exact script name. If not yet configured, add:
> ```json
> "db:seed": "psql \"$DATABASE_URL\" -f migrations/seed_default_bmdc_tenant.sql && psql \"$DATABASE_URL\" -f migrations/seed_test_tenants.sql"
> ```

---

## Idempotency

Both scripts use `ON CONFLICT ... DO NOTHING` on every `INSERT`. Running them multiple times is safe — duplicate rows will be silently skipped. This makes the scripts suitable for use in CI pipelines that reset and re-seed the database on each run.

---

## Resetting Seed Data

To remove all seeded data and start fresh:

```sql
-- Remove in reverse dependency order
DELETE FROM certificates       WHERE tenant_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');
DELETE FROM attendance_records WHERE tenant_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');
DELETE FROM enrollments        WHERE tenant_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');
DELETE FROM trainees           WHERE tenant_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');
DELETE FROM programs           WHERE tenant_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');
DELETE FROM feature_flags      WHERE tenant_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');
DELETE FROM users_tenants      WHERE tenant_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');
DELETE FROM users              WHERE id LIKE '00000000-0000-0000-000%-000000000%';
DELETE FROM tenants            WHERE id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');
```

Then re-run the seed scripts.

---

## Using Seeds in Automated Tests

The fixed UUIDs make it straightforward to reference seeded entities in test assertions without dynamic lookups:

```typescript
// Example: reference the BMDC tenant in a test
const BMDC_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const CALAPAN_TENANT_ID = '00000000-0000-0000-0000-000000000002';

// Verify RLS isolation: a Calapan user cannot see BMDC programs
const { data } = await supabaseAsCalapanUser
  .from('programs')
  .select('id')
  .eq('tenant_id', BMDC_TENANT_ID);

expect(data).toHaveLength(0); // RLS should block this
```

### Recommended test database setup

1. Create a dedicated test database (separate from development).
2. Apply all migrations.
3. Run both seed scripts before the test suite.
4. Wrap each test in a transaction and roll back after, or truncate and re-seed between test runs.

---

## Data Notes

- All personal data (names, emails, phone numbers) is **fictional** and does not represent real individuals.
- QR codes follow the pattern `{TENANT_SLUG}-{YEAR}-{SEQ}` (e.g. `BMDC-2025-0001`).
- Certificate numbers follow `{TENANT_SLUG}-CERT-{YEAR}-{SEQ}`.
- File paths in the database use the tenant-scoped pattern `uploads/{tenant_id}/...` but the actual files are not created by these scripts. Create placeholder files or mock file access in tests.
- Dates are set in 2025 to represent realistic near-future training schedules relative to the project timeline.
