-- 0008_drop_star_ban.sql — remove the star/ban catalog-voting system.
-- Stars and bans (plus the long-frozen up/down `vote` column) were the only
-- reason user_skin_votes and the denormalized skins.total_stars/total_x
-- counters existed. Head-to-head Elo is the sole ranking now, so this drops
-- the lot. The legacy skins.total_votes column is left alone — it predates
-- this feature and is a separate, already-dead concern.
--
-- Idempotent: every drop uses IF EXISTS, so a fresh DB (which created these
-- objects in 0001) and a populated prod DB both converge to the same shape.

DROP TABLE IF EXISTS user_skin_votes;

DROP INDEX IF EXISTS idx_skins_total_stars;
DROP INDEX IF EXISTS idx_skins_total_x;

ALTER TABLE skins DROP COLUMN IF EXISTS total_stars;
ALTER TABLE skins DROP COLUMN IF EXISTS total_x;
