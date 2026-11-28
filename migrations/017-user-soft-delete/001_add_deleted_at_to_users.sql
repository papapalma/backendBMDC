-- =============================================================================
-- Migration 017: Add Soft-Delete Support to public.users
-- =============================================================================
-- Purpose:
--   1. Add deleted_at TIMESTAMPTZ column and index to public.users.
--   2. Replace global UNIQUE constraints on users(email) and users(username)
--      with partial unique indexes (WHERE deleted_at IS NULL) so archived
--      accounts do not block creating new accounts with the same email/username.
--   3. Switch activity_logs.user_id to nullable + ON DELETE SET NULL (matching
--      audit_logs.user_id) so even a permanent 30-day archive purge preserves
--      tenant activity history.
--
-- Run this script once in the Supabase SQL Editor before archiving user accounts.
-- =============================================================================

BEGIN;

-- 1. Add deleted_at column and supporting index
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at
  ON public.users (deleted_at);

-- 2. Drop legacy global UNIQUE constraints on users(email) and users(username)
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'users'
      AND con.contype = 'u'
      AND (
        SELECT array_agg(att.attname::text ORDER BY att.attname)
        FROM unnest(con.conkey) AS colnum
        JOIN pg_attribute att
          ON att.attrelid = con.conrelid AND att.attnum = colnum
      ) IN (ARRAY['email'], ARRAY['username'])
  LOOP
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT IF EXISTS %I', rec.conname);
  END LOOP;
END $$;

-- 3. Create partial unique indexes for active (non-archived) accounts only
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_active_email_unique
  ON public.users (LOWER(email))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_active_username_unique
  ON public.users (username)
  WHERE deleted_at IS NULL;

-- 4. Preserve tenant activity_logs even when an archived user is permanently purged
ALTER TABLE public.activity_logs
  ALTER COLUMN user_id DROP NOT NULL;

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_class frel ON frel.oid = con.confrelid
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'activity_logs'
      AND con.contype = 'f'
      AND frel.relname = 'users'
      AND (
        SELECT array_agg(att.attname::text)
        FROM unnest(con.conkey) AS colnum
        JOIN pg_attribute att
          ON att.attrelid = con.conrelid AND att.attnum = colnum
      ) = ARRAY['user_id']
  LOOP
    EXECUTE format('ALTER TABLE public.activity_logs DROP CONSTRAINT IF EXISTS %I', rec.conname);
  END LOOP;
END $$;

ALTER TABLE public.activity_logs
  ADD CONSTRAINT activity_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

COMMIT;

-- =============================================================================
-- Verification queries (run separately in Supabase SQL Editor if desired):
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'deleted_at';
--
--   SELECT indexname, indexdef
--   FROM pg_indexes
--   WHERE schemaname = 'public' AND tablename = 'users'
--     AND indexname IN ('idx_users_deleted_at', 'idx_users_active_email_unique', 'idx_users_active_username_unique');
-- =============================================================================
