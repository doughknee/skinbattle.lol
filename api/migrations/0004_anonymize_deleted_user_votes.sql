-- 0004_anonymize_deleted_user_votes.sql — retain votes of deleted users.
-- Deleting a user previously cascaded away their user_skin_votes rows, so the
-- denormalized skins.total_* counts silently dropped their contribution on the
-- next recount. Instead, keep the vote rows and detach them from the user:
-- user_id becomes nullable and the FK switches to ON DELETE SET NULL.
--
-- The old composite PRIMARY KEY (skin_id, user_id) cannot hold NULLs, so it is
-- replaced by a UNIQUE constraint on the same columns. NULLs are distinct in a
-- unique constraint, so a skin may accumulate many anonymized rows, while the
-- vote upsert's ON CONFLICT (skin_id, user_id) — always called with a non-NULL
-- user_id — keeps matching this constraint exactly as it matched the PK.
--
-- Constraint names are resolved from the catalog rather than hardcoded, since
-- a pre-existing prod table may not use the default names from 0001_init.sql.

DO $$
DECLARE
    pk_name text;
    fk_name text;
BEGIN
    SELECT conname INTO pk_name
    FROM pg_constraint
    WHERE conrelid = 'user_skin_votes'::regclass AND contype = 'p';
    IF pk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE user_skin_votes DROP CONSTRAINT %I', pk_name);
    END IF;

    SELECT conname INTO fk_name
    FROM pg_constraint
    WHERE conrelid = 'user_skin_votes'::regclass
      AND contype = 'f'
      AND confrelid = 'users'::regclass;
    IF fk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE user_skin_votes DROP CONSTRAINT %I', fk_name);
    END IF;
END $$;

ALTER TABLE user_skin_votes ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE user_skin_votes
    ADD CONSTRAINT user_skin_votes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE user_skin_votes
    ADD CONSTRAINT user_skin_votes_skin_user_key UNIQUE (skin_id, user_id);
