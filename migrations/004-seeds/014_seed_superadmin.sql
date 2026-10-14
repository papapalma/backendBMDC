  -- =============================================================================
  -- Migration: 014-seed-superadmin.sql
  -- Description: Seeds a Super Admin user account for initial system setup
  -- 
  -- WARNING: This migration creates a default superadmin account with a known password.
  -- After first login, CHANGE THIS PASSWORD IMMEDIATELY in production.
  -- This account should only be used for initial system configuration.
  -- 
  -- Superadmin Credentials:
  --   Email: superadmin@bmdc.gov.ph
  --   Username: superadmin
  --   Password: Admin123
  --   Role: super_admin
  --
  -- To use this migration:
  --   1. Connect to your Supabase PostgreSQL database
  --   2. Run this script: psql -U postgres -d your_database -f 014-seed-superadmin.sql
  --   3. Or paste contents into Supabase SQL Editor
  --
  -- Security Notes:
  --   - The password hash ($2b$10$...) corresponds to "Admin123" using bcryptjs
  --   - After deployment, create a new admin account with a strong password
  --   - Delete this default account or disable it after initial setup
  --   - Store credentials securely in environment variables or secrets management
  -- =============================================================================

  BEGIN;

  -- Check if superadmin already exists to prevent duplicates
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'superadmin@bmdc.gov.ph') THEN
      -- Insert the superadmin user
      -- Password hash for "Admin123" (bcryptjs, salt rounds: 10)
      -- To regenerate: bcryptjs.hashSync('Admin123', 10)
      INSERT INTO users (
        id,
        email,
        username,
        password_hash,
        role,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        'superadmin@bmdc.gov.ph',
        'superadmin',
        '$2a$10$LiahozsSKtukMjIxhWKoVOpSjj2g.8iUgTPidylY5aQlLE7dByK0q',  -- bcryptjs hash of "Admin123"
        'super_admin',
        NOW(),
        NOW()
      );
      
      RAISE NOTICE '✅ Superadmin account created successfully';
      RAISE NOTICE '   Email: superadmin@bmdc.gov.ph';
      RAISE NOTICE '   Username: superadmin';
      RAISE NOTICE '   Password: Admin123';
      RAISE NOTICE '⚠️  WARNING: Change this password immediately after first login!';
    ELSE
      RAISE NOTICE '⚠️  Superadmin account already exists (admin@system.local). Skipping creation.';
    END IF;
  END
  $$;

  COMMIT;

  -- =============================================================================
  -- Verification Queries (uncomment to verify seed was successful)
  -- =============================================================================

  -- Check if superadmin user was created
  -- SELECT id, email, username, role, created_at FROM users 
  -- WHERE email = 'superadmin@bmdc.gov.ph';

  -- Check all users in the system
  -- SELECT id, email, username, role, created_at FROM users ORDER BY created_at DESC;

  -- =============================================================================
  -- Notes for Developers
  -- =============================================================================
  --
  -- If you need to test different passwords, use this Node.js snippet:
  --
  --   const bcrypt = require('bcryptjs');
  --   const password = 'Admin123';
  --   const hash = bcrypt.hashSync(password, 10);
  --   console.log(hash);
  --
  -- Then replace the $2b$10$... value in the SQL above.
  --
  -- Password hash breakdown:
  --   $2b$    = bcryptjs algorithm identifier
  --   10$     = cost factor (salt rounds)
  --   YRHHbvLvLx3GKUQABL.0/e8cJp0A0I.K5Uz.cQFJOE5lHhW/aGEuW = encrypted password
  --
  -- To verify hash locally:
  --   const match = bcrypt.compareSync('Admin123', '$2a$10$LiahozsSKtukMjIxhWKoVOpSjj2g.8iUgTPidylY5aQlLE7dByK0q');
  --   console.log(match); // should output: true
  --
  -- =============================================================================
