-- 0007_drop_splash_ok.sql — retire the phantom-splash flag.
-- The catalog now sources art from Community Dragon, which has complete
-- per-skin coverage. The post-sync splash sweep that maintained splash_ok
-- was removed and the flag was always true; reads no longer reference it.
ALTER TABLE skins DROP COLUMN IF EXISTS splash_ok;
