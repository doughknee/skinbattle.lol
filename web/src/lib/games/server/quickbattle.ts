// Quick Battle engine (server-only): the matchmaker, signed pair tokens,
// rate limiting, and the vote write path.
//
// Reads never write: fetching pairs mints nothing and stores nothing - each
// served pair is an HMAC-signed stateless token, and the user record, rating
// rows, and event row are all created by the first actual pick. The signed
// token also closes the obvious forgery hole (you can only vote on a pair
// the matchmaker actually dealt you), and a nonce burn makes each pair
// single-use.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  BattleFeedback,
  BattleMode,
  BattlePair,
  BattleScope,
  BattleSkin,
  BattleStats,
  BattleUndoResult,
  BattleVoteResult,
  QuickBattleState,
  ScopedStanding,
} from '../types'
import { hasEnoughVoters, isConfident } from '../answer'
import type { RankingState } from '../settle'
import { appendEvent, getDb } from './db'
import { allCatalogSkins, ensureCatalog, getMeta, setMeta } from './catalog'
import { ensureUser, peekUser, type GameUser } from './guests'
import { puzzleDay } from './daily'
import {
  applyLiveUpdate,
  applyPersonalUpdate,
  getSkinRating,
  globalRank,
  GUEST_WEIGHT,
  inflateUncertainty,
  maybeAutoRefit,
  MEMBER_WEIGHT,
  rankNeighbors,
  ratedCount,
  ratingEventCount,
  restorePersonalRating,
  reverseLiveUpdate,
  runRefit,
  skinVoters,
  START_RATING,
  START_UNCERTAINTY,
  type PersonalBefore,
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
// session - both well below what a script can do.
const LIMITS = {
  guest: { perMinute: 40, perDay: 500 },
  member: { perMinute: 60, perDay: 1500 },
}

// ─── matchmaker ─────────────────────────────────────────────────────────────

export interface RatedSkin {
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

// Pair-type mix (principle 6 - pacing beats efficiency): placement matches to
// cover the catalog, informative 50/50s for the useful-and-fun choices, paced
// with easy dunks and marquee title fights. Never only agonizing 50/50s.
type PairType = 'informative' | 'placement' | 'dunk' | 'marquee'

// Placement's share of every deal is coverage-driven, not a fixed cut: it
// tracks how far the catalog is from being "floored" (every eligible skin at
// PLACEMENT_BATTLES). Wide-open catalog → placement dominates so every skin
// gets its shot fast; fully floored → it drops to a maintenance trickle and the
// deal is mostly informative. This is what makes coverage self-correcting - a
// patch that adds new skins reopens the gap, so placement automatically ramps
// back up with zero hand-tuning.
const MIN_PLACEMENT_SHARE = 0.15
const MAX_PLACEMENT_SHARE = 0.8
// How the remaining (non-placement) share splits, renormalized from the
// original informative-heavy pacing (informative 0.5 / dunk 0.15 / marquee 0.1).
const INFORMATIVE_OF_REST = 2 / 3
const DUNK_OF_REST = 0.2

// Mean fractional shortfall toward the placement floor across the catalog: 1.0
// when nothing has fought, 0.0 once every skin is placed. Zero-battle skins
// count full weight, so coverage gaps dominate it. O(n) over ~2k in-memory
// rows - negligible.
export function coverageDeficit(skins: RatedSkin[]): number {
  if (skins.length === 0) return 0
  let short = 0
  for (const s of skins)
    short += PLACEMENT_BATTLES - Math.min(s.battles, PLACEMENT_BATTLES)
  return short / (skins.length * PLACEMENT_BATTLES)
}

// Cumulative cut points for the deal roll, with placement sized by the live
// coverage deficit and the rest paced behind it.
export function dealMix(skins: RatedSkin[]): [type: PairType, cut: number][] {
  const placement = Math.min(
    MAX_PLACEMENT_SHARE,
    Math.max(MIN_PLACEMENT_SHARE, coverageDeficit(skins)),
  )
  const rest = 1 - placement
  const informative = placement + rest * INFORMATIVE_OF_REST
  const dunk = informative + rest * DUNK_OF_REST
  return [
    ['placement', placement],
    ['informative', informative],
    ['dunk', dunk],
    ['marquee', 1],
  ]
}

function loadRatedSkins(db: DatabaseSync): RatedSkin[] {
  const ratings = new Map(
    (
      db
        .prepare(
          'SELECT skin_id, rating, uncertainty, battles, last_battle_at AS lastBattleAt FROM skin_ratings',
        )
        .all() as unknown as {
        skin_id: string
        rating: number
        uncertainty: number
        battles: number
        lastBattleAt: string | null
      }[]
    ).map((r) => [r.skin_id, r]),
  )
  // Re-inflate by idle time here too: an ossified ±60 skin must LOOK uncertain
  // to resurface in the informative pool, otherwise it would never be picked
  // and so never get the battle that would re-inflate its stored value.
  const now = Date.now()
  return allCatalogSkins(db).map((s) => {
    const r = ratings.get(s.id)
    return {
      id: s.id,
      championId: s.championId,
      championName: s.championName,
      name: s.name,
      splashUrl: s.splashUrl,
      rating: r?.rating ?? START_RATING,
      uncertainty: r
        ? inflateUncertainty(r.uncertainty, r.lastBattleAt, now)
        : START_UNCERTAINTY,
      battles: r?.battles ?? 0,
    }
  })
}

// ─── scoped battles ("help settle") ─────────────────────────────────────────

// What a /battle?champion=<id>&skin=<id> link asks for. Both are untrusted
// client strings: the champion resolves case-insensitively against the
// catalog, and anything unresolvable falls back to the whole catalog, so a
// stale or hand-typed link still deals a battle instead of an error.
export interface ScopeRequest {
  champion?: string | null
  skin?: string | null
}

// The scoped pool: one champion's wardrobe. Pure, and handed to the SAME
// pickers the catalog-wide deal uses - scoping restricts who can be dealt,
// never how a pair is chosen. The statistical reasoning is in
// docs/participation-loop.md ("matchmaking integrity"): pair selection that
// depends only on past data and never on the vote about to be cast is
// ignorable to the Bradley-Terry fit, and a pool restriction is the mildest
// such design of all - it is exactly what a Tier Drop champion board already
// does.
export function scopePool(skins: RatedSkin[], championId: string): RatedSkin[] {
  const id = championId.toLowerCase()
  return skins.filter((s) => s.championId.toLowerCase() === id)
}

// The verdict state of a champion's ranking, by the two bars answer.ts judges
// the champion page with: the leader's stored band, and - only once the band
// is inside the bar - how many people stand behind it. The voter scan is the
// expensive half (two passes over game_events), so it runs only when the band
// alone can no longer decide.
function scopeState(db: DatabaseSync, pool: RatedSkin[]): RankingState {
  const rated = pool.filter((s) => s.battles > 0)
  if (rated.length === 0) return 'empty'
  const leader = rated.reduce((a, b) => (b.rating > a.rating ? b : a))
  // The STORED band, not the idle-inflated one loadRatedSkins carries for the
  // matchmaker: the champion page judges the stored value, and the banner
  // here and the verdict there must say the same word about the same skin.
  const band = Math.round(getSkinRating(db, leader.id).uncertainty)
  if (!isConfident(band)) return 'provisional'
  return hasEnoughVoters(skinVoters(db, leader.id)) ? 'settled' : 'provisional'
}

interface ResolvedScope {
  info: BattleScope
  pool: RatedSkin[]
  // The dossier's "Help rank <skin>": this skin fights first.
  pin: string | null
}

function resolveScope(
  db: DatabaseSync,
  skins: RatedSkin[],
  req?: ScopeRequest | null,
): ResolvedScope | null {
  const champion = typeof req?.champion === 'string' ? req.champion.trim() : ''
  if (!/^[a-z0-9]{1,32}$/i.test(champion)) return null
  const pool = scopePool(skins, champion)
  // A wardrobe of one has no battle in it: fall back to the catalog.
  if (pool.length < 2) return null
  const skin =
    typeof req?.skin === 'string' && /^\d{1,12}$/.test(req.skin) ? req.skin : null
  return {
    info: {
      championId: pool[0].championId,
      championName: pool[0].championName,
      slug: pool[0].championId.toLowerCase(),
      total: pool.length,
      rated: pool.filter((s) => s.battles > 0).length,
      state: scopeState(db, pool),
    },
    pool,
    pin: skin && pool.some((s) => s.id === skin) ? skin : null,
  }
}

// Where the winner now sits inside its wardrobe, flanked by its named
// neighbours. Over the freshly loaded pool (post-update ratings), rated
// members only, best first.
export function scopedStanding(
  pool: RatedSkin[],
  winnerId: string,
): ScopedStanding | null {
  const rated = pool
    .filter((s) => s.battles > 0)
    .sort((a, b) => b.rating - a.rating)
  const at = rated.findIndex((s) => s.id === winnerId)
  if (at < 0) return null
  const above = rated[at - 1]
  const below = rated[at + 1]
  return {
    rank: at + 1,
    of: rated.length,
    above: above ? { name: above.name, rank: at } : null,
    below: below ? { name: below.name, rank: at + 2 } : null,
  }
}

// This user's head-to-head battles that touched the wardrobe - lifetime, so
// "you've fought N battles for Ahri's ranking" survives a trip to the
// ranking page and back. Bound by wardrobe size (≤ ~30 ids), one scan of the
// user's own rows via idx_game_events_user.
function scopedBattleCount(
  db: DatabaseSync,
  userId: string,
  pool: RatedSkin[],
): number {
  if (pool.length === 0) return 0
  const ids = pool.map((s) => s.id)
  const marks = ids.map(() => '?').join(',')
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM game_events
       WHERE user_id = ? AND game = ? AND type = 'battle_voted'
         AND (json_extract(payload, '$.winnerId') IN (${marks})
           OR json_extract(payload, '$.loserId') IN (${marks}))`,
    )
    .get(userId, GAME, ...ids, ...ids) as { c: number }
  return row.c
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

// Close rating, high uncertainty - the statistically useful pairs, which are
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

// Easy dunk: a clear favorite vs a clear underdog. Free dopamine - and when
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
  for (const [t, cut] of dealMix(skins)) {
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

// King-of-the-hill: pick a CHALLENGER for a fixed champion, using the same
// coverage-driven mix as dealPair but with one side pinned. Anchoring on the
// champion's rating keeps each pair-type meaningful (informative = a close
// fight, dunk = a clear underdog, marquee = another heavyweight) while
// placement still channels under-sampled skins through the champion, so
// catalog coverage is preserved on the rotating side.
function pickChallenger(
  pool: RatedSkin[],
  champ: RatedSkin,
  type: PairType,
): RatedSkin | null {
  if (pool.length === 0) return null
  switch (type) {
    case 'placement': {
      const fresh = pool.filter((s) => s.battles < PLACEMENT_BATTLES)
      if (fresh.length === 0) return closeOpponent(pool, champ, 250)
      const least = [...fresh].sort((x, y) => x.battles - y.battles)
      return sample(least.slice(0, Math.min(50, least.length)))
    }
    case 'dunk': {
      // A clear underdog the champion should comfortably beat (either side of
      // the gap, so a low-rated champion still gets an easy defence).
      const under = pool.filter((s) => Math.abs(champ.rating - s.rating) >= 200)
      return under.length > 0 ? sample(under) : closeOpponent(pool, champ, 250)
    }
    case 'marquee': {
      const heavies = pool
        .filter((s) => s.battles >= 5)
        .sort((x, y) => y.rating - x.rating)
        .slice(0, 30)
      return heavies.length > 0 ? sample(heavies) : closeOpponent(pool, champ, 250)
    }
    case 'informative':
    default:
      return closeOpponent(pool, champ, 150)
  }
}

// Deal the next champion-mode pair: the reigning `championId` vs a freshly
// matchmade challenger. `exclude` carries the recent + just-voted skins so the
// challenger never repeats; the champion is always excluded from the challenger
// pool (it can't fight itself). Falls back to a normal pair if the champion has
// somehow left the catalog. The champion is placed in slot `a`; the client maps
// it back into the winner's on-screen slot, so position carries no data signal
// (pairKey is order-independent anyway).
function dealChallengerPair(
  db: DatabaseSync,
  skins: RatedSkin[],
  championId: string,
  exclude: Set<string>,
): BattlePair {
  // Normalize: a deep-link ?vs= arrives JSON-parsed (a numeric id like "1002"
  // becomes the number 1002), while catalog ids are strings — compare as strings.
  const id = String(championId)
  const champ = skins.find((s) => s.id === id)
  if (!champ) return dealPair(db, skins, exclude)

  let pool = skins.filter((s) => s.id !== id && !exclude.has(s.id))
  if (pool.length === 0) pool = skins.filter((s) => s.id !== id)
  if (pool.length === 0) return dealPair(db, skins, exclude)

  const roll = Math.random()
  let type: PairType = 'informative'
  for (const [t, cut] of dealMix(skins)) {
    if (roll < cut) {
      type = t
      break
    }
  }

  const challenger =
    pickChallenger(pool, champ, type) ?? closeOpponent(pool, champ, 3200) ?? sample(pool)

  return {
    token: signPair(db, champ.id, challenger.id, type),
    a: toBattleSkin(champ),
    b: toBattleSkin(challenger),
  }
}

// Ratings are deliberately NOT sent with the pair - seeing the numbers
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
  if (dot < 1) throw new Error('Malformed battle pair. Refresh and try again.')
  const payload = token.slice(0, dot)
  const given = Buffer.from(token.slice(dot + 1), 'base64url')
  const expected = Buffer.from(sign(db, payload), 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new Error('Invalid battle pair. Refresh and try again.')
  }
  const claim = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as PairClaim
  if (Date.now() - claim.iat > PAIR_TTL_MS) {
    throw new Error('That matchup expired. Here come fresh ones.')
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
  // Count undos too: an undo deletes its battle_voted row, so without counting
  // the battle_undone marker a vote→undo→vote loop would never advance the cap.
  const count = (extra: string, params: string[]) =>
    (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM game_events
           WHERE user_id = ? AND game = ?
             AND type IN ('battle_voted', 'battle_undone') ${extra}`,
        )
        .get(user.id, GAME, ...params) as { c: number }
    ).c

  if (count('AND puzzle_date = ?', [puzzleDay()]) >= limits.perDay) {
    throw new Error(
      "You've hit today's battle limit. The rankings thank you. Come back tomorrow!",
    )
  }
  const minuteAgo = new Date(Date.now() - 60_000).toISOString()
  if (count('AND created_at > ?', [minuteAgo]) >= limits.perMinute) {
    throw new Error('Whoa, slow down. Give it a few seconds and battle on.')
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
    .get(puzzleDay(), userId, GAME) as { total: number; today: number | null }
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

function statsFor(
  db: DatabaseSync,
  user: GameUser | null,
  scope?: RatedSkin[],
): BattleStats {
  const counts = userBattleCounts(db, user?.id ?? null)
  return {
    total: counts.total,
    today: counts.today,
    community: communityBattleCount(db),
    tier: user?.trustTier ?? 'guest',
    ...(scope
      ? { scopeBattles: user ? scopedBattleCount(db, user.id, scope) : 0 }
      : {}),
  }
}

// ─── public surface (called from server functions) ──────────────────────────

// Read-only (no user minted, nothing stored): deal a current pair plus a
// preload pair so the first pick has zero wait. `refitParam` is the manual
// refit trigger - guarded by GAMES_ADMIN_SECRET when set (dev: open).
export async function quickBattleState(
  restoreToken?: string | null,
  refitParam?: string,
  // `champion` scopes the deal to one wardrobe; `skin` pins that skin into the
  // first pair (the dossier's "Help rank <skin>"). Unresolvable → catalog-wide.
  scopeReq?: ScopeRequest | null,
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

  const scoped = resolveScope(db, skins, scopeReq)
  const pool = scoped?.pool ?? skins
  // A pinned skin fights first, against a matchmade challenger from the same
  // wardrobe; every pair after it is dealt from the pool like any other.
  const pair = scoped?.pin
    ? dealChallengerPair(db, pool, scoped.pin, new Set())
    : dealPair(db, pool, new Set())
  const next = dealPair(db, pool, new Set([pair.a.skinId, pair.b.skinId]))
  return {
    pair,
    next,
    stats: statsFor(db, known?.user ?? null, scoped?.pool),
    guestToken: known?.token ?? '',
    refit,
    scope: scoped?.info ?? null,
  }
}

export async function submitBattleVote(
  pairToken: string,
  winnerId: string,
  recent: string[] | undefined,
  restoreToken?: string | null,
  // 'champion' anchors the NEXT pair on the winner (king-of-the-hill); the vote
  // just recorded is identical either way — a normal signed pick — so the
  // ranking never sees the mode. Defaults to shuffle.
  mode?: BattleMode,
  // Scopes the NEXT pair to one wardrobe (see quickBattleState). Like `mode`,
  // it only changes what is dealt next; the vote itself is the same signed
  // pick whatever pool it came from.
  scopeReq?: ScopeRequest | null,
): Promise<BattleVoteResult> {
  const db = getDb()
  const assetVersion = await ensureCatalog(db)
  // First pick mints the guest - the one write a brand-new visitor triggers.
  const { user, token } = ensureUser(db, restoreToken)

  const claim = verifyPairToken(db, pairToken)
  if (winnerId !== claim.a && winnerId !== claim.b) {
    throw new Error('That skin is not part of this matchup.')
  }
  const loserId = winnerId === claim.a ? claim.b : claim.a

  enforceRateLimit(db, user)
  burnNonce(db, claim.n)

  const weight = user.trustTier === 'member' ? MEMBER_WEIGHT : GUEST_WEIGHT
  const date = puzzleDay()
  const pairKey =
    claim.a < claim.b ? `${claim.a}|${claim.b}` : `${claim.b}|${claim.a}`

  // Rank before the update, for the "↑3" part of the feedback.
  const before = getSkinRating(db, winnerId)
  const rankBefore = before.battles > 0 ? globalRank(db, before.rating) : null

  db.exec('BEGIN IMMEDIATE')
  let live
  try {
    live = applyLiveUpdate(db, winnerId, loserId, weight)
    const personalBefore = applyPersonalUpdate(db, user.id, winnerId, loserId)
    const eventId = appendEvent(db, {
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
    // Record just enough to undo this single pick: the event row to delete and
    // the pre-vote snapshots to restore both caches in O(1). Overwrites any
    // prior row - only the most recent pick is undoable.
    db.prepare(
      `INSERT INTO battle_undo (user_id, event_id, snapshot, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         event_id = excluded.event_id,
         snapshot = excluded.snapshot,
         created_at = excluded.created_at`,
    ).run(
      user.id,
      eventId,
      JSON.stringify({
        winnerId,
        loserId,
        type: claim.t,
        // Community reversal composes via inverse-delta (survives concurrent
        // votes/refits), so we store this vote's deltas + weight, not absolute
        // pre-vote ratings. Personal reversal is per-user and can't interleave
        // on the undoable (most-recent) pick, so its absolute snapshot is safe.
        weight,
        winnerDelta: live.winnerDelta,
        loserDelta: live.loserDelta,
        personalBefore,
      }),
      new Date().toISOString(),
    )
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  // Feedback - principle 1: every pick answers back within the same round
  // trip that fetched the next pair.
  const agreement = pairAgreement(db, pairKey, winnerId)
  // The winner's located standing: its rank, the field size, and the named
  // skins on either side - the wordless "needle" for the feedback line.
  const winnerRank = globalRank(db, live.winner.rating)
  const neighbors = rankNeighbors(db, live.winner.rating, winnerRank)
  // Post-update ratings, for the next deal and the within-wardrobe standing.
  const skins = loadRatedSkins(db)
  const scoped = resolveScope(db, skins, scopeReq)
  const pool = scoped?.pool ?? skins
  const feedback: BattleFeedback = {
    winnerSkinId: winnerId,
    winnerName: skinName(db, winnerId),
    loserName: skinName(db, loserId),
    delta: Math.round(live.winnerDelta),
    rating: Math.round(live.winner.rating),
    uncertainty: Math.round(live.winner.uncertainty),
    battles: live.winner.battles,
    rank: winnerRank,
    rankBefore,
    agreementPct: agreement.pct,
    pairVotes: agreement.votes,
    pairWinnerVotes: agreement.winnerVotes,
    ratedCount: ratedCount(db),
    neighborAbove: neighbors.above,
    neighborBelow: neighbors.below,
    scope: scoped ? scopedStanding(scoped.pool, winnerId) : null,
  }

  const exclude = new Set(
    [...(recent ?? []).slice(-16), claim.a, claim.b].filter(Boolean),
  )
  // In champion mode the winner stays on: deal the next challenger against it.
  const nextPair =
    mode === 'champion'
      ? dealChallengerPair(db, pool, winnerId, exclude)
      : dealPair(db, pool, exclude)

  maybeAutoRefit(db, ratingEventCount(db))

  return {
    feedback,
    nextPair,
    stats: statsFor(db, user, scoped?.pool),
    guestToken: token,
    scope: scoped?.info ?? null,
  }
}

// Undo a player's most recent pick: restore both rating caches from the saved
// pre-vote snapshot, delete the vote event (the one place we delete from the
// append-only log), and hand back the exact matchup to decide again. Returns
// null when there's nothing to undo - no user, or the last pick was already
// taken back. Only the single most recent pick is undoable.
export async function undoLastVote(
  restoreToken?: string | null,
): Promise<BattleUndoResult | null> {
  const db = getDb()
  const assetVersion = await ensureCatalog(db)
  const known = peekUser(db, restoreToken)
  if (!known?.user) return null
  const user = known.user

  const row = db
    .prepare(
      'SELECT event_id AS eventId, snapshot FROM battle_undo WHERE user_id = ?',
    )
    .get(user.id) as { eventId: number; snapshot: string } | undefined
  if (!row) return null

  const snap = JSON.parse(row.snapshot) as {
    winnerId: string
    loserId: string
    type: PairType
    weight: number
    winnerDelta: number
    loserDelta: number
    personalBefore: { winnerBefore: PersonalBefore; loserBefore: PersonalBefore }
  }

  // Resolve the matchup to re-present BEFORE mutating anything, so a missing
  // catalog row can't leave the log half-reversed (the reversal is otherwise
  // committed before the pair is rebuilt).
  const aSkin = loadBattleSkin(db, snap.winnerId)
  const bSkin = loadBattleSkin(db, snap.loserId)
  if (!aSkin || !bSkin) throw new Error('Could not restore the matchup.')

  db.exec('BEGIN IMMEDIATE')
  try {
    // Community: inverse-delta on the current rows (composes with concurrent
    // votes/refits). Personal: absolute restore is safe (per-user, no interleave).
    reverseLiveUpdate(
      db,
      snap.winnerId,
      snap.loserId,
      snap.winnerDelta,
      snap.loserDelta,
      snap.weight,
    )
    restorePersonalRating(
      db,
      user.id,
      snap.winnerId,
      snap.personalBefore.winnerBefore,
    )
    restorePersonalRating(
      db,
      user.id,
      snap.loserId,
      snap.personalBefore.loserBefore,
    )
    db.prepare('DELETE FROM game_events WHERE id = ? AND user_id = ?').run(
      row.eventId,
      user.id,
    )
    db.prepare('DELETE FROM battle_undo WHERE user_id = ?').run(user.id)
    // Marker so the day's rate-limit count doesn't drop when the vote row is
    // deleted — otherwise undo→re-vote loops would bypass the daily cap. The
    // refit and battle counts ignore this type (they filter on battle_voted).
    appendEvent(db, {
      userId: user.id,
      game: GAME,
      puzzleDate: puzzleDay(),
      type: 'battle_undone',
      payload: { undoneEventId: row.eventId },
      questionAsked: QUESTION,
      assetVersion,
      trustTier: user.trustTier,
    })
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  // Re-shuffle sides so the retried matchup carries no positional hint.
  const [first, second] = Math.random() < 0.5 ? [aSkin, bSkin] : [bSkin, aSkin]
  const pair: BattlePair = {
    token: signPair(db, first.skinId, second.skinId, snap.type),
    a: first,
    b: second,
  }
  return { pair, stats: statsFor(db, user) }
}

function loadBattleSkin(db: DatabaseSync, skinId: string): BattleSkin | null {
  const row = db
    .prepare(
      `SELECT id, champion_id AS championId, champion_name AS championName,
              name, splash_url AS splashUrl
       FROM catalog_skins WHERE id = ?`,
    )
    .get(skinId) as
    | {
        id: string
        championId: string
        championName: string
        name: string
        splashUrl: string
      }
    | undefined
  if (!row) return null
  return {
    skinId: row.id,
    name: row.name,
    championId: row.championId,
    championName: row.championName,
    splashUrl: row.splashUrl,
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
): { pct: number | null; votes: number; winnerVotes: number } {
  const rows = db
    .prepare(
      `SELECT payload FROM game_events
       WHERE game = ? AND type = 'battle_voted'
         AND json_extract(payload, '$.pairKey') = ?`,
    )
    .all(GAME, pairKey) as unknown as { payload: string }[]
  const votes = rows.length
  const winnerVotes = rows.filter(
    (r) => (JSON.parse(r.payload) as { winnerId: string }).winnerId === winnerId,
  ).length
  // The raw count drives the "you + N agree / first to pick this" line; the
  // percentage stays gated until the matchup has enough votes to be meaningful.
  const pct =
    votes < AGREEMENT_MIN_VOTES ? null : Math.round((100 * winnerVotes) / votes)
  return { pct, votes, winnerVotes }
}
