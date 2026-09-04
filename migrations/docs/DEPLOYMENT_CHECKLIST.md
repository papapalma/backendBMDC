# Normalize_full_schema.sql - Deployment Checklist

## Pre-Deployment (Development/Staging)

### Environment Setup
- [ ] PostgreSQL 12+ installed
- [ ] pgcrypto extension available
- [ ] Sufficient disk space (schema ~1-2MB, plus indexes)
- [ ] Database user has CREATE privileges
- [ ] Network connectivity verified (if remote DB)

### File Verification
- [ ] `Normalize_full_schema.sql` present (1,216 lines)
- [ ] `NORMALIZE_FULL_SCHEMA_USAGE_GUIDE.md` available
- [ ] `NORMALIZE_FULL_SCHEMA_CROSS_REFERENCE.md` available
- [ ] `NORMALIZE_FULL_SCHEMA_VERIFICATION.sql` available
- [ ] No conflicts with existing schema files

### Backup Creation
- [ ] Existing database backed up (if applicable)
- [ ] Backup verified and tested
- [ ] Backup location documented
- [ ] Backup restoration procedure confirmed

---

## Installation Phase

### Pre-Installation Checks
- [ ] Target database confirmed (not production initially)
- [ ] Target database is empty (no existing schema)
- [ ] Appropriate user permissions verified
- [ ] Network connectivity tested
- [ ] SSL/TLS configured (if required)

### Installation
- [ ] Execution user identified and confirmed
- [ ] Installation command tested
- [ ] Installation log captured (optional)
- [ ] Installation completed successfully
- [ ] No errors or warnings in output

### Command to Run
```bash
# Development/Staging
psql -U postgres -d your_database < Backend/migrations/Normalize_full_schema.sql

# Production (with explicit confirmation)
# PGPASSWORD=$PROD_PASSWORD psql -h prod-db.example.com \
#   -U prod_user -d prod_database \
#   < Backend/migrations/Normalize_full_schema.sql
```

---

## Post-Installation Verification

### Schema Integrity Checks
- [ ] All 5 normalized tables created
  - [ ] trainee_notification_preferences
  - [ ] tenant_branding
  - [ ] tenant_notification_channels
  - [ ] tenant_features
  - [ ] attendance_exceptions
- [ ] All 40+ base tables present
- [ ] No duplicate table errors in logs
- [ ] No missing foreign key errors

### Index Verification
- [ ] 20+ indexes created (12 new + 8 original)
- [ ] Run verification: `SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public';`
- [ ] Expected: 50+ total indexes

### Trigger Verification
- [ ] 19+ triggers installed
- [ ] Run verification: `SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = 'public';`
- [ ] Critical triggers firing:
  - [ ] enforce_registration_transitions
  - [ ] enforce_trainee_status_consistency
  - [ ] enforce_enrollment_constraints
  - [ ] initialize_trainee_notification_preferences

### Constraint Verification
- [ ] 35+ constraints present (10 new)
- [ ] UNIQUE constraints on:
  - [ ] trainees(tenant_id, email)
  - [ ] programs(tenant_id, name)
  - [ ] items(tenant_id, name)
  - [ ] tenant_notification_channels(tenant_id, channel_type)
  - [ ] tenant_features(tenant_id, feature_name)
- [ ] CHECK constraints on:
  - [ ] trainees.registration_status (pending/approved/rejected/completed)
  - [ ] attendance_exceptions.exception_type
  - [ ] All enum validations working

### RLS Policy Verification
- [ ] 60+ RLS policies present
- [ ] RLS enabled on all tenant-scoped tables
- [ ] Session variables work:
  - [ ] app.current_tenant_id
  - [ ] app.current_user_id

### Run Full Verification Suite
```bash
psql -U postgres -d your_database < Normalize_full_schema.sql_VERIFICATION.sql
```
- [ ] All 12 verification queries pass
- [ ] No errors or unexpected results
- [ ] Summary report shows "PASS" for all categories

---

## Backend Service Integration

### Service Configuration
- [ ] Database connection string updated
- [ ] Connection pooling configured
- [ ] Timeout settings appropriate

### Service Migration
- [ ] notificationService.ts updated
  - [ ] Uses trainee_notification_preferences table
  - [ ] No references to old trainees.notification_preferences JSONB
  - [ ] Query patterns use new indexes

- [ ] tenantConfigurationService.ts updated
  - [ ] Uses tenant_branding table
  - [ ] Uses tenant_notification_channels table
  - [ ] Uses tenant_features table
  - [ ] No references to old tenants.configuration JSONB keys

- [ ] attendanceService.ts updated
  - [ ] Uses unified attendance_exceptions table
  - [ ] Exception type filtering working
  - [ ] No references to separate tables

- [ ] registrationService.ts updated
  - [ ] Uses trainees.registration_status
  - [ ] State machine validation working
  - [ ] No bypass of trigger validation

### API Endpoint Testing
- [ ] GET /api/trainees/:id/preferences returns typed data
- [ ] PUT /api/trainees/:id/preferences saves correctly
- [ ] GET /api/tenant/:id/branding returns branding data
- [ ] GET /api/tenant/:id/features returns feature flags
- [ ] GET /api/attendance/exceptions filters by type
- [ ] GET /api/registrations returns pending status

### TypeScript Compilation
- [ ] No TypeScript errors
- [ ] No type mismatches on service updates
- [ ] All new types properly imported
- [ ] Build completes successfully

---

## Testing Phase

### Unit Tests
- [ ] notificationService tests pass
- [ ] tenantConfigurationService tests pass
- [ ] attendanceService tests pass
- [ ] registrationService tests pass
- [ ] All trigger validation tests pass

### Integration Tests
- [ ] End-to-end API tests pass
- [ ] Multi-tenant isolation verified
- [ ] Trigger enforcement verified
- [ ] Cascade delete verified
- [ ] RLS policies enforced

### Database Tests
```bash
npm run test:db-integrity
npm run test:schema-validation
npm run test:performance-baseline
```
- [ ] All database tests pass
- [ ] No constraint violations
- [ ] Indexes being used (EXPLAIN ANALYZE)
- [ ] Performance baseline acceptable

### Load Testing
- [ ] Preference queries under load (1000+ concurrent)
- [ ] Feature flag queries under load
- [ ] Enrollment queries under load
- [ ] No deadlocks or timeouts

---

## Performance Validation

### Query Performance Baselines
- [ ] Trainee preference lookup: <10ms (was 50-100ms)
- [ ] Tenant features lookup: <5ms (was 30-50ms)
- [ ] Attendance exception filtering: <30ms (was 200-500ms)
- [ ] Primary program lookup: <15ms (was 100-150ms)
- [ ] Registration status filter: <10ms (was 50-100ms)

### Index Verification
```bash
EXPLAIN ANALYZE SELECT * FROM trainee_notification_preferences 
WHERE trainee_id = $1;
```
- [ ] Query uses correct index
- [ ] No sequential scans
- [ ] Execution time meets targets

### Memory & Storage
- [ ] No memory leaks detected
- [ ] Database size acceptable
- [ ] Index storage within bounds
- [ ] No unusual memory growth

---

## Security Verification

### RLS Enforcement
- [ ] Unauthenticated requests blocked
- [ ] Session variables properly validated
- [ ] Tenant isolation verified (no cross-tenant leaks)
- [ ] User permissions respected

### Data Integrity
- [ ] Triggers prevent invalid state transitions
- [ ] Constraints enforce business rules
- [ ] Foreign keys prevent orphaned records
- [ ] Audit logging captures all changes

### Compliance
- [ ] PII properly handled
- [ ] Audit trail complete
- [ ] Timestamps accurate
- [ ] User tracking correct

---

## Staging Deployment

### Pre-Staging
- [ ] All development/integration tests pass
- [ ] Performance baselines met
- [ ] Security verified
- [ ] Code review completed

### Staging Deployment
- [ ] Database created in staging environment
- [ ] Schema deployed successfully
- [ ] Verification script passes
- [ ] Backend services connected

### Staging Testing
- [ ] Full test suite passes on staging
- [ ] API endpoints functional
- [ ] Performance acceptable in staging environment
- [ ] No integration issues

### Staging Approval
- [ ] QA sign-off
- [ ] Security review sign-off
- [ ] Performance review sign-off
- [ ] Business stakeholder approval

---

## Production Deployment

### Pre-Production Checklist
- [ ] Change request filed and approved
- [ ] Maintenance window scheduled
- [ ] Communication sent to stakeholders
- [ ] Rollback plan documented and tested
- [ ] On-call team briefed

### Production Backup
- [ ] Full database backup created
- [ ] Backup verified and tested
- [ ] Backup restoration tested
- [ ] Backup location confirmed

### Deployment Window
- [ ] Maintenance mode activated
- [ ] All transactions committed
- [ ] New connections rejected
- [ ] Monitoring enabled

### Production Deployment
- [ ] Run: `psql -U prod_user -d prod_db < Normalize_full_schema.sql`
- [ ] Monitor deployment progress
- [ ] Verify no errors
- [ ] Verify all tables created
- [ ] Verify all triggers installed

### Post-Deployment Verification
- [ ] Run full verification script
- [ ] Check application logs
- [ ] Verify all services online
- [ ] Test critical API endpoints
- [ ] Monitor database performance

### Production Sign-Off
- [ ] QA approval
- [ ] Production team approval
- [ ] Operations team approval
- [ ] Security team approval

---

## Post-Deployment (All Environments)

### Monitoring Setup
- [ ] Database query monitoring active
- [ ] Index usage monitoring enabled
- [ ] Trigger execution monitoring active
- [ ] Error rate monitoring enabled
- [ ] Performance dashboards created

### Documentation Update
- [ ] API documentation updated
- [ ] Database schema documentation updated
- [ ] Deployment guide updated
- [ ] Troubleshooting guide updated
- [ ] Team wiki/documentation updated

### Communication
- [ ] Team notified of successful deployment
- [ ] Stakeholders informed of completion
- [ ] Release notes published
- [ ] Known issues documented

### Maintenance Planning
- [ ] Backup schedule confirmed
- [ ] Index maintenance scheduled
- [ ] Vacuum schedule configured
- [ ] Statistics update frequency set

---

## Rollback Procedures

### If Installation Fails
1. [ ] Identify error in logs
2. [ ] Stop installation
3. [ ] Drop incomplete schema
4. [ ] Restore from backup (if applicable)
5. [ ] Analyze failure
6. [ ] Document issue

### If Verification Fails
1. [ ] Review verification script output
2. [ ] Identify missing components
3. [ ] Check error logs
4. [ ] Drop schema and reinstall
5. [ ] Verify again

### If Services Fail
1. [ ] Rollback backend code to previous version
2. [ ] Point database back to old schema (if using numbered migrations)
3. [ ] Restart services
4. [ ] Test API endpoints
5. [ ] Document issue
6. [ ] Plan remediation

### If Performance Degrades
1. [ ] Run EXPLAIN ANALYZE on slow queries
2. [ ] Check index usage
3. [ ] Verify statistics are current
4. [ ] Check for missing indexes
5. [ ] Profile trigger execution time
6. [ ] Adjust if needed

---

## Success Criteria

### Installation Success
- ✓ Schema created without errors
- ✓ All tables present
- ✓ All indexes created
- ✓ All triggers installed
- ✓ All constraints in place

### Testing Success
- ✓ Unit tests pass
- ✓ Integration tests pass
- ✓ Database tests pass
- ✓ Load tests pass
- ✓ Security tests pass

### Performance Success
- ✓ Notification queries <10ms
- ✓ Feature queries <5ms
- ✓ Exception queries <30ms
- ✓ Index usage verified
- ✓ No query regressions

### Deployment Success
- ✓ Production deployment complete
- ✓ All services online
- ✓ API endpoints functional
- ✓ Monitoring active
- ✓ Zero errors in logs

---

## Documentation Checklist

### Required Documents
- [ ] NORMALIZE_FULL_SCHEMA_README.md (overview)
- [ ] NORMALIZE_FULL_SCHEMA_USAGE_GUIDE.md (how-to)
- [ ] NORMALIZE_FULL_SCHEMA_CROSS_REFERENCE.md (technical)
- [ ] NORMALIZE_FULL_SCHEMA_VERIFICATION.sql (validation)
- [ ] DEPLOYMENT_CHECKLIST.md (this file)
- [ ] 3NF_NORMALIZATION_COMPLETE.md (context)

### Generated Documentation
- [ ] Architecture diagram showing new tables
- [ ] Performance benchmark report
- [ ] Migration guide for backend services
- [ ] RLS configuration guide
- [ ] Troubleshooting runbook

---

## Sign-Offs

### Development Team
- [ ] Code review: _________________ Date: _______
- [ ] Testing lead: _________________ Date: _______

### QA Team
- [ ] QA approval: _________________ Date: _______
- [ ] Performance sign-off: _________________ Date: _______

### Operations Team
- [ ] Ops approval: _________________ Date: _______
- [ ] Security approval: _________________ Date: _______

### Business
- [ ] Stakeholder sign-off: _________________ Date: _______
- [ ] Project manager: _________________ Date: _______

---

## Notes & Known Issues

### Identified Issues
- (none at this time)

### Workarounds
- (none required)

### Future Improvements
- [ ] Partition tables by tenant for large-scale deployments
- [ ] Add materialized views for complex queries
- [ ] Implement archival strategy for old audit logs
- [ ] Consider sharding strategy for multi-region

---

**Deployment Date**: _______________  
**Deployed By**: _______________  
**Verified By**: _______________  
**Status**: [ ] Successful [ ] Partial [ ] Rollback

**Notes**:
```




```

---

**Document Created**: September 3, 2026  
**Version**: 1.0  
**Status**: Ready for Use
