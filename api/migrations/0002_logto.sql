-- 0002_logto.sql — link users to Logto and relax legacy auth constraints.
-- Logto becomes the identity provider; the local users row keeps app data (votes/stats),
-- keyed to Logto's `sub` via logto_id.

ALTER TABLE users ADD COLUMN IF NOT EXISTS logto_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_logto_id ON users (logto_id) WHERE logto_id IS NOT NULL;

-- New accounts come from Logto; legacy auth fields are no longer required.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- NOTE (post-cutover cleanup, run manually once all users have logto_id):
--   ALTER TABLE users DROP COLUMN password_hash, DROP COLUMN is_verified,
--     DROP COLUMN verification_token, DROP COLUMN reset_token, DROP COLUMN reset_token_expires;
