-- 0001_init.sql — base schema (mirrors the original Next.js/Postgres model)
-- Safe to run against an existing prod DB: all objects use IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS champions (
    id    TEXT PRIMARY KEY,
    key   TEXT,
    title TEXT,
    blurb TEXT,
    lore  TEXT
);

CREATE TABLE IF NOT EXISTS skins (
    id           TEXT PRIMARY KEY,
    champion_id  TEXT NOT NULL REFERENCES champions(id) ON DELETE CASCADE,
    num          INTEGER NOT NULL,
    name         TEXT,
    chromas      BOOLEAN NOT NULL DEFAULT false,
    splash_url   TEXT,
    total_votes  INTEGER NOT NULL DEFAULT 0,
    total_stars  INTEGER NOT NULL DEFAULT 0,
    total_x      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_skins_champion_id ON skins (champion_id);
CREATE INDEX IF NOT EXISTS idx_skins_total_stars ON skins (total_stars DESC);
CREATE INDEX IF NOT EXISTS idx_skins_total_x     ON skins (total_x DESC);

CREATE TABLE IF NOT EXISTS users (
    id                  BIGSERIAL PRIMARY KEY,
    email               TEXT UNIQUE NOT NULL,
    username            TEXT UNIQUE NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- legacy auth columns (kept for data import; unused once Logto is the IdP):
    password_hash       TEXT,
    is_verified         BOOLEAN NOT NULL DEFAULT false,
    verification_token  TEXT,
    reset_token         TEXT,
    reset_token_expires TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_skin_votes (
    skin_id  TEXT NOT NULL REFERENCES skins(id) ON DELETE CASCADE,
    user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vote     INTEGER NOT NULL DEFAULT 0,
    star     BOOLEAN NOT NULL DEFAULT false,
    x        BOOLEAN NOT NULL DEFAULT false,
    voted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (skin_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_usv_user_id ON user_skin_votes (user_id);
