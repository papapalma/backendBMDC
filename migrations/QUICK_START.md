# Migrations Quick Start

Fast reference for common migration tasks.

## 🚀 Quick Deploy Options

### Option 1: Fresh Production Database
```bash
# Single command - applies entire normalized schema
psql -h $SUPABASE_HOST -U $USER -d $DB -f 005-reference/000_Normalize_full_schema.sql

# Seed initial data
psql -h $SUPABASE_HOST -U $USER -d $DB -f 004-seeds/014_seed_superadmin.sql

# Verify success
psql -h $SUPABASE_HOST -U $USER -d $DB -f 005-reference/NORMALIZE_FULL_SCHEMA_VERIFICATION.sql
```

### Option 2: Development Environment
```bash
# Apply all migrations in order
for file in 001-schema-foundation/*.sql; do psql -f "$file"; done
for file in 002-core-features/*.sql; do psql -f "$file"; done
for file in 003-normalization/*.sql; do psql -f "$file"; done
for file in 004-seeds/*.sql; do psql -f "$file"; done

# Verify
psql -f 005-reference/NORMALIZE_FULL_SCHEMA_VERIFICATION.sql
```

---

## 📂 Directory Guide

| Directory | Purpose | Files | When to Use |
|-----------|---------|-------|------------|
| **001-schema-foundation/** | Initial DB schema | 1 file | Fresh environment only |
| **002-core-features/** | Feature additions | 4 files | After foundation |
| **003-normalization/** | 3NF normalization | 8 files | DO NOT SKIP, apply in order |
| **004-seeds/** | Initial data | 1 file | After schema complete |
| **005-reference/** | Reference schemas | 9 files | Production or reference |
| **docs/** | Documentation | 9 files | Read before deploying |

---

## ⚡ Common Tasks

### View Migration History
```bash
psql -c "SELECT * FROM _migration_history ORDER BY applied_at;"
```

### Check Which Migrations Applied
```bash
psql -c "SELECT migration_name FROM _migration_history;"
```

### Verify Schema After Applying
```bash
psql -f 005-reference/NORMALIZE_FULL_SCHEMA_VERIFICATION.sql
```

### List All Tables
```bash
psql -c "\dt"
```

### Describe Specific Table
```bash
psql -c "\d trainee_accounts"
```

### Check Foreign Keys
```bash
psql -c "SELECT * FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY';"
```

---

## ⚠️ Important Checklist

Before deployment:
- [ ] Backup database
- [ ] Test in staging
- [ ] Review migration files
- [ ] Disable production traffic
- [ ] Have rollback plan

During deployment:
- [ ] Apply migrations in order
- [ ] Check for errors
- [ ] Verify data

After deployment:
- [ ] Run verification SQL
- [ ] Test application
- [ ] Monitor logs
- [ ] Document applied migrations

---

## 🆘 Troubleshooting

### Migration Failed?
1. Check error message in logs
2. Restore from backup
3. Review specific migration file
4. Contact database team

### Application can't connect?
1. Verify migrations completed successfully
2. Run verification queries
3. Check connection string
4. Check RLS policies are active

### Data looks wrong?
1. Run verification queries
2. Check specific table constraints
3. Verify foreign key references
4. Review normalization migration details

---

## 📚 Full Documentation

For detailed information, read:
- `MIGRATIONS_GUIDE.md` - Complete guide with examples
- `docs/DEPLOYMENT_CHECKLIST.md` - Pre/post deployment steps
- `docs/NORMALIZE_FULL_SCHEMA_README.md` - Normalization details
- `docs/NORMALIZE_FULL_SCHEMA_USAGE_GUIDE.md` - Using normalized schema

---

## 🎯 Current Status

**Latest Migration**: 027_add_temp_password_table.sql  
**Status**: ✅ Ready for production  
**Recommended Path**: Use `005-reference/000_Normalize_full_schema.sql`  

---

**Last Updated**: September 4, 2026
