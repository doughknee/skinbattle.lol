// Imports champions + skins from Riot's Data Dragon CDN into Postgres.
//
// - Defaults to the LATEST Data Dragon patch (set DDRAGON_VERSION to pin one).
// - Idempotent upsert: adds new champions/skins and refreshes metadata without
//   ever touching vote tallies (skins.total_* / user_skin_votes).
// - Tracks the imported patch in `seed_meta`, so on redeploy it re-syncs only
//   when a newer patch is available (otherwise it skips fast).
//
// Designed to run as a one-shot service in the deployment stack: it waits for
// the API to apply migrations (tables exist), then syncs.
//
// Usage:
//   DATABASE_URL=postgres://user:pass@host:5432/db node import.js          # latest
//   DATABASE_URL=... DDRAGON_VERSION=16.12.1 node import.js                 # pinned

import { Pool } from 'pg';

const VERSIONS_URL = 'https://ddragon.leagueoflegends.com/api/versions.json';
const SPLASH_BASE_URL =
  'https://ddragon.leagueoflegends.com/cdn/img/champion/splash';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Data Dragon lists chroma color variants as separate skin entries named
// "Base Skin (ColorName)". They aren't real votable skins, so skip them.
const isChroma = (name) => /\s\(.+\)$/.test(name);

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

async function fetchChampionList(version) {
  const res = await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`,
  );
  if (!res.ok) throw new Error(`champion list: ${res.status}`);
  const json = await res.json();
  return Object.keys(json.data);
}

async function fetchChampionDetails(names, version) {
  const results = await Promise.all(
    names.map(async (name) => {
      try {
        const res = await fetch(
          `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion/${name}.json`,
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json();
        return json.data[name];
      } catch (err) {
        console.error(`details for ${name} failed:`, err.message);
        return null;
      }
    }),
  );
  return results.filter(Boolean);
}

function cleanChampion(data) {
  const { id, lore, key, blurb, title, skins } = data;
  const enrichedSkins = skins.map((skin) => ({
    ...skin,
    splashUrl: `${SPLASH_BASE_URL}/${id}_${skin.num}.jpg`,
  }));
  return { id, lore, key, blurb, title, skins: enrichedSkins };
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
       SET name = EXCLUDED.name, chromas = EXCLUDED.chromas,
           splash_url = EXCLUDED.splash_url`,
    [String(skin.id), championId, skin.num, skin.name, !!skin.chromas, skin.splashUrl],
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
  const count = await championCount();

  if (count > 0 && lastVersion === version) {
    console.log(
      `already at Data Dragon ${version} (${count} champions); nothing to sync.`,
    );
    return;
  }

  console.log(
    lastVersion
      ? `syncing Data Dragon ${lastVersion} -> ${version}`
      : `seeding Data Dragon ${version}`,
  );

  const names = await fetchChampionList(version);
  console.log(`Fetched ${names.length} champion names`);

  const details = await fetchChampionDetails(names, version);
  const cleaned = details.map(cleanChampion);
  console.log(`Fetched details for ${cleaned.length} champions`);

  const client = await pool.connect();
  try {
    let skinTotal = 0;
    for (const champ of cleaned) {
      await insertChampion(client, champ);
      for (const skin of champ.skins) {
        if (isChroma(skin.name)) continue; // chroma variant, not a real skin
        await insertSkin(client, champ.id, skin);
        skinTotal++;
      }
    }
    console.log(`Synced ${cleaned.length} champions / ${skinTotal} skins.`);
  } finally {
    client.release();
  }

  await setMeta('ddragon_version', version);
  console.log(`Recorded patch ${version}.`);
}

main()
  .catch((err) => {
    console.error('Import failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
