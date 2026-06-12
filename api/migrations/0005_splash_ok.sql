-- 0005_splash_ok.sql — phantom-splash flag.
-- Data Dragon's championFull.json lists ~61 chroma variants as skins with
-- plain names ("Zac Sweet Orange", "Headhunter Master Yi Strike Crimson")
-- whose splash art 403s on the CDN. They aren't real votable skins, but
-- their rows may already carry votes — so reads hide them, nothing deletes
-- them. The flag is maintained by the post-sync splash sweep
-- (internal/ddragon.SweepSplashes), which also repoints real skins served
-- under a legacy asset casing (Fiddlesticks → FiddleSticks_<num>.jpg).
ALTER TABLE skins ADD COLUMN IF NOT EXISTS splash_ok BOOLEAN NOT NULL DEFAULT true;
