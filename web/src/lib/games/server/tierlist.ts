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
  TierBoard,
  TierListResult,
  TierListSkin,
  TierListState,
  TierListStats,
  TierName,
  TierResultRow,
} from '../types'
import { appendEvent, getDb } from './db'
import {
  allCatalogSkins,
  ensureCatalog,
  getCatalogSkin,
  getMeta,
  setMeta,
  type CatalogSkin,
} from './catalog'
import { ensureUser, peekUser, type GameUser } from './guests'
import { utcToday } from './daily'
import {
  applyTierListUpdate,
  GUEST_WEIGHT,
  inflateUncertainty,
  MEMBER_WEIGHT,
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
const MAX_BOARD = 15 // cap a served board; keep the most data-hungry skins
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

export interface BoardScope {
  boardId: string
  title: string
  subtitle: string
  skins: CatalogSkin[]
}

// Resolve a board id to its skins. MVP: champion only. The id grammar mirrors
// the rankings slices, so the Phase-2 axes (line/year/price/rarity) slot in
// here as more branches.
export function resolveBoard(db: DatabaseSync, boardId: string): BoardScope | null {
  const champ = /^champion:(.+)$/.exec(boardId)
  if (champ) {
    const skins = allCatalogSkins(db).filter((s) => s.championId === champ[1])
    if (skins.length < MIN_BOARD) return null
    return {
      boardId: `champion:${champ[1]}`,
      title: `Rank ${skins[0].championName}'s skins`,
      subtitle: 'Drag each skin into a tier — no wrong answers, just your taste.',
      skins,
    }
  }
  return null
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
  const byChamp = new Map<string, { ids: string[]; needSum: number }>()
  for (const s of allCatalogSkins(db)) {
    const r = unc.get(s.id)
    const need = r
      ? inflateUncertainty(r.uncertainty, r.lastBattleAt, now)
      : START_UNCERTAINTY
    const e = byChamp.get(s.championId) ?? { ids: [], needSum: 0 }
    e.ids.push(s.id)
    e.needSum += need
    byChamp.set(s.championId, e)
  }
  const out: Candidate[] = []
  for (const [championId, e] of byChamp) {
    if (e.ids.length < MIN_BOARD) continue
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

const toTierSkin = (s: CatalogSkin): TierListSkin => ({
  skinId: s.id,
  name: s.name,
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
  if (count('AND puzzle_date = ?', [utcToday()]) >= limits.perDay) {
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

function buildCompare(
  db: DatabaseSync,
  boardId: string,
  ordered: string[][],
  results: TierSkinResult[],
): TierResultRow[] {
  const after = new Map(results.map((r) => [r.skinId, r]))
  const placed = ordered.flat()
  const byRatingDesc = [...placed].sort(
    (a, b) => (after.get(b)?.after ?? 0) - (after.get(a)?.after ?? 0),
  )
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
    rows.push({
      skinId: id,
      name: skin.name,
      championName: skin.championName,
      splashUrl: skin.splashUrl,
      yourTier: yt,
      communityTier: ct,
      rating: Math.round(after.get(id)?.after ?? 0),
      delta: Math.round(after.get(id)?.delta ?? 0),
      agreementPct: pct,
      hotTake: Math.abs(TIER_ORDER.indexOf(yt) - TIER_ORDER.indexOf(ct)) >= HOT_TAKE_GAP,
    })
  }
  return rows // already in your S→D placement order
}

// ─── public surface (called from server functions) ──────────────────────────

// Read-only: serve the daily board (or a coverage board if the daily can't be
// built) plus the player's stats. Mints nothing.
export async function tierListState(restoreToken?: string | null): Promise<TierListState> {
  const db = getDb()
  await ensureCatalog(db)
  const known = peekUser(db, restoreToken)

  const dailyId = dailyBoardId(db, utcToday())
  const dailyScope = dailyId ? resolveBoard(db, dailyId) : null
  const scope = dailyScope ?? pickBoardForUser(db, known?.user ?? null, new Set())
  return {
    board: buildBoard(db, scope),
    daily: dailyScope !== null,
    stats: statsFor(db, known?.user ?? null),
    guestToken: known?.token ?? '',
  }
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
      puzzleDate: utcToday(),
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

  const rows = buildCompare(db, claim.b, ordered, results)
  const exclude = new Set([...(recent ?? []).slice(-SESSION_RECENT), claim.b])
  const nextBoard = buildBoard(db, pickBoardForUser(db, user, exclude))
  return { rows, nextBoard, stats: statsFor(db, user), guestToken: token }
}
