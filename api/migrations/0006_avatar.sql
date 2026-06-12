-- 0006_avatar.sql — user avatars are champion square icons picked from the
-- Data Dragon catalog already in `champions` (no upload infrastructure).
-- NULL = no avatar chosen; the frontend falls back to a generic icon.

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_champion_id TEXT
    REFERENCES champions(id) ON DELETE SET NULL;
