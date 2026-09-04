# Database Migrations Guide

Organized migration system for BMDC database schema evolution.

## 📁 Directory Structure

```
migrations/
├── 001-schema-foundation/    # Initial schema and tables
├── 002-core-features/        # Feature additions (enrollments, push, etc)
├── 003-normalization/        # 3NF normalization phases
├── 004-seeds/                # Data seeding scripts
├── 005-reference/            # Reference schemas and verification
├── docs/                      # Documentation and guides
└── MIGRATIONS_GUIDE.md        # This file
```

---

## 🔄 Migration Phases

### Phase 1: Schema Foundation (001)
**Initial database schema setup**

- **001_full_schema.sql** - Complete initial schema with all tables
  - Users, trainees, programs, enrollments
  - Attendance, sessions, activities
  - Inventory, certifications, lendings
  
*When to use*: Initial database setup in fresh environment

---

### Phase 2: Core Features (002)
**Incremental feature additions**

| Migration | Purpose | Notes |
|-----------|---------|-------|
| 015_add_enrollment_limit.sql | Add enrollment capacity limits | Restrict max trainees per program |
| 016_add_push_subscriptions.sql | Web push notification support | For browser notifications |
| 017_add_is_existing_trainee_flag.sql | Track existing vs new trainees | Re-enrollment logic |
| 018_add_enrollment_source.sql | Track enrollment origin | social_share, direct, admin_assigned |

*Apply in order*: After foundation schema is in place

---

### Phase 3: Normalization to 3NF (003)
**Database normalization in 4 phases**

| Phase | Migration | Purpose |
|-------|-----------|---------|
| 1 | 019_normalize_phase1_tables.sql | Create normalized tables (trainee_accounts, etc) |
| 1 | 020_normalize_phase1_constraints.sql | Add foreign key constraints |
| 2 | 021_normalize_phase2_data_migration.sql | Migrate data from old to normalized structure |
| 3 | 022_normalize_phase3_cleanup.sql | Remove old columns and tables |
| 4 | 023_normalize_phase4_enforcement.sql | Add RLS policies and triggers |
| 4 | 025_ensure_enrollment_source_tracking.sql | Ensure enrollment source on existing records |
| 4 | 026_fix_enrollment_constraints.sql | Fix constraint triggers |
| 4 | 027_add_temp_password_table.sql | Temporary password storage for registration |

*Important*: Apply in exact order. Do NOT skip phases.

**What changes**:
- ✅ Eliminates data redundancy
- ✅ Improves query performance
- ✅ Maintains referential integrity
- ✅ Supports complex relationships (many-to-many)

**Key normalized tables**:
- `trainee_accounts`: Maps user_id ↔ trainee_id (1-to-1)
- `enrollments`: Maps trainee_id ↔ program_id (many-to-many)
- `attendance`: Fact table for daily attendance records

---

### Phase 4: Seeds (004)
**Initial data loading**

- **014_seed_superadmin.sql** - Create superadmin user account
  - Email: superadmin@bmdc.local (or configured)
  - Role: super_admin
  - Used for initial admin access

*When to use*: After complete schema is in place

---

### Phase 5: Reference Schemas (005)
**Complete reference schemas and utilities**

| File | Purpose |
|------|---------|
| 000_Normalize_full_schema.sql | **PRODUCTION**: Complete normalized schema in single file |
| NORMALIZE_FULL_SCHEMA_VERIFICATION.sql | Verification queries for schema integrity |
| FIX_*.sql files | Individual table fixes if needed |

**When to use**:
- `000_Normalize_full_schema.sql`: Deploy to new production environment (replaces all above)
- Verification SQL: After applying all migrations
- FIX_*.sql: Only if specific table needs repair

---

## 🚀 Deployment Strategies

### Development Environment
Apply migrations sequentially:
```sql
-- 1. Apply foundation
\i 001-schema-foundation/001_full_schema.sql

-- 2. Apply features
\i 002-core-features/015_add_enrollment_limit.sql
\i 002-core-features/016_add_push_subscriptions.sql
\i 002-core-features/017_add_is_existing_trainee_flag.sql
\i 002-core-features/018_add_enrollment_source.sql

-- 3. Apply normalization (ALL phases)
\i 003-normalization/019_normalize_phase1_tables.sql
\i 003-normalization/020_normalize_phase1_constraints.sql
\i 003-normalization/021_normalize_phase2_data_migration.sql
\i 003-normalization/022_normalize_phase3_cleanup.sql
\i 003-normalization/023_normalize_phase4_enforcement.sql
\i 003-normalization/025_ensure_enrollment_source_tracking.sql
\i 003-normalization/026_fix_enrollment_constraints.sql
\i 003-normalization/027_add_temp_password_table.sql

-- 4. Seed initial data
\i 004-seeds/014_seed_superadmin.sql

-- 5. Verify schema
\i 005-reference/NORMALIZE_FULL_SCHEMA_VERIFICATION.sql
```

### Production Environment (Fresh)
Use single comprehensive schema:
```sql
\i 005-reference/000_Normalize_full_schema.sql
\i 004-seeds/014_seed_superadmin.sql
```

### Production Environment (Existing)
Apply only new migrations since last deployment:
```sql
-- Check which migrations have been applied
SELECT * FROM _migration_history;

-- Apply only migrations that haven't been applied
```

---

## ✅ Verification

After applying migrations:

```bash
# Option 1: Run verification SQL
psql -h $SUPABASE_HOST -U $USER -d $DB < migrations/005-reference/NORMALIZE_FULL_SCHEMA_VERIFICATION.sql

# Option 2: Check table structure
\dt                           # List all tables
\d trainee_accounts           # Describe specific table
\di                           # List all indexes
```

**Key checks**:
- ✓ All tables exist with correct columns
- ✓ Foreign key constraints are present
- ✓ Indexes are created
- ✓ RLS policies are active
- ✓ Data is properly migrated

---

## 📋 Migration Checklist

### Before Applying
- [ ] Backup current database
- [ ] Test migrations in staging environment
- [ ] Review migration files for accuracy
- [ ] Disable production traffic (if migrating live)
- [ ] Get approval from team lead

### Applying Migrations
- [ ] Apply migrations in exact order
- [ ] DO NOT SKIP any phases
- [ ] Check for errors after each migration
- [ ] Verify data integrity
- [ ] Run verification queries

### After Applying
- [ ] Run schema verification
- [ ] Check application connects successfully
- [ ] Verify key features work (login, enrollment, attendance)
- [ ] Monitor logs for errors
- [ ] Document applied migrations

---

## 🔐 Important Notes

### Do's
✅ Always backup before applying migrations  
✅ Apply migrations in order (001 → 002 → 003 → 004 → 005)  
✅ Test in staging first  
✅ Document which migrations have been applied  
✅ Verify after each migration  
✅ Keep migration history for audit  

### Don'ts
❌ DO NOT modify applied migrations  
❌ DO NOT skip normalization phases  
❌ DO NOT apply migrations out of order  
❌ DO NOT mix development and production migrations  
❌ DO NOT delete old migration files  

---

## 🚑 Rollback Procedure

If migration fails:

### Option 1: Database Restore
```bash
# Restore from backup
pg_restore -d $DB_NAME backup_before_migration.sql
```

### Option 2: Manual Rollback
Depends on specific migration. Check migration file for rollback SQL.

### Option 3: Contact Support
If unsure about rollback, contact database team.

---

## 📝 Creating New Migrations

### Naming Convention
```
NNN_descriptive_name.sql
```
- **NNN**: Sequential number (028, 029, etc.)
- **descriptive_name**: What the migration does

### File Template
```sql
-- Migration NNN: Description
-- Purpose: Why this migration is needed
-- Author: Your name
-- Date: YYYY-MM-DD

-- TODO: Add your migration SQL here

-- Optional: Add verification queries
SELECT COUNT(*) FROM new_table;
```

### Add to Appropriate Folder
- Schema foundation? → 001-schema-foundation/
- Core feature? → 002-core-features/
- Normalization? → 003-normalization/
- Data seeding? → 004-seeds/
- Reference? → 005-reference/

### Test Before Applying
```bash
# Test in local environment
psql -h localhost -d bmdc_test < migrations/NNN_*.sql
```

---

## 📚 Documentation Files

Located in `docs/` subdirectory:

| File | Content |
|------|---------|
| README.md | General migrations guide |
| README_seeding.md | Data seeding procedures |
| DEPLOYMENT_CHECKLIST.md | Pre/post deployment checklist |
| NORMALIZE_FULL_SCHEMA_README.md | Normalization overview |
| NORMALIZE_FULL_SCHEMA_CROSS_REFERENCE.md | Schema mapping reference |
| NORMALIZE_FULL_SCHEMA_USAGE_GUIDE.md | How to use normalized schema |
| SEED_SUPERADMIN_README.md | Superadmin seeding guide |
| WEB_PUSH_SETUP_GUIDE.md | Web push notification setup |
| QUICK_SEED_REFERENCE.txt | Quick command reference |

---

## 🎯 Current State

**Latest Applied Migration**: 027_add_temp_password_table.sql  
**Database Schema**: Normalized to 3NF  
**Status**: ✅ Production-ready  
**Next Steps**:
1. Deploy to Supabase production
2. Run verification queries
3. Monitor application for issues

---

## 📞 Support

For migration questions or issues:
1. Check `docs/` for detailed guides
2. Review migration file comments
3. Run verification queries
4. Contact database team if blocked

---

**Last Updated**: September 4, 2026  
**Version**: 1.0
