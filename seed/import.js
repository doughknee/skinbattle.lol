// Imports champions + skins from Riot's Data Dragon CDN into Postgres.
// Idempotent: re-running upserts champion metadata and inserts any new skins
// without disturbing existing vote tallies.
//
// Designed to run as a one-shot service in the deployment stack: it waits for
// the API to have applied migrations (tables exist), skips if the DB is already
// populated, then imports.
//
// Usage:
//   DATABASE_URL=postgres://user:pass@host:5432/db DDRAGON_VERSION=15.3.1 node import.js
//
// DATABASE_URL is required. DDRAGON_VERSION defaults to the value below.

import { Pool } from 'pg';

const API_VERSION = process.env.DDRAGON_VERSION || '15.3.1';
const BASE_URL = `https://ddragon.leagueoflegends.com/cdn/${API_VERSION}`;
const CHAMPION_LIST_URL = `${BASE_URL}/data/en_US/champion.json`;
const CHAMPION_DETAILS_URL = (name) => `${BASE_URL}/data/en_US/champion/${name}.json`;
const SPLASH_BASE_URL = `https://ddragon.leagueoflegends.com/cdn/img/champion/splash`;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchChampionList() {
  const res = await fetch(CHAMPION_LIST_URL);
  if (!res.ok) throw new Error(`champion list: ${res.status}`);
  const json = await res.json();
  return Object.keys(json.data);
}

async function fetchChampionDetails(names) {
  const results = await Promise.all(
    names.map(async (name) => {
      try {
        const res = await fetch(CHAMPION_DETAILS_URL(name));
        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json();
        return json.data[name];
      } catch (err) {
        console.error(`details for ${name} failed:`, err.message);
        return null;
      }
    })
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
    [c.id, c.lore, c.key, c.blurb, c.title]
  );
}

async function insertSkin(client, championId, skin) {
  await client.query(
    `INSERT INTO skins (id, champion_id, num, name, chromas, splash_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name, chromas = EXCLUDED.chromas,
           splash_url = EXCLUDED.splash_url`,
    [String(skin.id), championId, skin.num, skin.name, !!skin.chromas, skin.splashUrl]
  );
}

// Wait until the API has applied its migrations (the `skins` table exists).
// Returns once ready, or throws after the timeout.
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
    `schema not ready after ${timeoutMs}ms${lastErr ? `: ${lastErr.message}` : ''}`
  );
}

async function alreadyPopulated() {
  const r = await pool.query('SELECT count(*)::int AS n FROM champions');
  return r.rows[0].n;
}

async function main() {
  console.log(`Data Dragon version: ${API_VERSION}`);

  await waitForSchema();

  const existing = await alreadyPopulated();
  if (existing > 0) {
    console.log(`champions already present (${existing}); skipping import.`);
    return;
  }

  const names = await fetchChampionList();
  console.log(`Fetched ${names.length} champion names`);

  const details = await fetchChampionDetails(names);
  const cleaned = details.map(cleanChampion);
  console.log(`Fetched details for ${cleaned.length} champions`);

  const client = await pool.connect();
  try {
    for (const champ of cleaned) {
      await insertChampion(client, champ);
      for (const skin of champ.skins) {
        await insertSkin(client, champ.id, skin);
      }
    }
    console.log('Import complete.');
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error('Import failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
