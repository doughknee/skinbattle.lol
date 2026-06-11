// Quick Battle engine (server-only): the matchmaker, signed pair tokens,
// rate limiting, and the vote write path.
//
// Reads never write: fetching pairs mints nothing and stores nothing — each
// served pair is an HMAC-signed stateless token, and the user record, rating
// rows, and event row are all created by the first actual pick. The signed
// token also closes the obvious forgery hole (you can only vote on a pair
// the matchmaker actually dealt you), and a nonce burn makes each pair
// single-use.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  BattleFeedback,
  BattlePair,
  BattleSkin,
  BattleStats,
  BattleVoteResult,
  QuickBattleState,
} from '../types'
import { appendEvent, getDb } from './db'
import { allCatalogSkins, ensureCatalog, getMeta, setMeta } from './catalog'
import { ensureUser, peekUser, type GameUser } from './guests'
import { utcToday } from './daily'
import {
  applyLiveUpdate,
  applyPersonalUpdate,
  getSkinRating,
  globalRank,
  GUEST_WEIGHT,
  maybeAutoRefit,
  MEMBER_WEIGHT,
  runRefit,
  START_RATING,
  START_UNCERTAINTY,
  type RefitSummary,
} from './ratings'

const GAME = 'quick-battle'
// Single axis at launch, pure gut feel (principle 5). Recorded on every
// event so themed lenses can be added later without poisoning the dataset.
const QUESTION = 'which-do-you-like-more'

// A pair must be voted on within this window of being dealt.
const PAIR_TTL_MS = 30 * 60 * 1000

// "X% agree with you" only shows once a matchup has a real sample; below
// this the feedback falls back to the rating delta.
const AGREEMENT_MIN_VOTES = 5

// Rate limits (anti-abuse, design doc "Data integrity"): the minute window
// is set above any human snap-judgment pace, the day cap above any human
// session — both well below what a script can do.
const LIMITS = {
  guest: { perMinute: 40, perDay: 500 },
  member: { perMinute: 60, perDay: 1500 },
}

// ─── matchmaker ─────────────────────────────────────────────────────────────

interface RatedSkin {
  id: string
  championId: string
  championName: string
  name: string
  splashUrl: string
  rating: number
  uncertainty: number
  battles: number
}

// A skin counts as "placed" once it has this many battles; under it, the
// matchmaker owes it placement matches.
const PLACEMENT_BATTLES = 10

// Pair-type mix (principle 6 — pacing beats efficiency): mostly informative
// pairs, seeded with placement matches, paced with easy dunks and marquee
// title fights. Never only agonizing 50/50s.
type PairType = 'informative' | 'placement' | 'dunk' | 'marquee'

const MIX: [type: PairType, cut: number][] = [
  ['informative', 0.5],
  ['placement', 0.75],
  ['dunk', 0.9],
  ['marquee', 1],
]

function loadRatedSkins(db: DatabaseSync): RatedSkin[] {
  const ratings = new Map(
    (
      db
        .prepare('SELECT skin_id, rating, uncertainty, battles FROM skin_ratings')
        .all() as unknown as {
        skin_id: string
        rating: number
        uncertainty: number
        battles: number
      }[]
    ).map((r) => [r.skin_id, r]),
  )
  return allCatalogSkins(db).map((s) => {
    const r = ratings.get(s.id)
    return {
      id: s.id,
      championId: s.championId,
      championName: s.championName,
      name: s.name,
      splashUrl: s.splashUrl,
      rating: r?.rating ?? START_RATING,
      uncertainty: r?.uncertainty ?? START_UNCERTAINTY,
      battles: r?.battles ?? 0,
    }
  })
}

const sample = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

// Opponent within a rating window of `a`, widening until someone qualifies.
function closeOpponent(
  pool: RatedSkin[],
  a: RatedSkin,
  window: number,
): RatedSkin | null {
  for (let w = window; w <= 3200; w *= 2) {
    const near = pool.filter((s) => s.id !== a.id && Math.abs(s.rating - a.rating) <= w)
    if (near.length > 0) return sample(near)
  }
  return null
}

// Close rating, high uncertainty — the statistically useful pairs, which are
// also the fun, hard choices.
function pickInformative(pool: RatedSkin[]): [RatedSkin, RatedSkin] | null {
  if (pool.length < 2) return null
  const byUncertainty = [...pool].sort((x, y) => y.uncertainty - x.uncertainty)
  const a = sample(byUncertainty.slice(0, Math.max(2, Math.ceil(pool.length / 4))))
  const b = closeOpponent(pool, a, 150)
  return b ? [a, b] : null
}

// Under-sampled skin vs a roughly comparable opponent (prefer one that's
// already placed, so the new skin's result carries information).
function pickPlacement(pool: RatedSkin[]): [RatedSkin, RatedSkin] | null {
  const fresh = pool.filter((s) => s.battles < PLACEMENT_BATTLES)
  if (fresh.length === 0 || pool.length < 2) return null
  const least = [...fresh].sort((x, y) => x.battles - y.battles)
  const a = sample(least.slice(0, Math.min(50, least.length)))
  const placed = pool.filter(
    (s) =>
      s.id !== a.id &&
      s.battles >= PLACEMENT_BATTLES &&
      Math.abs(s.rating - a.rating) <= 250,
  )
  const b = placed.length > 0 ? sample(placed) : closeOpponent(pool, a, 250)
  return b ? [a, b] : null
}

// Easy dunk: a clear favorite vs a clear underdog. Free dopamine — and when
// the community agrees, confirmation that the system "gets it".
function pickDunk(pool: RatedSkin[]): [RatedSkin, RatedSkin] | null {
  const rated = pool.filter((s) => s.battles > 0)
  if (rated.length < 10) return null
  const sorted = [...rated].sort((x, y) => y.rating - x.rating)
  const cut = Math.max(1, Math.floor(sorted.length / 5))
  const top = sample(sorted.slice(0, cut))
  const bottom = sample(sorted.slice(-cut))
  if (top.rating - bottom.rating < 200 || top.id === bottom.id) return null
  return [top, bottom]
}

// Marquee title fight: two established heavyweights.
function pickMarquee(pool: RatedSkin[]): [RatedSkin, RatedSkin] | null {
  const top = pool
    .filter((s) => s.battles >= 5)
    .sort((x, y) => y.rating - x.rating)
    .slice(0, 30)
  if (top.length < 2) return null
  const a = sample(top)
  const b = sample(top.filter((s) => s.id !== a.id))
  return [a, b]
}

function dealPair(
  db: DatabaseSync,
  skins: RatedSkin[],
  exclude: Set<string>,
): BattlePair {
  let pool = skins.filter((s) => !exclude.has(s.id))
  if (pool.length < 2) pool = skins

  const roll = Math.random()
  let type: PairType = 'informative'
  for (const [t, cut] of MIX) {
    if (roll < cut) {
      type = t
      break
    }
  }

  const pickers: Record<PairType, (p: RatedSkin[]) => [RatedSkin, RatedSkin] | null> = {
    informative: pickInformative,
    placement: pickPlacement,
    dunk: pickDunk,
    marquee: pickMarquee,
  }
  let picked = pickers[type](pool)
  if (!picked) {
    type = 'informative'
    picked = pickInformative(pool)
  }
  if (!picked) {
    // Last resort: any two distinct skins.
    const a = sample(pool)
    const b = sample(pool.filter((s) => s.id !== a.id))
    picked = [a, b]
  }

  // Shuffle sides so position carries no signal.
  const [first, second] = Math.random() < 0.5 ? picked : [picked[1], picked[0]]
  return {
    token: signPair(db, first.id, second.id, type),
    a: toBattleSkin(first),
    b: toBattleSkin(second),
  }
}

// Ratings are deliberately NOT sent with the pair — seeing the numbers
// before picking would bias the vote. They come back in the feedback.
function toBattleSkin(s: RatedSkin): BattleSkin {
  return {
    skinId: s.id,
    name: s.name,
    championId: s.championId,
    championName: s.championName,
    splashUrl: s.splashUrl,
  }
}

// ─── signed pair tokens ─────────────────────────────────────────────────────

interface PairClaim {
  a: string
  b: string
  t: PairType
  iat: number
  n: string
}

function pairSecret(db: DatabaseSync): Buffer {
  const env = process.env.GAMES_PAIR_SECRET
  if (env) return Buffer.from(env, 'utf8')
  let hex = getMeta(db, 'pair_secret')
  if (!hex) {
    hex = randomBytes(32).toString('hex')
    setMeta(db, 'pair_secret', hex)
  }
  return Buffer.from(hex, 'hex')
}

const sign = (db: DatabaseSync, payload: string) =>
  createHmac('sha256', pairSecret(db)).update(payload).digest('base64url')

function signPair(db: DatabaseSync, a: string, b: string, t: PairType): string {
  const claim: PairClaim = {
    a,
    b,
    t,
    iat: Date.now(),
    n: randomBytes(8).toString('hex'),
  }
  const payload = Buffer.from(JSON.stringify(claim)).toString('base64url')
  return `${payload}.${sign(db, payload)}`
}

function verifyPairToken(db: DatabaseSync, token: string): PairClaim {
  const dot = token.lastIndexOf('.')
  if (dot < 1) throw new Error('Malformed battle pair — refresh and try again.')
  const payload = token.slice(0, dot)
  const given = Buffer.from(token.slice(dot + 1), 'base64url')
  const expected = Buffer.from(sign(db, payload), 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new Error('Invalid battle pair — refresh and try again.')
  }
  const claim = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as PairClaim
  if (Date.now() - claim.iat > PAIR_TTL_MS) {
    throw new Error('That matchup expired — here come fresh ones.')
  }
  return claim
}

// Single-use: burning the nonce twice violates the primary key. Old nonces
// are pruned once their tokens are past expiry anyway.
function burnNonce(db: DatabaseSync, nonce: string): void {
  db.prepare('DELETE FROM battle_nonces WHERE used_at < ?').run(
    new Date(Date.now() - 2 * PAIR_TTL_MS).toISOString(),
  )
  try {
    db.prepare('INSERT INTO battle_nonces (nonce, used_at) VALUES (?, ?)').run(
      nonce,
      new Date().toISOString(),
    )
  } catch {
    throw new Error('This battle was already counted.')
  }
}

// ─── rate limiting ──────────────────────────────────────────────────────────

function enforceRateLimit(db: DatabaseSync, user: GameUser): void {
  const limits = LIMITS[user.trustTier]
  const count = (extra: string, params: string[]) =>
    (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM game_events
           WHERE user_id = ? AND game = ? AND type = 'battle_voted' ${extra}`,
        )
        .get(user.id, GAME, ...params) as { c: number }
    ).c

  if (count('AND puzzle_date = ?', [utcToday()]) >= limits.perDay) {
    throw new Error(
      "You've hit today's battle limit — the rankings thank you. Come back tomorrow!",
    )
  }
  const minuteAgo = new Date(Date.now() - 60_000).toISOString()
  if (count('AND created_at > ?', [minuteAgo]) >= limits.perMinute) {
    throw new Error('Whoa, slow down — give it a few seconds and battle on.')
  }
}

// ─── stats ──────────────────────────────────────────────────────────────────

export function userBattleCounts(
  db: DatabaseSync,
  userId: string | null,
): { total: number; today: number } {
  if (!userId) return { total: 0, today: 0 }
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN puzzle_date = ? THEN 1 ELSE 0 END) AS today
       FROM game_events
       WHERE user_id = ? AND game = ? AND type = 'battle_voted'`,
    )
    .get(utcToday(), userId, GAME) as { total: number; today: number | null }
  return { total: row.total, today: row.today ?? 0 }
}

export function communityBattleCount(db: DatabaseSync): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM game_events WHERE game = ? AND type = 'battle_voted'`,
    )
    .get(GAME) as { c: number }
  return row.c
}

function statsFor(db: DatabaseSync, user: GameUser | null): BattleStats {
  const counts = userBattleCounts(db, user?.id ?? null)
  return {
    total: counts.total,
    today: counts.today,
    community: communityBattleCount(db),
    tier: user?.trustTier ?? 'guest',
  }
}

// ─── public surface (called from server functions) ──────────────────────────

// Read-only (no user minted, nothing stored): deal a current pair plus a
// preload pair so the first pick has zero wait. `refitParam` is the manual
// refit trigger — guarded by GAMES_ADMIN_SECRET when set (dev: open).
export async function quickBattleState(
  restoreToken?: string | null,
  refitParam?: string,
): Promise<QuickBattleState> {
  const db = getDb()
  await ensureCatalog(db)

  let refit: RefitSummary | undefined
  if (refitParam) {
    const secret = process.env.GAMES_ADMIN_SECRET
    if (!secret || refitParam === secret) {
      refit = runRefit(db)
      console.log('quick-battle rating refit (manual):', refit)
    }
  }

  const known = peekUser(db, restoreToken)
  const skins = loadRatedSkins(db)
  if (skins.length < 2) throw new Error('The skin catalog is not ready yet.')

  const pair = dealPair(db, skins, new Set())
  const next = dealPair(db, skins, new Set([pair.a.skinId, pair.b.skinId]))
  return {
    pair,
    next,
    stats: statsFor(db, known?.user ?? null),
    guestToken: known?.token ?? '',
    refit,
  }
}

export async function submitBattleVote(
  pairToken: string,
  winnerId: string,
  recent: string[] | undefined,
  restoreToken?: string | null,
): Promise<BattleVoteResult> {
  const db = getDb()
  const assetVersion = await ensureCatalog(db)
  // First pick mints the guest — the one write a brand-new visitor triggers.
  const { user, token } = ensureUser(db, restoreToken)

  const claim = verifyPairToken(db, pairToken)
  if (winnerId !== claim.a && winnerId !== claim.b) {
    throw new Error('That skin is not part of this matchup.')
  }
  const loserId = winnerId === claim.a ? claim.b : claim.a

  enforceRateLimit(db, user)
  burnNonce(db, claim.n)

  const weight = user.trustTier === 'member' ? MEMBER_WEIGHT : GUEST_WEIGHT
  const date = utcToday()
  const pairKey =
    claim.a < claim.b ? `${claim.a}|${claim.b}` : `${claim.b}|${claim.a}`

  // Rank before the update, for the "↑3" part of the feedback.
  const before = getSkinRating(db, winnerId)
  const rankBefore = before.battles > 0 ? globalRank(db, before.rating) : null

  db.exec('BEGIN IMMEDIATE')
  let live
  try {
    live = applyLiveUpdate(db, winnerId, loserId, weight)
    applyPersonalUpdate(db, user.id, winnerId, loserId)
    appendEvent(db, {
      userId: user.id,
      game: GAME,
      puzzleDate: date,
      type: 'battle_voted',
      payload: {
        winnerId,
        loserId,
        pairKey,
        pairType: claim.t,
        weight,
        winnerRating: Math.round(live.winner.rating),
        loserRating: Math.round(live.loser.rating),
      },
      questionAsked: QUESTION,
      assetVersion,
      trustTier: user.trustTier,
    })
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  // Feedback — principle 1: every pick answers back within the same round
  // trip that fetched the next pair.
  const agreement = pairAgreement(db, pairKey, winnerId)
  const winnerSkin = skinName(db, winnerId)
  const feedback: BattleFeedback = {
    winnerSkinId: winnerId,
    winnerName: winnerSkin,
    delta: Math.round(live.winnerDelta),
    rating: Math.round(live.winner.rating),
    uncertainty: Math.round(live.winner.uncertainty),
    battles: live.winner.battles,
    rank: globalRank(db, live.winner.rating),
    rankBefore,
    agreementPct: agreement.pct,
    pairVotes: agreement.votes,
  }

  const skins = loadRatedSkins(db)
  const exclude = new Set(
    [...(recent ?? []).slice(-16), claim.a, claim.b].filter(Boolean),
  )
  const nextPair = dealPair(db, skins, exclude)

  maybeAutoRefit(db, communityBattleCount(db))

  return {
    feedback,
    nextPair,
    stats: statsFor(db, user),
    guestToken: token,
  }
}

function skinName(db: DatabaseSync, skinId: string): string {
  const row = db
    .prepare('SELECT name FROM catalog_skins WHERE id = ?')
    .get(skinId) as { name: string } | undefined
  return row?.name ?? 'Unknown skin'
}

// Of everyone ever served this exact matchup (this vote included), what
// fraction picked the same winner?
function pairAgreement(
  db: DatabaseSync,
  pairKey: string,
  winnerId: string,
): { pct: number | null; votes: number } {
  const rows = db
    .prepare(
      `SELECT payload FROM game_events
       WHERE game = ? AND type = 'battle_voted'
         AND json_extract(payload, '$.pairKey') = ?`,
    )
    .all(GAME, pairKey) as unknown as { payload: string }[]
  const votes = rows.length
  if (votes < AGREEMENT_MIN_VOTES) return { pct: null, votes }
  const same = rows.filter(
    (r) => (JSON.parse(r.payload) as { winnerId: string }).winnerId === winnerId,
  ).length
  return { pct: Math.round((100 * same) / votes), votes }
}
