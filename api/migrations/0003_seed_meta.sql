-- 0003_seed_meta.sql — tracks the Data Dragon patch the catalog was synced to,
-- so the API only re-imports champions/skins when a newer patch is available.

CREATE TABLE IF NOT EXISTS seed_meta (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
