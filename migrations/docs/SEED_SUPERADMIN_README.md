# Super Admin Seed Migration

## Overview
This seed migration (`014-seed-superadmin.sql`) creates a default Super Admin user account for initial system setup and testing.

## Credentials

```
Email:    admin@system.local
Username: superadmin
Password: Admin123
Role:     super_admin
```

## How to Use

### Option 1: Using Supabase SQL Editor (Recommended)
1. Open your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Create a new query
4. Copy and paste the contents of `014-seed-superadmin.sql`
5. Click **Run**
6. Check the notification output for success/skip message

### Option 2: Using psql Command Line
```bash
psql -U postgres -d your_database_name -h your_host -f migrations/014-seed-superadmin.sql
```

Replace:
- `your_database_name` with your actual database name
- `your_host` with your database host (e.g., `db.example.com`)

### Option 3: Using Docker/Local PostgreSQL
```bash
docker exec your_container psql -U postgres -d your_database -f migrations/014-seed-superadmin.sql
```

## Safety Features

✅ **Idempotent:** The migration checks if `admin@system.local` already exists. If it does, the script skips creation and outputs a warning.

✅ **Transaction-safe:** Uses `BEGIN; ... COMMIT;` to ensure atomicity. If anything fails, the entire operation rolls back.

✅ **Informative:** Outputs clear NOTICE messages on success or skip.

## Verification

After running the migration, verify the account was created:

```sql
-- Check if superadmin user exists
SELECT id, email, username, role, created_at 
FROM users 
WHERE email = 'admin@system.local';
```

Expected output:
```
                   id                  |       email        |  username  |    role    |         created_at         
--------------------------------------+--------------------+------------+------------+----------------------------
 a1b2c3d4-e5f6-7890-abcd-ef1234567890 | admin@system.local | superadmin | super_admin | 2024-01-15 10:30:00+00:00
(1 row)
```

## Login Testing

Use these credentials to test login:

**via API:**
```bash
curl -X POST http://localhost:3003/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@system.local",
    "password": "Admin123"
  }'
```

**Expected response:**
```json
{
  "user": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "email": "admin@system.local",
    "username": "superadmin",
    "role": "super_admin"
  },
  "token": "eyJhbGc...",
  "refreshToken": "..."
}
```

## Security Warnings ⚠️

### IMPORTANT: For Production Deployments

1. **Change the default password immediately** after initial login
   - Use the admin panel to update the password
   - Or run: `UPDATE users SET password_hash = '[new_hash]' WHERE email = 'admin@system.local';`

2. **Delete or disable this account** after you've created your own permanent admin account with a strong password

3. **Never use this account for regular operations** — it's for initial setup only

4. **Never commit credentials** to version control

5. **Use environment variables** for production passwords:
   ```bash
   export SUPERADMIN_PASSWORD=$(openssl rand -base64 12)
   # Then use this in your seed script
   ```

## Generating Custom Passwords

To create a seed with a different password:

### Step 1: Generate bcryptjs Hash
```javascript
const bcrypt = require('bcryptjs');
const password = 'YourNewPassword123!';
const hash = bcrypt.hashSync(password, 10);
console.log('Hash:', hash);
console.log('Use this in the SQL file.');
```

### Step 2: Update the SQL File
Replace the password hash in `014-seed-superadmin.sql`:
```sql
'$2a$10$LiahozsSKtukMjIxhWKoVOpSjj2g.8iUgTPidylY5aQlLE7dByK0q',
```
with your new hash.

### Step 3: Run the Migration
Delete the existing admin user or update the email, then run the migration.

## Password Reset (if you forgot it)

If you lose access to the default admin account:

### Using Supabase Dashboard:
1. Go to **Authentication** → **Users**
2. Find `admin@system.local`
3. Click the user and reset their password
4. Use the reset link to set a new password

### Using SQL (if dashboard unavailable):
```sql
-- Generate a new hash for "NewPassword123"
-- Using: bcrypt.hashSync('NewPassword123', 10)
UPDATE users 
SET password_hash = '$2a$10$new_hash_here'
WHERE email = 'admin@system.local';
```

## Removing the Default Account

When you're ready to retire this account (recommended after setup):

```sql
-- Soft delete (if your schema supports it)
UPDATE users 
SET role = 'disabled' 
WHERE email = 'admin@system.local';

-- Or hard delete (if you have no constraints)
DELETE FROM users 
WHERE email = 'admin@system.local';
```

## Troubleshooting

### Account already exists
**Error:** Script outputs `⚠️ Superadmin account already exists (admin@system.local). Skipping creation.`

**Solution:** 
- If you need to reset the password, use the password reset flow in the admin panel
- Or delete the account first: `DELETE FROM users WHERE email = 'admin@system.local';`

### Hash verification fails
**Error:** Can't login after running the migration

**Solution:**
1. Verify the hash is correctly generated:
   ```javascript
   const bcrypt = require('bcryptjs');
   const valid = bcrypt.compareSync('Admin123', '$2a$10$LiahozsSKtukMjIxhWKoVOpSjj2g.8iUgTPidylY5aQlLE7dByK0q');
   console.log(valid); // should be true
   ```

2. Check that the email exists in the database:
   ```sql
   SELECT * FROM users WHERE email = 'admin@system.local';
   ```

3. If the account doesn't exist, delete and re-run the migration

### Permission denied
**Error:** `ERROR: permission denied for schema public`

**Solution:**
- Ensure your database user has SUPERUSER or CREATE privileges
- Use the Supabase SQL Editor (which has sufficient permissions) instead of psql with limited credentials

## Related Files

- **Seed Migration:** `Backend/migrations/014-seed-superadmin.sql`
- **Auth Logic:** `Backend/src/lib/auth.ts` (password hashing implementation)
- **User Schema:** `Backend/migrations/full_schema.sql` (users table definition)

## Migration Sequence

Run migrations in this order:

1. `full_schema.sql` — Creates all tables and schema
2. `014-seed-superadmin.sql` — Seeds default superadmin account
3. Other migrations or seeding scripts as needed

---

**Last Updated:** August 16, 2026  
**Status:** Production Ready ✅
