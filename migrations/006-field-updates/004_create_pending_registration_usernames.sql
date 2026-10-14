CREATE TABLE IF NOT EXISTS pending_registration_usernames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_id UUID NOT NULL UNIQUE REFERENCES trainees(id) ON DELETE CASCADE,
  username VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_registration_usernames_trainee_id 
  ON pending_registration_usernames(trainee_id);

ALTER TABLE pending_registration_usernames ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow insert for registrations" 
  ON pending_registration_usernames FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow service role access" 
  ON pending_registration_usernames FOR ALL 
  USING (true) WITH CHECK (true);
