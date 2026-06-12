// Price Check engine (server-only): five skins a day, guess each one's RP
// tier. Prices come from the committed Meraki snapshot (server/facts.ts) —
// never fetched at runtime. Legacy skins stay in the pool and surface a fun
// fact ("not even buyable anymore"), per the roadmap.
//
// Reads never write: viewing the page resolves state with peekUser; the
// result row, puzzle_started event, and guest user are all created by the
// first actual guess. The unanswered round's price never reaches the client
// — only answered rounds carry facts.

import type { DatabaseSync } from 'node:sqlite'
import type { PriceCheckState, PriceRoundResult, StreakInfo } from '../types'
import { appendEvent, getDb } from './db'
import { puzzleNumber, seedFloats, utcToday } from './daily'
import { allCatalogSkins, ensureCatalog, type CatalogSkin } from './catalog'
import { ensureUser, peekUser, type GameUser } from './guests'
import { getStreak, recordCompletion } from './streaks'
import { factsFor, PRICE_TIERS, priceCheckIds } from './facts'

const GAME = 'price-check'
const QUESTION = 'guess-the-rp-tier'
export const ROUNDS = 5
// Win = majority exact. One-tier-off earns a 🟨 in the share grid but no
// point — the agony of 975-vs-1350 is the game.
export const WIN_SCORE = 3
// Puzzle #1's date (first deploy day, UTC).
const EPOCH = '2026-06-11'

interface PuzzleRow {
  skinIds: string[]
  assetVersion: string
}

// ─── puzzle selection ───────────────────────────────────────────────────────

// Five seeded skins with known standard-tier prices and live splash art, on
// five distinct champions. Deterministic from the date, then frozen in
// daily_puzzles (same contract as Splashdle).
async function getOrCreatePuzzle(
  db: DatabaseSync,
  date: string,
): Promise<PuzzleRow> {
  const read = () =>
    db
      .prepare(
        'SELECT payload FROM daily_puzzles WHERE game = ? AND puzzle_date = ?',
      )
      .get(GAME, date) as { payload: string } | undefined

  const existing = read()
  if (existing) return JSON.parse(existing.payload) as PuzzleRow

  const assetVersion = await ensureCatalog(db)
  const priced = new Set(priceCheckIds())
  const pool = allCatalogSkins(db).filter((s) => priced.has(s.id))
  if (pool.length < ROUNDS) throw new Error('price-check pool is empty')

  const floats = seedFloats(`${GAME}:${date}`, ROUNDS * 8)
  const picked: CatalogSkin[] = []
  const champions = new Set<string>()
  let f = 0
  while (picked.length < ROUNDS && f < floats.length) {
    const candidate = pool[Math.floor(floats[f++] * pool.length) % pool.length]
    if (champions.has(candidate.championId)) continue
    picked.push(candidate)
    champions.add(candidate.championId)
  }
  // Seeded floats exhausted with collisions left (vanishingly unlikely):
  // walk the pool deterministically for the remainder.
  for (let i = 0; picked.length < ROUNDS && i < pool.length; i++) {
    const candidate = pool[i]
    if (champions.has(candidate.championId)) continue
    picked.push(candidate)
    champions.add(candidate.championId)
  }

  const puzzle: PuzzleRow = { skinIds: picked.map((s) => s.id), assetVersion }
  db.prepare(
    'INSERT OR IGNORE INTO daily_puzzles (game, puzzle_date, payload, created_at) VALUES (?, ?, ?, ?)',
  ).run(GAME, date, JSON.stringify(puzzle), new Date().toISOString())
  return JSON.parse(read()!.payload) as PuzzleRow
}

// ─── result rows ────────────────────────────────────────────────────────────

interface GuessRecord {
  skinId: string
  guess: number
}

interface ResultRow {
  status: 'in_progress' | 'won' | 'lost'
  guesses: GuessRecord[]
}

function readResult(
  db: DatabaseSync,
  userId: string,
  date: string,
): ResultRow | null {
  const row = db
    .prepare(
      'SELECT status, guesses FROM daily_results WHERE user_id = ? AND game = ? AND puzzle_date = ?',
    )
    .get(userId, GAME, date) as
    | { status: ResultRow['status']; guesses: string }
    | undefined
  if (!row) return null
  return { status: row.status, guesses: JSON.parse(row.guesses) }
}

// ─── scoring ────────────────────────────────────────────────────────────────

function gradeGuess(skinId: string, guess: number, db: DatabaseSync) {
  const facts = factsFor(skinId)
  const skin = db
    .prepare(
      'SELECT name, champion_name AS championName, splash_url AS splashUrl FROM catalog_skins WHERE id = ?',
    )
    .get(skinId) as
    | { name: string; championName: string; splashUrl: string }
    | undefined
  const actual = facts?.cost ?? 0
  const gi = (PRICE_TIERS as readonly number[]).indexOf(guess)
  const ai = (PRICE_TIERS as readonly number[]).indexOf(actual)
  const result: PriceRoundResult = {
    skinId,
    name: skin?.name ?? 'Unknown skin',
    championName: skin?.championName ?? '',
    splashUrl: skin?.splashUrl ?? '',
    guess,
    actual,
    correct: guess === actual,
    oneOff: guess !== actual && gi >= 0 && ai >= 0 && Math.abs(gi - ai) === 1,
    legacy: facts?.availability === 'Legacy',
  }
  return result
}

const scoreOf = (results: PriceRoundResult[]) =>
  results.filter((r) => r.correct).length

// ─── share text ─────────────────────────────────────────────────────────────

function buildShareText(
  date: string,
  results: PriceRoundResult[],
  streak: StreakInfo,
): string {
  const grid = results
    .map((r) => (r.correct ? '🟩' : r.oneOff ? '🟨' : '🟥'))
    .join('')
  const lines = [
    `Price Check #${puzzleNumber(date, EPOCH)} ${scoreOf(results)}/${ROUNDS}`,
    grid,
  ]
  if (streak.current > 1) lines.push(`🔥 ${streak.current}-day streak`)
  lines.push('skinbattle.lol/games')
  return lines.join('\n')
}

// ─── state assembly ─────────────────────────────────────────────────────────

function assembleState(
  db: DatabaseSync,
  date: string,
  user: GameUser,
  token: string,
  puzzle: PuzzleRow,
  result: ResultRow,
): PriceCheckState {
  const results = result.guesses.map((g) => gradeGuess(g.skinId, g.guess, db))
  const finished = result.status !== 'in_progress'
  const streakRow = getStreak(db, user.id, GAME)
  const streak = { current: streakRow.current, best: streakRow.best }

  let current: PriceCheckState['current'] = null
  if (!finished && result.guesses.length < ROUNDS) {
    const skinId = puzzle.skinIds[result.guesses.length]
    const skin = db
      .prepare(
        'SELECT name, champion_name AS championName, splash_url AS splashUrl FROM catalog_skins WHERE id = ?',
      )
      .get(skinId) as
      | { name: string; championName: string; splashUrl: string }
      | undefined
    current = {
      round: result.guesses.length + 1,
      skinId,
      name: skin?.name ?? 'Unknown skin',
      championName: skin?.championName ?? '',
      splashUrl: skin?.splashUrl ?? '',
    }
  }

  return {
    date,
    puzzleNumber: puzzleNumber(date, EPOCH),
    status: result.status,
    tiers: [...PRICE_TIERS],
    totalRounds: ROUNDS,
    winScore: WIN_SCORE,
    score: scoreOf(results),
    results,
    current,
    streak,
    shareText: finished ? buildShareText(date, results, streak) : undefined,
    guestToken: token,
  }
}

// ─── public surface (called from server functions) ──────────────────────────

export async function priceCheckState(
  restoreToken?: string | null,
): Promise<PriceCheckState> {
  const db = getDb()
  const date = utcToday()
  const puzzle = await getOrCreatePuzzle(db, date)

  const known = peekUser(db, restoreToken)
  const user = known?.user ?? { id: '', trustTier: 'guest' as const }
  const result = (known && readResult(db, user.id, date)) ?? {
    status: 'in_progress' as const,
    guesses: [],
  }
  return assembleState(db, date, user, known?.token ?? '', puzzle, result)
}

export async function submitPriceGuess(
  tier: number,
  restoreToken?: string | null,
): Promise<PriceCheckState> {
  const db = getDb()
  const date = utcToday()
  const { user, token } = ensureUser(db, restoreToken)
  const puzzle = await getOrCreatePuzzle(db, date)

  if (!(PRICE_TIERS as readonly number[]).includes(tier)) {
    throw new Error('Pick one of the RP tiers.')
  }

  let result = readResult(db, user.id, date)
  if (!result) {
    db.prepare(
      'INSERT INTO daily_results (user_id, game, puzzle_date, status, guesses) VALUES (?, ?, ?, ?, ?)',
    ).run(user.id, GAME, date, 'in_progress', '[]')
    appendEvent(db, {
      userId: user.id,
      game: GAME,
      puzzleDate: date,
      type: 'puzzle_started',
      payload: { puzzleNumber: puzzleNumber(date, EPOCH) },
      questionAsked: QUESTION,
      assetVersion: puzzle.assetVersion,
      trustTier: user.trustTier,
    })
    result = { status: 'in_progress', guesses: [] }
  }
  if (result.status !== 'in_progress' || result.guesses.length >= ROUNDS) {
    throw new Error("Today's Price Check is already finished — come back tomorrow!")
  }

  const skinId = puzzle.skinIds[result.guesses.length]
  const graded = gradeGuess(skinId, tier, db)
  const guesses = [...result.guesses, { skinId, guess: tier }]
  const finished = guesses.length >= ROUNDS
  const score = scoreOf(guesses.map((g) => gradeGuess(g.skinId, g.guess, db)))
  const status: ResultRow['status'] = finished
    ? score >= WIN_SCORE
      ? 'won'
      : 'lost'
    : 'in_progress'

  db.prepare(
    `UPDATE daily_results SET status = ?, guesses = ?, completed_at = ?
     WHERE user_id = ? AND game = ? AND puzzle_date = ?`,
  ).run(
    status,
    JSON.stringify(guesses),
    finished ? new Date().toISOString() : null,
    user.id,
    GAME,
    date,
  )
  appendEvent(db, {
    userId: user.id,
    game: GAME,
    puzzleDate: date,
    type: 'guess_submitted',
    payload: {
      round: guesses.length,
      skinId,
      guess: tier,
      actual: graded.actual,
      correct: graded.correct,
      oneOff: graded.oneOff,
    },
    questionAsked: QUESTION,
    assetVersion: puzzle.assetVersion,
    trustTier: user.trustTier,
  })
  if (finished) {
    appendEvent(db, {
      userId: user.id,
      game: GAME,
      puzzleDate: date,
      type: 'puzzle_completed',
      payload: { won: status === 'won', score },
      questionAsked: QUESTION,
      assetVersion: puzzle.assetVersion,
      trustTier: user.trustTier,
    })
    recordCompletion(db, user.id, GAME, date, status === 'won')
  }

  return assembleState(db, date, user, token, puzzle, { status, guesses })
}

// For the OG share card.
export const priceCheckPuzzleNumber = (date: string): number =>
  puzzleNumber(date, EPOCH)

// Hub-card data, read-only.
export function priceCheckHubInfo(
  db: DatabaseSync,
  userId: string | null,
  date: string,
): { status: ResultRow['status'] | 'not_started'; rounds: number; score: number } {
  const result = userId ? readResult(db, userId, date) : null
  if (!result) return { status: 'not_started', rounds: 0, score: 0 }
  return {
    status: result.status,
    rounds: result.guesses.length,
    score: scoreOf(result.guesses.map((g) => gradeGuess(g.skinId, g.guess, getDb()))),
  }
}
