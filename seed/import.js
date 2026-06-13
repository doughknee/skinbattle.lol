// Imports champions + skins into Postgres: champion fields from Riot's Data
// Dragon, skin art from Community Dragon (complete per-skin splashes).
//
// - Defaults to the LATEST Data Dragon patch (set DDRAGON_VERSION to pin one).
// - Idempotent upsert: adds new champions/skins and refreshes metadata without
//   ever touching vote tallies (skins.total_* / user_skin_votes). The skin id
//   is identical across Data Dragon and Community Dragon, so art re-points in
//   place and no vote is ever orphaned.
// - Tracks the imported patch in `seed_meta`, so on redeploy it re-syncs only
//   when a newer patch is available (otherwise it skips fast).
//
// Designed to run as a one-shot service in the deployment stack: it waits for
// the API to apply migrations (tables exist), then syncs. The API itself also
// syncs on startup; this is the standalone equivalent.
//
// Usage:
//   DATABASE_URL=postgres://user:pass@host:5432/db node import.js          # latest
//   DATABASE_URL=... DDRAGON_VERSION=16.12.1 node import.js                 # pinned

import { Pool } from 'pg';

const VERSIONS_URL = 'https://ddragon.leagueoflegends.com/api/versions.json';
const CDRAGON_BASE =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default';
// Forces a one-time re-import when the ingest changes without a League patch
// bump (e.g. the Data Dragon → Community Dragon art switch). Keep in sync with
// api/internal/ddragon (catalogRev). Bump to rebuild stored art.
// cdragon-2: reconcile away stale Data-Dragon-only skins (broken splashes).
const CATALOG_REV = 'cdragon-2';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Turn a Community Dragon asset path into a CDN URL: strip the
// /lol-game-data/assets prefix and lowercase the rest (host stays as-is).
const cdragonAsset = (path) =>
  path
    ? CDRAGON_BASE + path.replace(/^\/lol-game-data\/assets/i, '').toLowerCase()
    : '';

// Resolve the target patch: explicit DDRAGON_VERSION, else the newest published.
async function resolveVersion() {
  const pinned = (process.env.DDRAGON_VERSION || '').trim();
  if (pinned && pinned.toLowerCase() !== 'latest') return pinned;
  const res = await fetch(VERSIONS_URL);
  if (!res.ok) throw new Error(`versions.json: ${res.status}`);
  const arr = await res.json();
  if (!Array.isArray(arr) || arr.length === 0)
    throw new Error('versions.json returned no versions');
  return arr[0];
}

// Champion fields (id/key/title/blurb/lore) for the whole roster in one fetch.
async function fetchChampions(version) {
  const res = await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/championFull.json`,
  );
  if (!res.ok) throw new Error(`championFull: ${res.status}`);
  const json = await res.json();
  return Object.values(json.data);
}

// Every skin, keyed by numeric id (= championKey*1000 + num), with art paths.
async function fetchSkins() {
  const res = await fetch(`${CDRAGON_BASE}/v1/skins.json`);
  if (!res.ok) throw new Error(`cdragon skins: ${res.status}`);
  return res.json();
}

async function insertChampion(client, c) {
  await client.query(
    `INSERT INTO champions (id, lore, key, blurb, title)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE
       SET lore = EXCLUDED.lore, key = EXCLUDED.key,
           blurb = EXCLUDED.blurb, title = EXCLUDED.title`,
    [c.id, c.lore, c.key, c.blurb, c.title],
  );
}

async function insertSkin(client, championId, skin) {
  await client.query(
    `INSERT INTO skins (id, champion_id, num, name, chromas, splash_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE
       SET champion_id = EXCLUDED.champion_id, num = EXCLUDED.num,
           name = EXCLUDED.name, chromas = EXCLUDED.chromas,
           splash_url = EXCLUDED.splash_url`,
    [
      String(skin.id),
      championId,
      skin.id % 1000,
      skin.name,
      !!skin.chromaPath,
      cdragonAsset(skin.splashPath),
    ],
  );
}

// Wait until the API has applied migrations (the `skins` table exists).
async function waitForSchema(timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const r = await pool.query("SELECT to_regclass('public.skins') AS t");
      if (r.rows[0].t !== null) return;
      console.log('waiting for schema (tables not created yet)...');
    } catch (err) {
      lastErr = err;
      console.log(`waiting for database... (${err.code || err.message})`);
    }
    await sleep(3000);
  }
  throw new Error(
    `schema not ready after ${timeoutMs}ms${lastErr ? `: ${lastErr.message}` : ''}`,
  );
}

async function ensureMeta() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS seed_meta (
       key        TEXT PRIMARY KEY,
       value      TEXT NOT NULL,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
}

async function getMeta(key) {
  const r = await pool.query('SELECT value FROM seed_meta WHERE key = $1', [key]);
  return r.rows[0]?.value ?? null;
}

async function setMeta(key, value) {
  await pool.query(
    `INSERT INTO seed_meta (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
}

async function championCount() {
  const r = await pool.query('SELECT count(*)::int AS n FROM champions');
  return r.rows[0].n;
}

async function main() {
  await waitForSchema();
  await ensureMeta();

  const version = await resolveVersion();
  const lastVersion = await getMeta('ddragon_version');
  const lastRev = await getMeta('catalog_rev');
  const count = await championCount();

  if (count > 0 && lastVersion === version && lastRev === CATALOG_REV) {
    console.log(
      `already at Data Dragon ${version} rev ${CATALOG_REV} (${count} champions); nothing to sync.`,
    );
    return;
  }

  console.log(
    lastVersion
      ? `syncing Data Dragon ${lastVersion} -> ${version}`
      : `seeding Data Dragon ${version}`,
  );

  const champions = await fetchChampions(version);
  console.log(`Fetched ${champions.length} champions`);

  const skins = await fetchSkins();
  // Champion key (numeric) → champion id, to map skin ids onto champions.
  const byKey = new Map();
  for (const c of champions) byKey.set(Number(c.key), c.id);

  const client = await pool.connect();
  try {
    for (const champ of champions) await insertChampion(client, champ);

    let skinTotal = 0;
    const present = [];
    for (const skin of Object.values(skins)) {
      const championId = byKey.get(Math.floor(skin.id / 1000));
      if (!championId) continue; // a champion championFull doesn't list
      await insertSkin(client, championId, skin);
      present.push(String(skin.id));
      skinTotal++;
    }
    // Reconcile: drop leftover Data-Dragon-only skins Community Dragon no longer
    // lists (old chromas/phantoms), keeping any that carry votes so none is lost.
    const pruned = await client.query(
      `DELETE FROM skins s
         WHERE s.id <> ALL($1::text[])
           AND NOT EXISTS (SELECT 1 FROM user_skin_votes v WHERE v.skin_id = s.id)`,
      [present],
    );
    console.log(
      `Synced ${champions.length} champions / ${skinTotal} skins (art: Community Dragon)` +
        (pruned.rowCount ? `; pruned ${pruned.rowCount} stale skins.` : '.'),
    );
  } finally {
    client.release();
  }

  await setMeta('ddragon_version', version);
  await setMeta('catalog_rev', CATALOG_REV);
  console.log(`Recorded patch ${version} rev ${CATALOG_REV}.`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end();
    process.exit(1);
  });
