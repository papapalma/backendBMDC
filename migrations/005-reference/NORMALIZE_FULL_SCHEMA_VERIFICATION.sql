-- =============================================================================
-- NORMALIZE_FULL_SCHEMA_VERIFICATION.sql
--
-- Post-installation verification queries for Normalize_full_schema.sql
-- Run these after executing the schema to confirm all components are in place.
--
-- =============================================================================

-- ============================================================================= 
-- 1. VERIFY ALL NORMALIZED TABLES EXIST (5 tables)
-- =============================================================================

SELECT 
  tablename,
  'OK' as status
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN (
    'trainee_notification_preferences',
    'tenant_branding',
    'tenant_notification_channels',
    'tenant_features',
    'attendance_exceptions'
  )
ORDER BY tablename;

-- Expected output: 5 rows, all "OK"
-- If fewer than 5, normalized tables are missing


-- =============================================================================
-- 2. VERIFY REGISTRATION STATUS FIELDS EXIST ON TRAINEES (4 columns)
-- =============================================================================

SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'trainees'
  AND column_name IN (
    'registration_status',
    'registration_rejection_reason',
    'registration_reviewed_by',
    'registration_reviewed_at'
  )
ORDER BY column_name;

-- Expected output: 4 rows with correct data types
-- registration_status: character varying, not nullable
-- registration_rejection_reason: text, nullable
-- registration_reviewed_by: uuid, nullable
-- registration_reviewed_at: timestamp with time zone, nullable


-- =============================================================================
-- 3. VERIFY ENFORCEMENT TRIGGERS INSTALLED (10 functions + triggers)
-- =============================================================================

SELECT 
  trigger_name,
  event_object_table as table_name,
  action_statement,
  action_orientation,
  'OK' as status
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name IN (
    'set_updated_at_tenants',
    'set_updated_at_users',
    'set_updated_at_trainees',
    'set_updated_at_programs',
    'set_updated_at_items',
    'set_updated_at_enrollments',
    'set_updated_at_attendance',
    'set_updated_at_certificates',
    'set_updated_at_trainee_notification_preferences',
    'set_updated_at_tenant_branding',
    'set_updated_at_tenant_notification_channels',
    'set_updated_at_tenant_features',
    'set_updated_at_attendance_exceptions',
    'enforce_registration_transitions',
    'enforce_trainee_status_consistency',
    'enforce_enrollment_constraints',
    'validate_attendance_exception',
    'initialize_trainee_notification_preferences',
    'initialize_tenant_branding'
  )
ORDER BY event_object_table, trigger_name;

-- Expected output: 19 rows (update triggers for 8 tables + 10 enforcement triggers + init triggers)


-- =============================================================================
-- 4. VERIFY PERFORMANCE INDEXES CREATED (12+ indexes)
-- =============================================================================

SELECT 
  indexname,
  tablename,
  'OK' as status
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- Expected output: 12+ indexes matching the pattern idx_*
-- Critical indexes:
--   - idx_trainee_notification_prefs_tenant_trainee
--   - idx_trainee_notification_prefs_trainee
--   - idx_tenant_notification_channels_tenant
--   - idx_tenant_features_tenant
--   - idx_attendance_exceptions_tenant
--   - idx_attendance_exceptions_program
--   - idx_attendance_exceptions_trainee
--   - idx_attendance_exceptions_date
--   - idx_enrollments_trainee_status
--   - idx_trainees_registration_status


-- =============================================================================
-- 5. VERIFY UNIQUE CONSTRAINTS ENFORCED (5 constraints)
-- =============================================================================

SELECT 
  constraint_name,
  table_name,
  'OK' as status
FROM information_schema.table_constraints
WHERE constraint_type = 'UNIQUE'
  AND table_schema = 'public'
  AND (
    (table_name = 'trainees' AND constraint_name LIKE '%email%')
    OR (table_name = 'programs' AND constraint_name LIKE '%name%')
    OR (table_name = 'items' AND constraint_name LIKE '%name%')
    OR (table_name = 'tenant_notification_channels' AND constraint_name LIKE '%channel%')
    OR (table_name = 'tenant_features' AND constraint_name LIKE '%feature%')
  )
ORDER BY table_name, constraint_name;

-- Expected output: 5+ unique constraints


-- =============================================================================
-- 6. VERIFY CHECK CONSTRAINTS IN PLACE (critical ones)
-- =============================================================================

SELECT 
  constraint_name,
  table_name,
  'OK' as status
FROM information_schema.check_constraints
WHERE constraint_schema = 'public'
  AND table_name IN (
    'trainees',
    'tenants',
    'attendance_exceptions',
    'tenant_notification_channels'
  )
ORDER BY table_name, constraint_name;

-- Expected output: 10+ check constraints


-- =============================================================================
-- 7. VERIFY RLS POLICIES ENABLED (multi-tenant isolation)
-- =============================================================================

SELECT 
  tablename,
  COUNT(*) as policy_count,
  'OK' as status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'trainees',
    'programs',
    'items',
    'enrollments',
    'attendance',
    'trainee_notification_preferences',
    'tenant_branding',
    'tenant_notification_channels',
    'tenant_features',
    'attendance_exceptions'
  )
GROUP BY tablename
ORDER BY tablename;

-- Expected output: 10+ tables with RLS policies
-- Each table should have policies for:
--   - SELECT (multi-tenant filtering by tenant_id)
--   - INSERT (tenant_id validation)
--   - UPDATE (tenant_id validation)
--   - DELETE (tenant_id validation)


-- =============================================================================
-- 8. VERIFY FOREIGN KEY RELATIONSHIPS INTACT
-- =============================================================================

SELECT 
  tc.table_name,
  kcu.column_name,
  ccu.table_name as referenced_table,
  ccu.column_name as referenced_column,
  'OK' as status
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu 
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu 
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN (
    'trainee_notification_preferences',
    'tenant_branding',
    'tenant_notification_channels',
    'tenant_features',
    'attendance_exceptions'
  )
ORDER BY tc.table_name, kcu.column_name;

-- Expected output: All foreign keys to tenants, trainees, programs properly defined
-- Verify ON DELETE CASCADE for data integrity


-- =============================================================================
-- 9. VERIFY SCHEMA STRUCTURE - COMPARE AGAINST BASELINE
-- =============================================================================

-- Count total tables
SELECT COUNT(*) as total_tables FROM pg_tables WHERE schemaname = 'public';
-- Expected: 40+ tables

-- Count total functions
SELECT COUNT(*) as total_functions FROM pg_proc WHERE pronamespace = 'public'::regnamespace;
-- Expected: 50+ functions (utilities + triggers + validators)

-- Count total indexes
SELECT COUNT(*) as total_indexes FROM pg_indexes WHERE schemaname = 'public';
-- Expected: 50+ indexes


-- =============================================================================
-- 10. TEST CORE FUNCTIONALITY
-- =============================================================================

-- Test 1: Verify trigger for updated_at works
-- (Skip if testing in transaction; triggers may not fire in rollback scenarios)

-- Test 2: Verify trainee notification preferences auto-initialization would work
-- INSERT INTO tenants (name, contact_email) VALUES ('Test Tenant', 'test@example.com');
-- INSERT INTO programs (tenant_id, name, description) VALUES (
--   (SELECT id FROM tenants WHERE name = 'Test Tenant'),
--   'Test Program',
--   'Test Description'
-- );
-- INSERT INTO trainees (tenant_id, email, password, status) VALUES (
--   (SELECT id FROM tenants WHERE name = 'Test Tenant'),
--   'trainee@example.com',
--   'hashed_password',
--   'active'
-- );
-- SELECT * FROM trainee_notification_preferences 
-- WHERE email = (SELECT id FROM trainees WHERE email = 'trainee@example.com');
-- Expected: Should have auto-created preference row with all enabled=true


-- =============================================================================
-- 11. PERFORMANCE BASELINE QUERIES (for regression testing)
-- =============================================================================

-- Query 1: Get trainee notification preferences (should use index)
-- EXPLAIN ANALYZE
-- SELECT * FROM trainee_notification_preferences 
-- WHERE trainee_id = $1;

-- Query 2: Get tenant features (should use index)
-- EXPLAIN ANALYZE
-- SELECT * FROM tenant_features 
-- WHERE tenant_id = $1 AND is_enabled = true;

-- Query 3: Get attendance exceptions for date range (should use index)
-- EXPLAIN ANALYZE
-- SELECT * FROM attendance_exceptions 
-- WHERE tenant_id = $1 
--   AND exception_date BETWEEN $2 AND $3;

-- Query 4: Get trainee's primary program (should use enrollments index)
-- EXPLAIN ANALYZE
-- SELECT program_id FROM enrollments 
-- WHERE trainee_id = $1 
--   AND status IN ('enrolled', 'active')
-- LIMIT 1;


-- =============================================================================
-- 12. SUMMARY REPORT
-- =============================================================================

-- Run this as final check:
WITH counts AS (
  SELECT 
    (SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public') as total_tables,
    (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public') as total_indexes,
    (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = 'public') as total_triggers,
    (SELECT COUNT(*) FROM information_schema.table_constraints 
     WHERE constraint_type = 'UNIQUE' AND table_schema = 'public') as unique_constraints,
    (SELECT COUNT(*) FROM information_schema.check_constraints 
     WHERE constraint_schema = 'public') as check_constraints,
    (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public') as rls_policies
)
SELECT 
  'SCHEMA VERIFICATION SUMMARY' as check_type,
  'Tables' as metric,
  CAST(total_tables AS VARCHAR) || ' (Expected: 40+)' as value,
  CASE WHEN total_tables >= 40 THEN '✓ PASS' ELSE '✗ FAIL' END as status
FROM counts
UNION ALL
SELECT 
  'SCHEMA VERIFICATION SUMMARY',
  'Indexes',
  CAST(total_indexes AS VARCHAR) || ' (Expected: 50+)',
  CASE WHEN total_indexes >= 50 THEN '✓ PASS' ELSE '✗ FAIL' END
FROM counts
UNION ALL
SELECT 
  'SCHEMA VERIFICATION SUMMARY',
  'Triggers',
  CAST(total_triggers AS VARCHAR) || ' (Expected: 30+)',
  CASE WHEN total_triggers >= 30 THEN '✓ PASS' ELSE '✗ FAIL' END
FROM counts
UNION ALL
SELECT 
  'SCHEMA VERIFICATION SUMMARY',
  'Unique Constraints',
  CAST(unique_constraints AS VARCHAR) || ' (Expected: 15+)',
  CASE WHEN unique_constraints >= 15 THEN '✓ PASS' ELSE '✗ FAIL' END
FROM counts
UNION ALL
SELECT 
  'SCHEMA VERIFICATION SUMMARY',
  'Check Constraints',
  CAST(check_constraints AS VARCHAR) || ' (Expected: 10+)',
  CASE WHEN check_constraints >= 10 THEN '✓ PASS' ELSE '✗ FAIL' END
FROM counts
UNION ALL
SELECT 
  'SCHEMA VERIFICATION SUMMARY',
  'RLS Policies',
  CAST(rls_policies AS VARCHAR) || ' (Expected: 30+)',
  CASE WHEN rls_policies >= 30 THEN '✓ PASS' ELSE '✗ FAIL' END
FROM counts;

-- =============================================================================
-- END OF VERIFICATION SCRIPT
-- =============================================================================
