-- Migration: 001_sync_trainee_and_user_emails.sql
-- Description: Enforce 100% email synchronization between trainees and users tables via trainee_accounts

-- 1. Sync function: when trainees.email changes -> update users.email
CREATE OR REPLACE FUNCTION sync_trainee_email_to_user()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE users u
    SET email = LOWER(TRIM(NEW.email)),
        updated_at = NOW()
    FROM trainee_accounts ta
    WHERE ta.trainee_id = NEW.id
      AND ta.user_id = u.id
      AND LOWER(TRIM(u.email)) IS DISTINCT FROM LOWER(TRIM(NEW.email));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_trainee_email_to_user ON trainees;
CREATE TRIGGER trg_sync_trainee_email_to_user
AFTER UPDATE OF email ON trainees
FOR EACH ROW
EXECUTE FUNCTION sync_trainee_email_to_user();

-- 2. Sync function: when users.email changes -> update trainees.email
CREATE OR REPLACE FUNCTION sync_user_email_to_trainee()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE trainees t
    SET email = LOWER(TRIM(NEW.email)),
        updated_at = NOW()
    FROM trainee_accounts ta
    WHERE ta.user_id = NEW.id
      AND ta.trainee_id = t.id
      AND LOWER(TRIM(t.email)) IS DISTINCT FROM LOWER(TRIM(NEW.email));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_user_email_to_trainee ON users;
CREATE TRIGGER trg_sync_user_email_to_trainee
AFTER UPDATE OF email ON users
FOR EACH ROW
EXECUTE FUNCTION sync_user_email_to_trainee();
