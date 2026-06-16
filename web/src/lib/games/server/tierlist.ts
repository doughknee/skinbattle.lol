// Tier List engine (server-only): board selection, signed board tokens, the
// submit write path, and the post-submit community comparison.
//
// It reuses the Quick Battle rating engine wholesale - a submission's implied
// cross-tier comparisons feed the same skin_ratings via applyTierListUpdate
// (ratings.ts), down-weighted for correlation. Like Quick Battle, reads mint
// nothing: a served board is an HMAC-signed stateless token, and the user
// record + event row are created only by an actual submission.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  SharedRankingRow,
  SharedTierListState,
  SubmittedTierList,
  TierBoard,
  TierFeedState,
  TierListResult,
  TierListSkin,
  TierListState,
  TierListStats,
  TierName,
  TierResultRow,
  TierScopeCatalog,
} from '../types'
import { appendEvent, getDb } from './db'
import { sanitizeSharePayload, type SharePayload } from '../share'
import {
  allCatalogSkins,
  baseCatalogSkins,
  championBaseSkin,
  ensureCatalog,
  getCatalogSkin,
  getMeta,
  setMeta,
  type CatalogSkin,
} from './catalog'
import { factsFor, PRICE_TIERS } from './facts'
import { kebab } from '../slug'
import { ensureUser, peekUser, type GameUser } from './guests'
import { puzzleDay } from './daily'
import {
  applyTierListUpdate,
  GUEST_WEIGHT,
  inflateUncertainty,
  maybeAutoRefit,
  MEMBER_WEIGHT,
  ratingEventCount,
  START_UNCERTAINTY,
  tierComparisons,
  TIER_ORDER,
  type TierSkinResult,
} from './ratings'

const GAME = 'tier-list'
const QUESTION = 'which-tier'

// A board must be submitted within this window of being dealt - longer than a
// 1v1 pair because a tier list takes a while to fill.
const BOARD_TTL_MS = 60 * 60 * 1000
const MIN_PLACED = 4 // a submission must place at least this many skins
const MIN_BOARD = 4 // skip scopes thinner than this (not worth ranking)
// Cap a served board so it stays rankable. 30 covers every champion's full set
// (the biggest is ~24 incl. the base skin) while still bounding the huge
// cross-cutting scopes - a single year or rarity:Epic can be 100+ skins, which
// is not a tier list anyone finishes. Oversized scopes keep the most data-hungry
// skins (see buildBoard).
const MAX_BOARD = 30
const RESERVE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000 // re-serve a done board after this
const AGREEMENT_MIN = 5 // "% placed it in your tier" gates until this many
const HOT_TAKE_GAP = 2 // tiers apart from consensus to flag a hot take
const SESSION_RECENT = 12 // boards excluded from "rank another" this sitting

const LIMITS = {
  guest: { perMinute: 6, perDay: 20 },
  member: { perMinute: 10, perDay: 50 },
}

// ─── board identity & scope ─────────────────────────────────────────────────

// Stable content fingerprint of a board's skin set. Changes when a skin is
// added/removed (a new patch), which is what makes a once-done board worth
// re-serving.
export function boardHash(skinIds: string[]): string {
  return createHash('sha256')
    .update([...skinIds].sort().join(','))
    .digest('hex')
    .slice(0, 12)
}

const boardType = (boardId: string): string => boardId.split(':')[0] ?? 'custom'

const BOARD_SUBTITLE =
  'Sort each skin into a tier. No wrong answers, just your taste.'

// Rarity buckets worth their own board (others are too thin / not a theme).
// Order is best→niche so the picker reads naturally.
const RARITIES = ['Ultimate', 'Exalted', 'Transcendent', 'Mythic', 'Legendary', 'Epic', 'Rare']

export interface BoardScope {
  boardId: string
  title: string
  subtitle: string
  skins: CatalogSkin[]
}

// slug → display name for a skin line (e.g. 'star-guardian' → 'Star Guardian').
function lineName(db: DatabaseSync, slug: string): string | null {
  for (const s of allCatalogSkins(db)) {
    for (const set of factsFor(s.id)?.sets ?? []) {
      if (set !== 'Legacy' && kebab(set) === slug) return set
    }
  }
  return null
}

// Resolve a board id to its skins across every axis. The id grammar mirrors the
// rankings slices: champion (within-champ), line / year / price / rarity
// (cross-champion bridges). Returns null for unknown/too-thin scopes.
export function resolveBoard(db: DatabaseSync, boardId: string): BoardScope | null {
  const scoped = (match: (s: CatalogSkin) => boolean, title: string): BoardScope | null => {
    const skins = allCatalogSkins(db).filter(match)
    if (skins.length < MIN_BOARD) return null
    return { boardId, title, subtitle: BOARD_SUBTITLE, skins }
  }

  const champ = /^champion:(.+)$/.exec(boardId)
  if (champ) {
    const skins = allCatalogSkins(db).filter((s) => s.championId === champ[1])
    if (skins.length < MIN_BOARD) return null
    // Anchor champion boards with the base skin so players have a known floor
    // to judge the premium skins against ("is this even better than default?").
    const base = championBaseSkin(db, champ[1])
    return {
      boardId,
      title: `Rank ${skins[0].championName}'s skins`,
      subtitle: BOARD_SUBTITLE,
      skins: base ? [base, ...skins] : skins,
    }
  }
  const line = /^line:(.+)$/.exec(boardId)
  if (line) {
    const name = lineName(db, line[1])
    if (!name) return null
    return scoped((s) => factsFor(s.id)?.sets.includes(name) ?? false, `Rank the ${name} skins`)
  }
  const year = /^year:(\d{4})$/.exec(boardId)
  if (year) {
    return scoped(
      (s) => factsFor(s.id)?.release?.startsWith(year[1]) ?? false,
      `Rank the best skins of ${year[1]}`,
    )
  }
  const price = /^price:(\d+)$/.exec(boardId)
  if (price) {
    const rp = Number(price[1])
    if (!(PRICE_TIERS as readonly number[]).includes(rp)) return null
    return scoped((s) => factsFor(s.id)?.cost === rp, `Rank the ${rp.toLocaleString()} RP skins`)
  }
  const rarity = /^rarity:(.+)$/.exec(boardId)
  if (rarity) {
    const name = RARITIES.find((r) => r.toLowerCase() === rarity[1])
    if (!name) return null
    return scoped((s) => factsFor(s.id)?.rarity === name, `Rank the ${name} skins`)
  }
  return null
}

// ─── make-your-own scope catalog ────────────────────────────────────────────

// Every scope a player can pick from "make your own", grouped by axis and
// filtered to those with enough skins to rank. Pure catalog math — no ratings.
export function tierScopeCatalog(db: DatabaseSync): TierScopeCatalog {
  const champ = new Map<string, { name: string; count: number }>()
  const line = new Map<string, number>()
  const year = new Map<string, number>()
  const price = new Map<number, number>()
  const rarity = new Map<string, number>()
  for (const s of allCatalogSkins(db)) {
    const c = champ.get(s.championId) ?? { name: s.championName, count: 0 }
    c.count += 1
    champ.set(s.championId, c)
    const f = factsFor(s.id)
    for (const set of f?.sets ?? []) {
      if (set !== 'Legacy') line.set(set, (line.get(set) ?? 0) + 1)
    }
    const y = f?.release?.slice(0, 4)
    if (y) year.set(y, (year.get(y) ?? 0) + 1)
    if (f?.cost != null && (PRICE_TIERS as readonly number[]).includes(f.cost)) {
      price.set(f.cost, (price.get(f.cost) ?? 0) + 1)
    }
    if (f?.rarity) rarity.set(f.rarity, (rarity.get(f.rarity) ?? 0) + 1)
  }
  const big = (n: number) => n >= MIN_BOARD
  return {
    champions: [...champ.entries()]
      .filter(([, c]) => big(c.count))
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, c]) => ({ boardId: `champion:${id}`, label: c.name, count: c.count })),
    lines: [...line.entries()]
      .filter(([, n]) => big(n))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, n]) => ({ boardId: `line:${kebab(name)}`, label: name, count: n })),
    years: [...year.entries()]
      .filter(([, n]) => big(n))
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([y, n]) => ({ boardId: `year:${y}`, label: y, count: n })),
    prices: [...price.entries()]
      .filter(([, n]) => big(n))
      .sort((a, b) => a[0] - b[0])
      .map(([rp, n]) => ({ boardId: `price:${rp}`, label: `${rp.toLocaleString()} RP`, count: n })),
    rarities: RARITIES.map((name) => ({ name, count: rarity.get(name) ?? 0 }))
      .filter((r) => big(r.count))
      .map((r) => ({ boardId: `rarity:${r.name.toLowerCase()}`, label: r.name, count: r.count })),
  }
}

// ─── coverage-aware selection ───────────────────────────────────────────────

interface Candidate {
  boardId: string
  need: number // mean (time-inflated) uncertainty across the board's skins
  skinIds: string[]
}

function uncertaintyMap(
  db: DatabaseSync,
): Map<string, { uncertainty: number; lastBattleAt: string | null }> {
  return new Map(
    (
      db
        .prepare(
          'SELECT skin_id, uncertainty, last_battle_at AS lastBattleAt FROM skin_ratings',
        )
        .all() as unknown as {
        skin_id: string
        uncertainty: number
        lastBattleAt: string | null
      }[]
    ).map((r) => [r.skin_id, r]),
  )
}

// Champion boards ranked by how much their skins still need data - the same
// coverage signal that drives the 1v1 matchmaker.
function championCandidates(db: DatabaseSync): Candidate[] {
  const unc = uncertaintyMap(db)
  const now = Date.now()
  const byChamp = new Map<string, { ids: string[]; needSum: number; nonBase: number }>()
  const tally = (s: CatalogSkin, isBase: boolean) => {
    const r = unc.get(s.id)
    const need = r
      ? inflateUncertainty(r.uncertainty, r.lastBattleAt, now)
      : START_UNCERTAINTY
    const e = byChamp.get(s.championId) ?? { ids: [], needSum: 0, nonBase: 0 }
    e.ids.push(s.id)
    e.needSum += need
    if (!isBase) e.nonBase += 1
    byChamp.set(s.championId, e)
  }
  for (const s of allCatalogSkins(db)) tally(s, false)
  // The base skin rides along (matching resolveBoard) so the board hash and
  // coverage score include the baseline; eligibility still gates on real skins.
  for (const s of baseCatalogSkins(db)) tally(s, true)
  const out: Candidate[] = []
  for (const [championId, e] of byChamp) {
    if (e.nonBase < MIN_BOARD) continue
    out.push({
      boardId: `champion:${championId}`,
      need: e.needSum / e.ids.length,
      skinIds: e.ids,
    })
  }
  return out.sort((a, b) => b.need - a.need)
}

// Board ids this user has already submitted → latest {hash, at}.
function userCompleted(
  db: DatabaseSync,
  userId: string,
): Map<string, { hash: string; at: string }> {
  const rows = db
    .prepare(
      `SELECT payload, created_at AS at FROM game_events
       WHERE game = ? AND type = 'tier_submitted' AND user_id = ?`,
    )
    .all(GAME, userId) as unknown as { payload: string; at: string }[]
  const out = new Map<string, { hash: string; at: string }>()
  for (const r of rows) {
    const p = JSON.parse(r.payload) as { boardId: string; boardHash: string }
    const prev = out.get(p.boardId)
    if (!prev || r.at > prev.at) out.set(p.boardId, { hash: p.boardHash, at: r.at })
  }
  return out
}

// A done board is fair to re-serve once it's stale: its contents changed (new
// skin), or the re-serve cooldown elapsed.
export function isStale(
  prior: { hash: string; at: string } | undefined,
  currentHash: string,
  now: number,
): boolean {
  if (!prior) return false
  if (prior.hash !== currentHash) return true
  return now - Date.parse(prior.at) > RESERVE_COOLDOWN_MS
}

// The global daily board: chosen once per UTC day, frozen in daily_puzzles, the
// same for everyone (so "compare your take with friends" works). A date-seeded
// index into the top coverage-need slate - deterministic, but still steering
// data where it's needed.
function dailyBoardId(db: DatabaseSync, date: string): string | null {
  const existing = db
    .prepare('SELECT payload FROM daily_puzzles WHERE game = ? AND puzzle_date = ?')
    .get(GAME, date) as { payload: string } | undefined
  if (existing) return (JSON.parse(existing.payload) as { boardId: string }).boardId

  const cands = championCandidates(db)
  if (cands.length === 0) return null
  const top = Math.min(20, cands.length)
  const seed = [...date].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  const boardId = cands[seed % top].boardId
  db.prepare(
    'INSERT OR IGNORE INTO daily_puzzles (game, puzzle_date, payload, created_at) VALUES (?, ?, ?, ?)',
  ).run(GAME, date, JSON.stringify({ boardId }), new Date().toISOString())
  return boardId
}

// A personalized board for "rank another": highest coverage need, skipping
// boards this user has done (unless stale) and any seen this session.
function pickBoardForUser(
  db: DatabaseSync,
  user: GameUser | null,
  exclude: Set<string>,
): BoardScope {
  const cands = championCandidates(db)
  const completed = user ? userCompleted(db, user.id) : new Map()
  const now = Date.now()
  const eligible = cands.filter(
    (c) =>
      !exclude.has(c.boardId) &&
      isAvailable(completed.get(c.boardId), boardHash(c.skinIds), now),
  )
  const pool = eligible.length > 0 ? eligible : cands
  if (pool.length === 0) throw new Error('No tier-list boards available yet.')
  const top = Math.min(15, pool.length)
  const pick = pool[Math.floor(Math.random() * top)]
  const scope = resolveBoard(db, pick.boardId)
  if (!scope) throw new Error('Could not build a board.')
  return scope
}

const isAvailable = (
  prior: { hash: string; at: string } | undefined,
  currentHash: string,
  now: number,
): boolean => !prior || isStale(prior, currentHash, now)

// ─── board assembly + tokens ────────────────────────────────────────────────

const shuffle = <T>(arr: T[]): T[] => {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Display name: a champion's base (num 0) skin is its own champion name in the
// catalog, which reads like a bug next to the themed skins — label it as the
// baseline so it's unmistakable.
const tierDisplayName = (s: {
  num: number
  name: string
  championName: string
}): string => (s.num === 0 ? `${s.championName} (base skin)` : s.name)

const toTierSkin = (s: CatalogSkin): TierListSkin => ({
  skinId: s.id,
  name: tierDisplayName(s),
  championId: s.championId,
  championName: s.championName,
  splashUrl: s.splashUrl,
})

function buildBoard(db: DatabaseSync, scope: BoardScope): TierBoard {
  let skins = scope.skins
  if (skins.length > MAX_BOARD) {
    // Keep the most data-hungry skins so an oversized board still targets coverage.
    const unc = uncertaintyMap(db)
    const now = Date.now()
    const need = (s: CatalogSkin) => {
      const r = unc.get(s.id)
      return r ? inflateUncertainty(r.uncertainty, r.lastBattleAt, now) : START_UNCERTAINTY
    }
    skins = [...skins].sort((a, b) => need(b) - need(a)).slice(0, MAX_BOARD)
  }
  const dealt = shuffle(skins)
  const skinIds = dealt.map((s) => s.id)
  return {
    token: signBoard(db, scope.boardId, skinIds),
    boardId: scope.boardId,
    boardType: boardType(scope.boardId),
    title: scope.title,
    subtitle: scope.subtitle,
    skins: dealt.map(toTierSkin),
  }
}

interface BoardClaim {
  b: string // boardId
  h: string // content hash
  s: string[] // dealt skin ids (the only skins a submission may place)
  iat: number
  n: string // nonce
}

// Reuses the same signing secret as Quick Battle pair tokens (the claim body
// differs, so there's no cross-use risk).
function secret(db: DatabaseSync): Buffer {
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
  createHmac('sha256', secret(db)).update(payload).digest('base64url')

function signBoard(db: DatabaseSync, boardId: string, skinIds: string[]): string {
  const claim: BoardClaim = {
    b: boardId,
    h: boardHash(skinIds),
    s: skinIds,
    iat: Date.now(),
    n: randomBytes(8).toString('hex'),
  }
  const payload = Buffer.from(JSON.stringify(claim)).toString('base64url')
  return `${payload}.${sign(db, payload)}`
}

function verifyBoard(db: DatabaseSync, token: string): BoardClaim {
  const dot = token.lastIndexOf('.')
  if (dot < 1) throw new Error('Malformed board. Refresh and try again.')
  const payload = token.slice(0, dot)
  const given = Buffer.from(token.slice(dot + 1), 'base64url')
  const expected = Buffer.from(sign(db, payload), 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new Error('Invalid board. Refresh and try again.')
  }
  const claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as BoardClaim
  if (Date.now() - claim.iat > BOARD_TTL_MS) {
    throw new Error('That board expired. Here is a fresh one.')
  }
  return claim
}

// Single-use: burning the nonce twice violates the primary key (shared with
// 1v1 pairs - the nonce space is disjoint by construction).
function burnNonce(db: DatabaseSync, nonce: string): void {
  db.prepare('DELETE FROM battle_nonces WHERE used_at < ?').run(
    new Date(Date.now() - 2 * BOARD_TTL_MS).toISOString(),
  )
  try {
    db.prepare('INSERT INTO battle_nonces (nonce, used_at) VALUES (?, ?)').run(
      nonce,
      new Date().toISOString(),
    )
  } catch {
    throw new Error('This tier list was already counted.')
  }
}

function enforceRateLimit(db: DatabaseSync, user: GameUser): void {
  const limits = LIMITS[user.trustTier]
  const count = (extra: string, params: string[]) =>
    (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM game_events
           WHERE user_id = ? AND game = ? AND type = 'tier_submitted' ${extra}`,
        )
        .get(user.id, GAME, ...params) as { c: number }
    ).c
  if (count('AND puzzle_date = ?', [puzzleDay()]) >= limits.perDay) {
    throw new Error("You've hit today's tier-list limit. Come back tomorrow!")
  }
  const minuteAgo = new Date(Date.now() - 60_000).toISOString()
  if (count('AND created_at > ?', [minuteAgo]) >= limits.perMinute) {
    throw new Error('Whoa, slow down. Give it a few seconds.')
  }
}

// ─── submit + compare ───────────────────────────────────────────────────────

// Keep only dealt skins, drop duplicates, return tiers ordered best→worst.
export function sanitizeTiers(
  tiers: Partial<Record<TierName, string[]>>,
  dealt: Set<string>,
): string[][] {
  const seen = new Set<string>()
  return TIER_ORDER.map((t) =>
    (tiers[t] ?? []).filter(
      (id) => dealt.has(id) && !seen.has(id) && (seen.add(id), true),
    ),
  )
}

// Community tier = the board's skins split into S→D by rating quintile (MVP;
// later: the modal tier from actual placements). Ratings desc → top fifth is S.
export function quintileTiers(idsByRatingDesc: string[]): Map<string, TierName> {
  const out = new Map<string, TierName>()
  const n = idsByRatingDesc.length
  idsByRatingDesc.forEach((id, i) => {
    out.set(id, TIER_ORDER[Math.min(4, Math.floor((i / n) * 5))])
  })
  return out
}

function statsFor(db: DatabaseSync, user: GameUser | null): TierListStats {
  const total = user
    ? (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM game_events WHERE user_id = ? AND game = ? AND type = 'tier_submitted'`,
          )
          .get(user.id, GAME) as { c: number }
      ).c
    : 0
  const community = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM game_events WHERE game = ? AND type = 'tier_submitted'`,
      )
      .get(GAME) as { c: number }
  ).c
  return { total, community, tier: user?.trustTier ?? 'guest' }
}

// For every skin ever placed on this board, how many submissions put it in each
// tier (this submission included). Powers "X% placed it in S".
function tierAgreement(
  db: DatabaseSync,
  boardId: string,
): Map<string, { total: number; byTier: Record<string, number> }> {
  const rows = db
    .prepare(
      `SELECT payload FROM game_events
       WHERE game = ? AND type = 'tier_submitted'
         AND json_extract(payload, '$.boardId') = ?`,
    )
    .all(GAME, boardId) as unknown as { payload: string }[]
  const out = new Map<string, { total: number; byTier: Record<string, number> }>()
  for (const r of rows) {
    const tiers = (JSON.parse(r.payload) as { tiers: Record<string, string[]> }).tiers
    for (const t of TIER_ORDER) {
      for (const id of tiers[t] ?? []) {
        const e = out.get(id) ?? { total: 0, byTier: {} }
        e.total += 1
        e.byTier[t] = (e.byTier[t] ?? 0) + 1
        out.set(id, e)
      }
    }
  }
  return out
}

interface RatingView {
  rating: number
  delta: number
}

// Current community ratings for a set of skins (0 when a skin has none yet).
function ratingsFor(db: DatabaseSync, ids: string[]): Map<string, number> {
  const out = new Map<string, number>()
  if (ids.length === 0) return out
  const rows = db
    .prepare(
      `SELECT skin_id AS id, rating FROM skin_ratings WHERE skin_id IN (${ids
        .map(() => '?')
        .join(',')})`,
    )
    .all(...ids) as unknown as { id: string; rating: number }[]
  for (const r of rows) out.set(r.id, r.rating)
  return out
}

// `ratingOf` lets this serve both the live submit (the just-applied deltas) and
// a restored past submission (current ratings, no fresh delta).
function buildCompare(
  db: DatabaseSync,
  boardId: string,
  ordered: string[][],
  ratingOf: (skinId: string) => RatingView,
): TierResultRow[] {
  const placed = ordered.flat()
  const byRatingDesc = [...placed].sort((a, b) => ratingOf(b).rating - ratingOf(a).rating)
  const community = quintileTiers(byRatingDesc)
  const yourTier = new Map<string, TierName>()
  ordered.forEach((ids, ti) => ids.forEach((id) => yourTier.set(id, TIER_ORDER[ti])))
  const agree = tierAgreement(db, boardId)

  const rows: TierResultRow[] = []
  for (const id of placed) {
    const skin = getCatalogSkin(db, id)
    if (!skin) continue
    const yt = yourTier.get(id)!
    const ct = community.get(id)!
    const a = agree.get(id)
    const same = a?.byTier[yt] ?? 0
    const pct = a && a.total >= AGREEMENT_MIN ? Math.round((100 * same) / a.total) : null
    const rv = ratingOf(id)
    rows.push({
      skinId: id,
      name: tierDisplayName(skin),
      championName: skin.championName,
      splashUrl: skin.splashUrl,
      yourTier: yt,
      communityTier: ct,
      rating: Math.round(rv.rating),
      delta: Math.round(rv.delta),
      agreementPct: pct,
      hotTake: Math.abs(TIER_ORDER.indexOf(yt) - TIER_ORDER.indexOf(ct)) >= HOT_TAKE_GAP,
    })
  }
  return rows // already in your S→D placement order
}

function usernameOf(db: DatabaseSync, userId: string): string | null {
  return (
    (
      db.prepare('SELECT username FROM game_users WHERE id = ?').get(userId) as
        | { username: string | null }
        | undefined
    )?.username ?? null
  )
}

// The player's most recent submission for a board (full saved tiers), or null.
function latestSubmission(
  db: DatabaseSync,
  userId: string,
  boardId: string,
): { tiers: Partial<Record<TierName, string[]>>; hash: string; at: string } | null {
  const row = db
    .prepare(
      `SELECT payload, created_at AS at FROM game_events
       WHERE game = ? AND type = 'tier_submitted' AND user_id = ?
         AND json_extract(payload, '$.boardId') = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(GAME, userId, boardId) as { payload: string; at: string } | undefined
  if (!row) return null
  const p = JSON.parse(row.payload) as {
    tiers: Partial<Record<TierName, string[]>>
    boardHash: string
  }
  return { tiers: p.tiers, hash: p.boardHash, at: row.at }
}

// If the player already ranked this exact board and it's still current (contents
// unchanged, within the re-serve cooldown), rebuild their saved ranking plus a
// fresh community comparison — so a refresh / revisit shows the result instead
// of a blank board. Returns null (→ let them rank) when stale or never done.
function restoreSubmission(
  db: DatabaseSync,
  user: GameUser,
  scope: BoardScope,
): SubmittedTierList | null {
  const prior = latestSubmission(db, user.id, scope.boardId)
  if (!prior) return null
  const currentHash = boardHash(scope.skins.map((s) => s.id))
  if (isStale({ hash: prior.hash, at: prior.at }, currentHash, Date.now())) return null

  const ordered = sanitizeTiers(prior.tiers, new Set(scope.skins.map((s) => s.id)))
  if (ordered.reduce((n, t) => n + t.length, 0) < MIN_PLACED) return null

  const ratings = ratingsFor(db, ordered.flat())
  const rows = buildCompare(db, scope.boardId, ordered, (id) => ({
    rating: ratings.get(id) ?? 0,
    delta: 0, // historical view — no fresh rating move to attribute
  }))
  return {
    tiers: Object.fromEntries(TIER_ORDER.map((t, i) => [t, ordered[i]])),
    result: {
      rows,
      boardId: scope.boardId,
      nextBoard: buildBoard(db, pickBoardForUser(db, user, new Set([scope.boardId]))),
      stats: statsFor(db, user),
      username: usernameOf(db, user.id),
      guestToken: '', // already-known user keeps its own token client-side
    },
  }
}

// ─── public surface (called from server functions) ──────────────────────────

// Read-only: serve the daily board (or a coverage board if the daily can't be
// built) plus the player's stats. Mints nothing.
export async function tierListState(
  restoreToken?: string | null,
  boardId?: string | null,
): Promise<TierListState> {
  const db = getDb()
  await ensureCatalog(db)
  const known = peekUser(db, restoreToken)
  const user = known?.user ?? null

  // Which board to serve: an explicit make-your-own pick, else today's daily,
  // else a coverage-need board.
  let scope: BoardScope | null = boardId ? resolveBoard(db, boardId) : null
  let daily = false
  if (!scope) {
    const dailyScope = (() => {
      const id = dailyBoardId(db, puzzleDay())
      return id ? resolveBoard(db, id) : null
    })()
    if (dailyScope) {
      scope = dailyScope
      daily = true
    } else {
      scope = pickBoardForUser(db, user, new Set())
    }
  }

  // Already ranked this board (and still current)? Restore it so a refresh /
  // revisit shows the saved result instead of forcing a do-over.
  const submitted = user ? restoreSubmission(db, user, scope) : null
  const board = submitted
    ? buildBoard(db, {
        ...scope,
        skins: TIER_ORDER.flatMap((t) => submitted.tiers[t] ?? [])
          .map((id) => getCatalogSkin(db, id))
          .filter((s): s is CatalogSkin => s !== null),
      })
    : buildBoard(db, scope)

  return {
    board,
    daily,
    stats: statsFor(db, user),
    guestToken: known?.token ?? '',
    submitted,
  }
}

// The "make your own" picker's options, grouped by axis (champion / line / year
// / price / rarity). Read-only catalog math; mints nothing.
export async function tierScopes(): Promise<TierScopeCatalog> {
  const db = getDb()
  await ensureCatalog(db)
  return tierScopeCatalog(db)
}

// The community browser: recent submissions (who ranked what + their S picks),
// newest first, paged. Anonymous read.
const FEED_PAGE = 30
const FEED_AXES = ['champion', 'line', 'year', 'price', 'rarity']
export async function tierListFeed(
  offset = 0,
  axis?: string,
  boardId?: string,
): Promise<TierFeedState> {
  const db = getDb()
  await ensureCatalog(db)
  const start = Math.max(0, Math.trunc(offset))
  // A specific board (e.g. champion:Jax) takes precedence over a broad axis.
  const byBoard =
    typeof boardId === 'string' && boardId.length > 0 && boardId.length < 120
      ? boardId
      : null
  const filter = !byBoard && axis && FEED_AXES.includes(axis) ? axis : null
  const clause = (col: string) =>
    byBoard
      ? ` AND json_extract(${col}, '$.boardId') = ?`
      : filter
        ? ` AND json_extract(${col}, '$.boardType') = ?`
        : ''
  const params = byBoard ? [byBoard] : filter ? [filter] : []
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM game_events WHERE game = ? AND type = 'tier_submitted'${clause('payload')}`,
      )
      .get(GAME, ...params) as { c: number }
  ).c
  const raw = db
    .prepare(
      `SELECT ge.payload AS payload, ge.created_at AS at, gu.username AS username
       FROM game_events ge
       LEFT JOIN game_users gu ON gu.id = ge.user_id
       WHERE ge.game = ? AND ge.type = 'tier_submitted'${clause('ge.payload')}
       ORDER BY ge.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(GAME, ...params, FEED_PAGE, start) as unknown as {
    payload: string
    at: string
    username: string | null
  }[]

  // Board titles repeat across rows — resolve each once.
  const titleCache = new Map<string, string>()
  const titleFor = (boardId: string): string => {
    const cached = titleCache.get(boardId)
    if (cached !== undefined) return cached
    const scope = resolveBoard(db, boardId)
    const t = scope ? scope.title.replace(/^Rank /, '') : boardId
    titleCache.set(boardId, t)
    return t
  }

  const rows = raw.map((r) => {
    const p = JSON.parse(r.payload) as {
      boardId: string
      boardType?: string
      tiers: Partial<Record<TierName, string[]>>
      placed?: number
      total?: number
    }
    const sTier = (p.tiers.S ?? [])
      .map((id) => {
        const s = getCatalogSkin(db, id)
        return s ? tierDisplayName(s) : null
      })
      .filter((n): n is string => n !== null)
    return {
      boardId: p.boardId,
      boardTitle: titleFor(p.boardId),
      boardType: p.boardType ?? p.boardId.split(':')[0] ?? 'custom',
      who: r.username?.trim() || 'Guest',
      sTier,
      placed: p.placed ?? 0,
      total: p.total ?? 0,
      at: r.at,
    }
  })

  return { rows, total, offset: start, pageSize: FEED_PAGE }
}

export async function submitTierList(
  boardToken: string,
  tiers: Partial<Record<TierName, string[]>>,
  recent: string[] | undefined,
  restoreToken?: string | null,
): Promise<TierListResult> {
  const db = getDb()
  const assetVersion = await ensureCatalog(db)
  const { user, token } = ensureUser(db, restoreToken)

  const claim = verifyBoard(db, boardToken)
  const ordered = sanitizeTiers(tiers, new Set(claim.s))
  const placedCount = ordered.reduce((n, t) => n + t.length, 0)
  if (placedCount < MIN_PLACED) {
    throw new Error(`Place at least ${MIN_PLACED} skins before submitting.`)
  }

  enforceRateLimit(db, user)
  burnNonce(db, claim.n)

  const trust = user.trustTier === 'member' ? MEMBER_WEIGHT : GUEST_WEIGHT
  const comps = tierComparisons(ordered)
  const tiersObj = Object.fromEntries(TIER_ORDER.map((t, i) => [t, ordered[i]]))

  let results: TierSkinResult[]
  db.exec('BEGIN IMMEDIATE')
  try {
    results = applyTierListUpdate(db, user.id, ordered, trust)
    appendEvent(db, {
      userId: user.id,
      game: GAME,
      puzzleDate: puzzleDay(),
      type: 'tier_submitted',
      payload: {
        boardId: claim.b,
        boardHash: claim.h,
        boardType: boardType(claim.b),
        tiers: tiersObj,
        placed: placedCount,
        total: claim.s.length,
        pairs: comps.length,
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

  // Fold this submission into the canonical Bradley-Terry fit on the usual
  // cadence — Tier Drop volume now advances the refit too, not just 1v1 votes.
  // Deferred off the request path (setImmediate inside maybeAutoRefit).
  maybeAutoRefit(db, ratingEventCount(db))

  const after = new Map(results.map((r) => [r.skinId, r]))
  const rows = buildCompare(db, claim.b, ordered, (id) => ({
    rating: after.get(id)?.after ?? 0,
    delta: after.get(id)?.delta ?? 0,
  }))
  const exclude = new Set([...(recent ?? []).slice(-SESSION_RECENT), claim.b])
  const nextBoard = buildBoard(db, pickBoardForUser(db, user, exclude))
  return {
    rows,
    boardId: claim.b,
    nextBoard,
    stats: statsFor(db, user),
    username: usernameOf(db, user.id),
    guestToken: token,
  }
}

// ─── shares ─────────────────────────────────────────────────────────────────

const SHARE_ID = /^[A-Za-z0-9_-]{6,16}$/

// Store a share payload, return its short id. Minted on demand when a player
// shares, so links stay short (/battle/tier-drop?s=<id>) and the image endpoint +
// recipient view resolve by id. Validates the (client-supplied) input first.
export function createTierShare(input: unknown): { id: string } {
  const payload = sanitizeSharePayload(input)
  if (!payload) throw new Error('Invalid share.')
  const db = getDb()
  const json = JSON.stringify(payload)
  const now = new Date().toISOString()
  for (let i = 0; i < 5; i++) {
    const id = randomBytes(6).toString('base64url') // ~8 url-safe chars
    try {
      db.prepare(
        'INSERT INTO tier_shares (id, payload, created_at) VALUES (?, ?, ?)',
      ).run(id, json, now)
      return { id }
    } catch {
      // Astronomically rare id collision — retry with a fresh one.
    }
  }
  throw new Error('Could not create a share link.')
}

export function getTierShare(db: DatabaseSync, id: string): SharePayload | null {
  if (!SHARE_ID.test(id)) return null
  const row = db.prepare('SELECT payload FROM tier_shares WHERE id = ?').get(id) as
    | { payload: string }
    | undefined
  if (!row) return null
  try {
    return sanitizeSharePayload(JSON.parse(row.payload))
  } catch {
    return null
  }
}

function resolveRanking(
  db: DatabaseSync,
  tiers: Partial<Record<TierName, string[]>>,
): SharedRankingRow[] {
  const out: SharedRankingRow[] = []
  for (const tier of TIER_ORDER) {
    for (const id of tiers[tier] ?? []) {
      const s = getCatalogSkin(db, id)
      if (s) {
        out.push({
          skinId: id,
          name: tierDisplayName(s),
          championName: s.championName,
          splashUrl: s.splashUrl,
          tier,
        })
      }
    }
  }
  return out
}

// What a recipient sees when they open a share link. The board they (re)rank is
// the sharer's exact placed set (so the comparison lines up), or the full
// champion board for a 'board'-only share. An unknown/expired id falls back to
// a normal coverage board so the link is never a dead end.
export async function sharedTierListState(
  id: string,
  restoreToken?: string | null,
): Promise<SharedTierListState> {
  const db = getDb()
  await ensureCatalog(db)
  const known = peekUser(db, restoreToken)
  const base = {
    shareId: id,
    stats: statsFor(db, known?.user ?? null),
    guestToken: known?.token ?? '',
  }
  const fallback = (): SharedTierListState => ({
    found: false,
    mode: 'board',
    sharerName: null,
    reveal: false,
    board: buildBoard(db, pickBoardForUser(db, known?.user ?? null, new Set())),
    ranking: null,
    ...base,
  })

  const payload = getTierShare(db, id)
  if (!payload) return fallback()
  const scope = resolveBoard(db, payload.boardId)
  if (!scope) return fallback()

  let board: TierBoard
  let ranking: SharedRankingRow[] | null = null
  if (payload.mode === 'board' || !payload.tiers) {
    board = buildBoard(db, scope)
  } else {
    const ids = TIER_ORDER.flatMap((t) => payload.tiers![t] ?? [])
    const skins = ids
      .map((sid) => getCatalogSkin(db, sid))
      .filter((s): s is CatalogSkin => s !== null)
    board = buildBoard(db, { ...scope, skins })
    ranking = resolveRanking(db, payload.tiers)
  }

  return {
    found: true,
    mode: payload.mode,
    sharerName: payload.name ?? null,
    reveal: payload.mode === 'reveal',
    board,
    ranking,
    ...base,
  }
}
