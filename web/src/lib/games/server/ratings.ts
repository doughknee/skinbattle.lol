// Rating engine for Quick Battle - "Elo UX, Bradley-Terry truth"
// (GAMES_ROADMAP.md, "The rating system").
//
// Two layers over one event log:
//  - applyLiveUpdate: a cheap Glicko-lite update per pick, so every vote can
//    answer back instantly ("+14, now #23"). K scales with the skin's
//    uncertainty - fresh skins move fast, settled ones barely twitch.
//  - runRefit: a full Bradley-Terry fit (minorization-maximization) over the
//    ENTIRE raw match history, producing the canonical ratings the live
//    updates then continue from. Because it rereads every event, it also
//    re-weights retroactively: a guest who converts to a member upgrades all
//    their past votes at the next refit, exactly as the design doc requires.
//
// game_events stays the source of truth (principle 8) - every number in
// skin_ratings can be rebuilt from it by a single refit.

import type { DatabaseSync } from 'node:sqlite'
import { getMeta, setMeta } from './catalog'

// ─── model parameters ───────────────────────────────────────────────────────

export const START_RATING = 1500
export const START_UNCERTAINTY = 350
export const MIN_UNCERTAINTY = 60

// Live K-factor by uncertainty: a brand-new skin (±350) moves at K=64 per
// full-weight battle, a settled one (±60) at K=16.
const K_MIN = 16
const K_MAX = 64

// Each weighted battle closes 10% of the uncertainty's remaining distance to
// the floor - roughly ±90 after 25 full-weight battles.
const UNCERTAINTY_DECAY = 0.1

// Time-based re-inflation of uncertainty (Glicko's "RD grows during periods of
// inactivity"): a settled skin's confidence should widen as it sits unbattled,
// so the matchmaker eventually revisits it and the rankings keep breathing as
// the voter pool changes underneath them. c² is set so a fully-settled skin
// (±60) drifts back to the fresh band (±350) after RE_INFLATE_FULL_DAYS of
// total inactivity; partial idleness widens proportionally (sqrt law).
const RE_INFLATE_FULL_DAYS = 180
const RE_INFLATE_C2 =
  (START_UNCERTAINTY ** 2 - MIN_UNCERTAINTY ** 2) / RE_INFLATE_FULL_DAYS
const DAY_MS = 24 * 60 * 60 * 1000

// Personal ratings are sparse by nature (most skins are seen a handful of
// times per user), so a high fixed K converges in a few picks.
const K_PERSONAL = 48

// Trust weighting (design doc, "Scoped: guest-first play"): guest votes move
// global ratings at half strength. Raw events keep full fidelity, and the
// refit weighs by the voter's CURRENT tier, so conversion re-weights history.
export const GUEST_WEIGHT = 0.5
export const MEMBER_WEIGHT = 1.0

// Bradley-Terry regularization: every skin gets one virtual win and one
// virtual loss against a phantom average opponent, which keeps undefeated
// (or winless) skins finite and shrinks tiny samples toward the middle.
const BT_PRIOR = 1.0

export interface SkinRating {
  rating: number
  uncertainty: number
  battles: number
  wins: number
  lastBattleAt: string | null
}

const FRESH: SkinRating = {
  rating: START_RATING,
  uncertainty: START_UNCERTAINTY,
  battles: 0,
  wins: 0,
  lastBattleAt: null,
}

// Uncertainty widened for time elapsed since a skin's last real battle (Glicko:
// RD' = min(START, √(RD² + c²·Δt_days))). Monotonic, capped at the fresh band.
// A skin that has never fought (lastBattleAt null) is already at START.
export function inflateUncertainty(
  uncertainty: number,
  lastBattleAt: string | null,
  now: number = Date.now(),
): number {
  if (!lastBattleAt) return uncertainty
  const days = (now - Date.parse(lastBattleAt)) / DAY_MS
  if (!(days > 0)) return uncertainty
  return Math.min(
    START_UNCERTAINTY,
    Math.sqrt(uncertainty ** 2 + RE_INFLATE_C2 * days),
  )
}

export function getSkinRating(db: DatabaseSync, skinId: string): SkinRating {
  const row = db
    .prepare(
      'SELECT rating, uncertainty, battles, wins, last_battle_at AS lastBattleAt FROM skin_ratings WHERE skin_id = ?',
    )
    .get(skinId) as unknown as SkinRating | undefined
  return row ?? { ...FRESH }
}

function putSkinRating(db: DatabaseSync, skinId: string, r: SkinRating): void {
  db.prepare(
    `INSERT INTO skin_ratings (skin_id, rating, uncertainty, battles, wins, updated_at, last_battle_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (skin_id) DO UPDATE SET
       rating = excluded.rating,
       uncertainty = excluded.uncertainty,
       battles = excluded.battles,
       wins = excluded.wins,
       updated_at = excluded.updated_at,
       last_battle_at = excluded.last_battle_at`,
  ).run(
    skinId,
    r.rating,
    r.uncertainty,
    r.battles,
    r.wins,
    new Date().toISOString(),
    r.lastBattleAt,
  )
}

export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + 10 ** ((rb - ra) / 400))
}

function kFor(uncertainty: number): number {
  const t =
    (Math.min(Math.max(uncertainty, MIN_UNCERTAINTY), START_UNCERTAINTY) -
      MIN_UNCERTAINTY) /
    (START_UNCERTAINTY - MIN_UNCERTAINTY)
  return K_MIN + (K_MAX - K_MIN) * t
}

function decayUncertainty(uncertainty: number, weight: number): number {
  return (
    MIN_UNCERTAINTY +
    (uncertainty - MIN_UNCERTAINTY) * (1 - UNCERTAINTY_DECAY * weight)
  )
}

// ─── live update (per pick) ─────────────────────────────────────────────────

export interface LiveUpdate {
  winnerBefore: SkinRating
  loserBefore: SkinRating
  winner: SkinRating
  loser: SkinRating
  winnerDelta: number
  loserDelta: number
}

// One pick: winner gains, loser pays, both tighten their uncertainty.
// Must run inside the caller's transaction alongside the event append.
export function applyLiveUpdate(
  db: DatabaseSync,
  winnerId: string,
  loserId: string,
  weight: number,
): LiveUpdate {
  const w = getSkinRating(db, winnerId)
  const l = getSkinRating(db, loserId)
  const winnerBefore = { ...w }
  const loserBefore = { ...l }

  // Re-inflate for idle time before this battle (Glicko opens a new rating
  // period): an idled skin returns less certain, so it moves at a larger K and
  // its decay starts from the widened value - then persists, so the widening
  // sticks instead of being a read-only overlay.
  const nowMs = Date.now()
  const wUnc = inflateUncertainty(w.uncertainty, w.lastBattleAt, nowMs)
  const lUnc = inflateUncertainty(l.uncertainty, l.lastBattleAt, nowMs)
  const nowIso = new Date(nowMs).toISOString()

  const eWin = expectedScore(w.rating, l.rating)
  const winnerDelta = kFor(wUnc) * weight * (1 - eWin)
  const loserDelta = kFor(lUnc) * weight * (0 - (1 - eWin))

  const winner: SkinRating = {
    rating: w.rating + winnerDelta,
    uncertainty: decayUncertainty(wUnc, weight),
    battles: w.battles + 1,
    wins: w.wins + 1,
    lastBattleAt: nowIso,
  }
  const loser: SkinRating = {
    rating: l.rating + loserDelta,
    uncertainty: decayUncertainty(lUnc, weight),
    battles: l.battles + 1,
    wins: l.wins,
    lastBattleAt: nowIso,
  }
  putSkinRating(db, winnerId, winner)
  putSkinRating(db, loserId, loser)
  return { winnerBefore, loserBefore, winner, loser, winnerDelta, loserDelta }
}

// Reverse a single live update on the CURRENT community rows (vote undo). We
// apply the inverse of THIS vote's effect - subtract its rating deltas, undo
// one battle/win, re-inflate the uncertainty by this vote's decay factor -
// rather than overwriting with an absolute pre-vote snapshot. That's what lets
// the undo compose with any concurrent votes or a refit that touched these two
// shared rows in between. A row whose battle count returns to 0 is dropped
// (the skin had no rating before its placement battle).
export function reverseLiveUpdate(
  db: DatabaseSync,
  winnerId: string,
  loserId: string,
  winnerDelta: number,
  loserDelta: number,
  weight: number,
): void {
  // decayUncertainty multiplied (u - MIN) by (1 - DECAY*weight); divide it back.
  const inflate = (u: number) =>
    MIN_UNCERTAINTY + (u - MIN_UNCERTAINTY) / (1 - UNCERTAINTY_DECAY * weight)
  const w = getSkinRating(db, winnerId)
  const l = getSkinRating(db, loserId)
  const winner: SkinRating = {
    rating: w.rating - winnerDelta,
    uncertainty: inflate(w.uncertainty),
    battles: w.battles - 1,
    wins: Math.max(0, w.wins - 1),
  }
  const loser: SkinRating = {
    rating: l.rating - loserDelta,
    uncertainty: inflate(l.uncertainty),
    battles: l.battles - 1,
    wins: l.wins,
  }
  if (winner.battles <= 0)
    db.prepare('DELETE FROM skin_ratings WHERE skin_id = ?').run(winnerId)
  else putSkinRating(db, winnerId, winner)
  if (loser.battles <= 0)
    db.prepare('DELETE FROM skin_ratings WHERE skin_id = ?').run(loserId)
  else putSkinRating(db, loserId, loser)
}

// Restore one skin's PERSONAL rating to a pre-vote snapshot. battles <= 0 means
// the user had never judged this skin, so the row is removed.
export function restorePersonalRating(
  db: DatabaseSync,
  userId: string,
  skinId: string,
  before: { rating: number; battles: number },
): void {
  if (before.battles <= 0) {
    db.prepare(
      'DELETE FROM user_skin_ratings WHERE user_id = ? AND skin_id = ?',
    ).run(userId, skinId)
    return
  }
  db.prepare(
    `INSERT INTO user_skin_ratings (user_id, skin_id, rating, battles, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, skin_id) DO UPDATE SET
       rating = excluded.rating,
       battles = excluded.battles,
       updated_at = excluded.updated_at`,
  ).run(userId, skinId, before.rating, before.battles, new Date().toISOString())
}

// The same pick, applied to the user's own taste model (the mirror's data
// source). Unweighted - trust tiers protect the COMMUNITY ranking; a user's
// personal list is theirs.
export interface PersonalBefore {
  rating: number
  battles: number
}

export function applyPersonalUpdate(
  db: DatabaseSync,
  userId: string,
  winnerId: string,
  loserId: string,
): { winnerBefore: PersonalBefore; loserBefore: PersonalBefore } {
  const read = (skinId: string) =>
    (db
      .prepare(
        'SELECT rating, battles FROM user_skin_ratings WHERE user_id = ? AND skin_id = ?',
      )
      .get(userId, skinId) as { rating: number; battles: number } | undefined) ?? {
      rating: START_RATING,
      battles: 0,
    }
  const w = read(winnerId)
  const l = read(loserId)
  const eWin = expectedScore(w.rating, l.rating)
  const delta = K_PERSONAL * (1 - eWin)

  const put = db.prepare(
    `INSERT INTO user_skin_ratings (user_id, skin_id, rating, battles, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, skin_id) DO UPDATE SET
       rating = excluded.rating,
       battles = excluded.battles,
       updated_at = excluded.updated_at`,
  )
  const now = new Date().toISOString()
  put.run(userId, winnerId, w.rating + delta, w.battles + 1, now)
  put.run(userId, loserId, l.rating - delta, l.battles + 1, now)
  return { winnerBefore: w, loserBefore: l }
}

// Rank among skins that have actually fought (battles > 0). ~2k rows - a
// plain count is cheap.
export function globalRank(db: DatabaseSync, rating: number): number {
  const row = db
    .prepare(
      'SELECT COUNT(*) AS c FROM skin_ratings WHERE battles > 0 AND rating > ?',
    )
    .get(rating) as { c: number }
  return row.c + 1
}

// The denominator for "#789 of 1,420": how many skins have a real ranking
// (have fought at least one battle). Cheap COUNT over ~2k rows.
export function ratedCount(db: DatabaseSync): number {
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM skin_ratings WHERE battles > 0')
    .get() as { c: number }
  return row.c
}

export interface RankNeighbor {
  name: string
  rank: number
}

// The named skins one rung above and below a given rating - what turns a bare
// "#789" into "just behind X, just ahead of Y". The winner's own row is
// excluded by the strict inequality (its rating equals `rating`); ranks are
// the winner's rank ±1 rather than two more COUNT scans.
export function rankNeighbors(
  db: DatabaseSync,
  rating: number,
  rank: number,
): { above: RankNeighbor | null; below: RankNeighbor | null } {
  const above = db
    .prepare(
      `SELECT c.name AS name FROM skin_ratings r
       JOIN catalog_skins c ON c.id = r.skin_id
       WHERE r.battles > 0 AND r.rating > ?
       ORDER BY r.rating ASC LIMIT 1`,
    )
    .get(rating) as { name: string } | undefined
  const below = db
    .prepare(
      `SELECT c.name AS name FROM skin_ratings r
       JOIN catalog_skins c ON c.id = r.skin_id
       WHERE r.battles > 0 AND r.rating < ?
       ORDER BY r.rating DESC LIMIT 1`,
    )
    .get(rating) as { name: string } | undefined
  return {
    above: above ? { name: above.name, rank: rank - 1 } : null,
    below: below ? { name: below.name, rank: rank + 1 } : null,
  }
}

// ─── Bradley-Terry refit ────────────────────────────────────────────────────

export interface RefitSummary {
  skins: number
  events: number
  iterations: number
  tookMs: number
}

// Recompute every rated skin from the raw match log via the standard MM
// algorithm for Bradley-Terry (Hunter 2004): iterate
//   p_i ← (wins_i + prior) / ( Σ_j n_ij/(p_i+p_j) + 2·prior/(p_i+1) )
// then map strengths onto the Elo scale (1500 + 400·log10 p, geometric mean
// anchored at 1500). Synchronous and O(events) per iteration - fine for the
// web tier at current scale; the Go port can move it to a worker.
export function runRefit(db: DatabaseSync): RefitSummary {
  const t0 = Date.now()
  // Weigh by the voter's CURRENT trust tier, not the tier recorded at vote
  // time - this is what makes guest→member conversion retroactive.
  const rows = db
    .prepare(
      `SELECT e.payload AS payload, u.logto_sub AS logtoSub, e.created_at AS createdAt
       FROM game_events e
       LEFT JOIN game_users u ON u.id = e.user_id
       WHERE e.game = 'quick-battle' AND e.type = 'battle_voted'`,
    )
    .all() as unknown as {
    payload: string
    logtoSub: string | null
    createdAt: string
  }[]

  const wins = new Map<string, number>() // weighted win totals
  const games = new Map<string, number>() // weighted match totals
  const rawBattles = new Map<string, number>()
  const rawWins = new Map<string, number>()
  const lastAt = new Map<string, string>() // skin → most-recent battle ISO time
  const pairs = new Map<string, number>() // "lo|hi" → weighted match count
  const bump = (m: Map<string, number>, k: string, v: number) =>
    m.set(k, (m.get(k) ?? 0) + v)
  const seen = (k: string, ts: string) => {
    const cur = lastAt.get(k)
    if (!cur || ts > cur) lastAt.set(k, ts) // ISO strings sort chronologically
  }

  for (const row of rows) {
    const p = JSON.parse(row.payload) as { winnerId: string; loserId: string }
    const weight = row.logtoSub ? MEMBER_WEIGHT : GUEST_WEIGHT
    bump(wins, p.winnerId, weight)
    bump(games, p.winnerId, weight)
    bump(games, p.loserId, weight)
    bump(rawBattles, p.winnerId, 1)
    bump(rawBattles, p.loserId, 1)
    bump(rawWins, p.winnerId, 1)
    seen(p.winnerId, row.createdAt)
    seen(p.loserId, row.createdAt)
    const key =
      p.winnerId < p.loserId
        ? `${p.winnerId}|${p.loserId}`
        : `${p.loserId}|${p.winnerId}`
    bump(pairs, key, weight)
  }

  const ids = [...games.keys()]
  if (ids.length === 0) {
    return { skins: 0, events: 0, iterations: 0, tookMs: Date.now() - t0 }
  }

  const p = new Map(ids.map((id) => [id, 1]))
  let iterations = 0
  for (let iter = 0; iter < 500; iter++) {
    iterations = iter + 1
    // Phantom-opponent prior term keeps every denominator positive.
    const denom = new Map(
      ids.map((id) => [id, (2 * BT_PRIOR) / (p.get(id)! + 1)]),
    )
    for (const [key, n] of pairs) {
      const sep = key.indexOf('|')
      const i = key.slice(0, sep)
      const j = key.slice(sep + 1)
      const s = n / (p.get(i)! + p.get(j)!)
      denom.set(i, denom.get(i)! + s)
      denom.set(j, denom.get(j)! + s)
    }
    let maxShift = 0
    for (const id of ids) {
      const next = ((wins.get(id) ?? 0) + BT_PRIOR) / denom.get(id)!
      maxShift = Math.max(maxShift, Math.abs(Math.log(next / p.get(id)!)))
      p.set(id, next)
    }
    // Anchor: geometric mean 1 → mean rating 1500.
    const meanLog =
      ids.reduce((s, id) => s + Math.log(p.get(id)!), 0) / ids.length
    for (const id of ids) p.set(id, p.get(id)! / Math.exp(meanLog))
    if (maxShift < 1e-7) break
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    for (const id of ids) {
      const weighted = games.get(id)!
      putSkinRating(db, id, {
        rating: START_RATING + 400 * Math.log10(p.get(id)!),
        // Heuristic standard-error stand-in: shrinks with weighted sample
        // size, clamped to the same band the live decay uses.
        uncertainty: Math.min(
          START_UNCERTAINTY,
          Math.max(MIN_UNCERTAINTY, START_UNCERTAINTY / Math.sqrt(weighted)),
        ),
        battles: rawBattles.get(id) ?? 0,
        wins: rawWins.get(id) ?? 0,
        lastBattleAt: lastAt.get(id) ?? null,
      })
    }
    setMeta(db, 'refit_at', new Date().toISOString())
    setMeta(db, 'refit_events', String(rows.length))
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return {
    skins: ids.length,
    events: rows.length,
    iterations,
    tookMs: Date.now() - t0,
  }
}

// Opportunistic periodicity without a scheduler: after a vote settles, refit
// when enough new evidence has accumulated. Deferred off the request path.
const REFIT_EVENT_INTERVAL = 500
const REFIT_TIME_INTERVAL_MS = 6 * 60 * 60 * 1000
const REFIT_TIME_MIN_EVENTS = 50

export function maybeAutoRefit(db: DatabaseSync, totalEvents: number): void {
  const lastN = Number(getMeta(db, 'refit_events') ?? '0')
  const lastAt = Date.parse(getMeta(db, 'refit_at') ?? '') || 0
  const fresh = totalEvents - lastN
  const due =
    fresh >= REFIT_EVENT_INTERVAL ||
    (Date.now() - lastAt > REFIT_TIME_INTERVAL_MS &&
      fresh >= REFIT_TIME_MIN_EVENTS)
  if (!due) return
  setImmediate(() => {
    try {
      const summary = runRefit(db)
      console.log('quick-battle rating refit:', summary)
    } catch (err) {
      console.error('quick-battle rating refit failed:', err)
    }
  })
}
