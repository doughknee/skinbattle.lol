// SQLite persistence for the games framework (server-only).
//
// Why SQLite in the web tier and not the Go API + Postgres: the games
// vertical slice has to be playable end-to-end wherever the web app runs,
// and the Go service (api/) needs Docker + Postgres + Redis + Logto to come
// up. The schema below deliberately mirrors the future Postgres migration
// (snake_case, append-only events, same columns) so porting is a mechanical
// move, not a redesign - see "Games framework" in CONTRACT.md.
//
// node:sqlite is built into Node 22 (experimental but stable API), so this
// adds zero native dependencies.

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Local data root: SQLite db + cached splash crops. Overridable so a deploy
// can point it at a mounted volume.
export const DATA_DIR =
  process.env.GAMES_DATA_DIR || join(process.cwd(), '.data')

const SCHEMA = `
-- A guest is a real user record without credentials (design principle 9).
-- Sign-up later ATTACHES a logto_sub to this same row; merging two accounts
-- sets merged_into instead of deleting anything - events stay lossless.
CREATE TABLE IF NOT EXISTS game_users (
  id           TEXT PRIMARY KEY,        -- uuid
  guest_token  TEXT UNIQUE,             -- cookie credential (random 128-bit hex)
  logto_sub    TEXT UNIQUE,             -- set when credentials attach (stubbed for now)
  merged_into  TEXT,                    -- target user id after an account merge
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

-- Raw events are the source of truth (design principle 8): append-only,
-- never updated, never deleted. question_asked / asset_version / trust_tier
-- are recorded from day one even though each has a single value today.
CREATE TABLE IF NOT EXISTS game_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL,
  game           TEXT NOT NULL,
  puzzle_date    TEXT NOT NULL,         -- YYYY-MM-DD (UTC)
  type           TEXT NOT NULL,         -- puzzle_started | guess_submitted | puzzle_completed | battle_voted | tier_submitted
  payload        TEXT NOT NULL,         -- JSON
  question_asked TEXT NOT NULL,         -- e.g. 'guess-the-skin'
  asset_version  TEXT NOT NULL,         -- Data Dragon patch the assets came from
  trust_tier     TEXT NOT NULL,         -- 'guest' | 'member'
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_events_user ON game_events (user_id, game, puzzle_date);
-- Battle agreement lookups ("X% agree with you") and community totals scan
-- by matchup, so index the pair key straight out of the JSON payload.
CREATE INDEX IF NOT EXISTS idx_game_events_battle_pair
  ON game_events (game, type, json_extract(payload, '$.pairKey'));
-- Puzzle guess consensus ("N others also guessed this skin today") counts
-- guess_submitted rows by the guessed skin for a given game + day.
CREATE INDEX IF NOT EXISTS idx_game_events_guess
  ON game_events (game, type, puzzle_date, json_extract(payload, '$.skinId'));
-- Tier-list dedup ("has this user already ranked this board?") scans by
-- user + board id straight out of the JSON payload.
CREATE INDEX IF NOT EXISTS idx_game_events_tier
  ON game_events (game, type, user_id, json_extract(payload, '$.boardId'));

-- The day's puzzle, frozen on first request so a mid-day catalog refresh
-- can never change the answer under players.
CREATE TABLE IF NOT EXISTS daily_puzzles (
  game        TEXT NOT NULL,
  puzzle_date TEXT NOT NULL,
  payload     TEXT NOT NULL,            -- JSON: { skinId, cx, cy, assetVersion }
  created_at  TEXT NOT NULL,
  PRIMARY KEY (game, puzzle_date)
);

-- Per-user per-day result. Derived state for fast reads - the events table
-- can always rebuild it.
CREATE TABLE IF NOT EXISTS daily_results (
  user_id      TEXT NOT NULL,
  game         TEXT NOT NULL,
  puzzle_date  TEXT NOT NULL,
  status       TEXT NOT NULL,           -- in_progress | won | lost
  guesses      TEXT NOT NULL,           -- JSON array of guess records
  completed_at TEXT,
  PRIMARY KEY (user_id, game, puzzle_date)
);

-- Streaks are per-user per-game. freeze_tokens and best_streak exist from
-- day one (design principle 7); freeze redemption ships later.
CREATE TABLE IF NOT EXISTS streaks (
  user_id          TEXT NOT NULL,
  game             TEXT NOT NULL,
  current_streak   INTEGER NOT NULL DEFAULT 0,
  best_streak      INTEGER NOT NULL DEFAULT 0,
  last_result_date TEXT,                -- last puzzle date that counted
  freeze_tokens    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, game)
);

-- Quick Battle rating state, one row per skin that has fought at least one
-- battle. Ratings are DERIVED (the raw match log in game_events is the
-- truth): a cheap live Elo-style update keeps them fresh per pick, and a
-- periodic Bradley-Terry refit recomputes them from scratch - so this table
-- can always be rebuilt. uncertainty makes confidence visible ("1480 ± 90").
CREATE TABLE IF NOT EXISTS skin_ratings (
  skin_id        TEXT PRIMARY KEY,
  rating         REAL NOT NULL,
  uncertainty    REAL NOT NULL,
  battles        INTEGER NOT NULL DEFAULT 0,  -- raw count (unweighted)
  wins           INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL,
  last_battle_at TEXT                         -- last real battle; drives time-decay of confidence
);

-- The same pick that updates the global rating updates the user's personal
-- rating (the mirror's data source). Sparse by nature - most users see a
-- given skin once or twice - so it's a plain Elo value, no uncertainty.
CREATE TABLE IF NOT EXISTS user_skin_ratings (
  user_id    TEXT NOT NULL,
  skin_id    TEXT NOT NULL,
  rating     REAL NOT NULL,
  battles    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, skin_id)
);

-- The single most-recent undoable vote per user, overwritten on each vote and
-- cleared on undo. Holds the pre-vote rating snapshots so an undo restores both
-- caches (community + personal) in O(1) without a refit. quickbattle.undoLastVote
-- is the ONLY path that deletes from game_events - a deliberate, contained
-- exception to the append-only rule, scoped to a player retracting their own
-- last pick before the next refit folds it in.
CREATE TABLE IF NOT EXISTS battle_undo (
  user_id    TEXT PRIMARY KEY,
  event_id   INTEGER NOT NULL,
  snapshot   TEXT NOT NULL,        -- JSON: ids + pre-vote community & personal ratings
  created_at TEXT NOT NULL
);

-- Replay guard for signed battle-pair tokens: each issued pair may be voted
-- on exactly once. Rows are pruned shortly after the token's own expiry.
CREATE TABLE IF NOT EXISTS battle_nonces (
  nonce   TEXT PRIMARY KEY,
  used_at TEXT NOT NULL
);

-- Shared tier lists: a short id → the share payload (board + tiers + name +
-- reveal mode). Keeps share links short and lets the image endpoint and the
-- recipient view resolve by id. Minted on demand when a player shares.
CREATE TABLE IF NOT EXISTS tier_shares (
  id         TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Skin catalog cached from Community Dragon (re-synced when the patch
-- changes). CommunityDragon carries complete per-skin art, so every URL
-- column below is a real CDN URL - no constructed-URL phantoms to sweep.
CREATE TABLE IF NOT EXISTS catalog_skins (
  id                    TEXT PRIMARY KEY,  -- skin id, e.g. '266001' (= key*1000 + num)
  champion_id           TEXT NOT NULL,     -- ddragon champion id, e.g. 'Aatrox'
  champion_name         TEXT NOT NULL,     -- display name, e.g. 'Miss Fortune'
  num                   INTEGER NOT NULL,
  name                  TEXT NOT NULL,
  splash_url            TEXT NOT NULL,     -- centered splash
  tile_url              TEXT,              -- square tile (autocomplete thumbs)
  loadscreen_url        TEXT,              -- tall load-screen card
  uncentered_splash_url TEXT               -- full uncropped splash
);
CREATE TABLE IF NOT EXISTS catalog_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`

let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (db) return db
  mkdirSync(DATA_DIR, { recursive: true })
  db = new DatabaseSync(join(DATA_DIR, 'games.db'))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(SCHEMA)
  // Additive migrations for databases created before these columns existed
  // (CREATE TABLE IF NOT EXISTS won't add columns to an existing table).
  // Display name for leaderboards, captured from the verified Logto ID
  // token at attach time (guests have none - boards are members-only).
  try {
    db.exec('ALTER TABLE game_users ADD COLUMN username TEXT')
  } catch {
    // Column already exists.
  }
  // Community Dragon art columns, for catalogs created on the Data Dragon era.
  for (const col of ['tile_url', 'loadscreen_url', 'uncentered_splash_url']) {
    try {
      db.exec(`ALTER TABLE catalog_skins ADD COLUMN ${col} TEXT`)
    } catch {
      // Column already exists.
    }
  }
  // Per-skin last-battle timestamp, for time-based re-inflation of uncertainty
  // (Glicko: confidence widens during inactivity). Nullable - a skin that has
  // never fought is already at full uncertainty, so NULL needs no backfill.
  try {
    db.exec('ALTER TABLE skin_ratings ADD COLUMN last_battle_at TEXT')
  } catch {
    // Column already exists.
  }
  return db
}

export interface GameEvent {
  userId: string
  game: string
  puzzleDate: string
  type:
    | 'puzzle_started'
    | 'guess_submitted'
    | 'puzzle_completed'
    | 'battle_voted'
    // A taken-back vote. The battle_voted row is deleted on undo (so ratings
    // never see it), but this marker stays so undo→re-vote loops can't bypass
    // the daily rate limit. Ignored by the refit / counts (they filter on
    // battle_voted); only enforceRateLimit counts it.
    | 'battle_undone'
    | 'tier_submitted'
  payload: Record<string, unknown>
  questionAsked: string
  assetVersion: string
  trustTier: 'guest' | 'member'
}

// The append path for game_events - inserts only (the lone delete is the
// scoped vote-undo in quickbattle). Returns the new row id so a vote can record
// it for a possible undo.
export function appendEvent(d: DatabaseSync, e: GameEvent): number {
  const info = d
    .prepare(
      `INSERT INTO game_events
       (user_id, game, puzzle_date, type, payload, question_asked, asset_version, trust_tier, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      e.userId,
      e.game,
      e.puzzleDate,
      e.type,
      JSON.stringify(e.payload),
      e.questionAsked,
      e.assetVersion,
      e.trustTier,
      new Date().toISOString(),
    )
  return Number(info.lastInsertRowid)
}
