// Chroma Vision engine (server-only): name the skin from its colors alone.
// The splash is rendered as a coarse color mosaic that sharpens with each
// miss - level 0 is pure color composition (5×3 blocks), level 5 is a
// 44-column pixelation where the silhouette finally emerges. Hard mode by
// design (the roadmap's rotation slot).
//
// Same contracts as Splashdle: server-authoritative state (the answer and
// its splash URL never reach the client mid-game - mosaics ship as data
// URLs), the daily puzzle is seeded from the date and frozen in
// daily_puzzles, reads never write.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Jimp, ResizeStrategy } from 'jimp'
import type { DatabaseSync } from 'node:sqlite'
import type { ChromaVisionState, SplashdleGuess, StreakInfo } from '../types'
import { appendEvent, DATA_DIR, getDb } from './db'
import { skinGuessCounts } from './consensus'
import { MAX_GUESSES, puzzleNumber, seedFloats, puzzleDay } from './daily'
import { allCatalogSkins, ensureCatalog, getCatalogSkin } from './catalog'
import { ensureUser, peekUser, type GameUser } from './guests'
import { getStreak, recordCompletion } from './streaks'

const GAME = 'chroma-vision'
const QUESTION = 'guess-the-skin-from-its-colors'
// Puzzle #1's date.
const EPOCH = '2026-06-12'

// Mosaic columns per level (rows follow 16:9). Level = guesses made so far.
const LEVEL_COLS = [5, 8, 12, 18, 28, 44]
// Rendered size of the mosaic image.
const OUT_W = 960
const OUT_H = 540

interface PuzzleRow {
  skinId: string
  assetVersion: string
}

// ─── puzzle selection ───────────────────────────────────────────────────────

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
  const pool = allCatalogSkins(db)
  if (pool.length === 0) throw new Error('skin catalog is empty')

  const [pick] = seedFloats(`${GAME}:${date}`, 1)
  // The seeded pick is only a starting point: walk forward until a splash
  // actually fetches (Riot data is messy). Deterministic, and the winner is
  // frozen in daily_puzzles anyway.
  const start = Math.floor(pick * pool.length) % pool.length
  let skinId: string | null = null
  for (let i = 0; i < 25 && !skinId; i++) {
    const candidate = pool[(start + i) % pool.length].id
    if (await fetchSplashToCache(db, date, candidate)) skinId = candidate
  }
  if (!skinId) throw new Error('no candidate skin with a fetchable splash')

  const puzzle: PuzzleRow = { skinId, assetVersion }
  db.prepare(
    'INSERT OR IGNORE INTO daily_puzzles (game, puzzle_date, payload, created_at) VALUES (?, ?, ?, ?)',
  ).run(GAME, date, JSON.stringify(puzzle), new Date().toISOString())
  // Re-read in case a concurrent request won the insert race.
  return JSON.parse(read()!.payload) as PuzzleRow
}

// ─── image pipeline ─────────────────────────────────────────────────────────

function cacheDir(): string {
  const dir = join(DATA_DIR, 'cache')
  mkdirSync(dir, { recursive: true })
  return dir
}

async function fetchSplashToCache(
  db: DatabaseSync,
  date: string,
  skinId: string,
): Promise<boolean> {
  const skin = getCatalogSkin(db, skinId)
  if (!skin) return false
  const res = await fetch(skin.splashUrl)
  if (!res.ok) return false
  writeFileSync(
    join(cacheDir(), `${GAME}-${date}-full.jpg`),
    Buffer.from(await res.arrayBuffer()),
  )
  return true
}

async function fullSplash(db: DatabaseSync, date: string, puzzle: PuzzleRow) {
  const path = join(cacheDir(), `${GAME}-${date}-full.jpg`)
  if (existsSync(path)) return readFileSync(path)
  if (!(await fetchSplashToCache(db, date, puzzle.skinId))) {
    throw new Error(`splash fetch failed for ${puzzle.skinId}`)
  }
  return readFileSync(path)
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v))

// Mosaic for a level: squash the splash down to cols×rows (averaging each
// region into one color), then blow it back up with nearest-neighbor so the
// blocks stay crisp. PNG, not JPEG - hard block edges artifact badly.
// Cached on disk (6 mosaics per day, total).
async function mosaicDataUrl(
  db: DatabaseSync,
  date: string,
  puzzle: PuzzleRow,
  level: number,
): Promise<string> {
  const lv = clamp(level, 0, LEVEL_COLS.length - 1)
  const path = join(cacheDir(), `${GAME}-${date}-L${lv}.png`)
  if (existsSync(path)) {
    return `data:image/png;base64,${readFileSync(path).toString('base64')}`
  }

  const cols = LEVEL_COLS[lv]
  const rows = Math.max(2, Math.round((cols * 9) / 16))
  const image = await Jimp.fromBuffer(await fullSplash(db, date, puzzle))
  image.resize({ w: cols, h: rows })
  image.resize({ w: OUT_W, h: OUT_H, mode: ResizeStrategy.NEAREST_NEIGHBOR })
  const out = await image.getBuffer('image/png')
  writeFileSync(path, out)
  return `data:image/png;base64,${Buffer.from(out).toString('base64')}`
}

// ─── result rows ────────────────────────────────────────────────────────────

interface ResultRow {
  status: 'in_progress' | 'won' | 'lost'
  guesses: SplashdleGuess[]
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

// ─── share text ─────────────────────────────────────────────────────────────

function buildShareText(
  date: string,
  result: ResultRow,
  streak: StreakInfo,
): string {
  const score =
    result.status === 'won'
      ? `${result.guesses.length}/${MAX_GUESSES}`
      : `X/${MAX_GUESSES}`
  const grid = result.guesses
    .map((g) => (g.correct ? '🟩' : g.championMatch ? '🟨' : '🟥'))
    .join('')
  const lines = [`Chroma Vision #${puzzleNumber(date, EPOCH)} ${score}`, grid]
  if (result.status === 'won' && streak.current > 1) {
    lines.push(`🔥 ${streak.current}-day streak`)
  }
  lines.push('skinbattle.lol/battle')
  return lines.join('\n')
}

// ─── state assembly ─────────────────────────────────────────────────────────

async function assembleState(
  db: DatabaseSync,
  date: string,
  user: GameUser,
  token: string,
  puzzle: PuzzleRow,
  result: ResultRow,
): Promise<ChromaVisionState> {
  const finished = result.status !== 'in_progress'
  const level = clamp(result.guesses.length, 0, LEVEL_COLS.length - 1)
  const streakRow = getStreak(db, user.id, GAME)
  const streak = { current: streakRow.current, best: streakRow.best }

  const base: ChromaVisionState = {
    date,
    puzzleNumber: puzzleNumber(date, EPOCH),
    maxGuesses: MAX_GUESSES,
    status: result.status,
    guesses: result.guesses,
    guessCounts: skinGuessCounts(
      db,
      GAME,
      date,
      result.guesses.map((g) => g.skinId),
    ),
    image: '',
    zoomLevel: level,
    totalLevels: LEVEL_COLS.length,
    streak,
    guestToken: token,
  }

  if (finished) {
    const skin = getCatalogSkin(db, puzzle.skinId)
    if (!skin) throw new Error(`puzzle skin ${puzzle.skinId} missing from catalog`)
    base.image = skin.splashUrl
    base.answer = {
      skinId: skin.id,
      name: skin.name,
      championId: skin.championId,
      championName: skin.championName,
      splashUrl: skin.splashUrl,
    }
    base.shareText = buildShareText(date, result, streak)
  } else {
    base.image = await mosaicDataUrl(db, date, puzzle, level)
  }
  return base
}

// ─── public surface (called from server functions) ──────────────────────────

// Read-only: viewing the puzzle never writes (peekUser; the user record is
// minted by the first guess, not the first pageview).
export async function chromaVisionState(
  restoreToken?: string | null,
): Promise<ChromaVisionState> {
  const db = getDb()
  const date = puzzleDay()
  const puzzle = await getOrCreatePuzzle(db, date)

  const known = peekUser(db, restoreToken)
  const user = known?.user ?? { id: '', trustTier: 'guest' as const }
  const result = (known && readResult(db, user.id, date)) ?? {
    status: 'in_progress' as const,
    guesses: [],
  }
  return assembleState(db, date, user, known?.token ?? '', puzzle, result)
}

export async function submitChromaGuess(
  skinId: string,
  restoreToken?: string | null,
): Promise<ChromaVisionState> {
  const db = getDb()
  const date = puzzleDay()
  const { user, token } = ensureUser(db, restoreToken)
  const puzzle = await getOrCreatePuzzle(db, date)

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
  if (result.status !== 'in_progress') {
    throw new Error("Today's Chroma Vision is already finished. Come back tomorrow!")
  }
  if (result.guesses.length >= MAX_GUESSES) {
    throw new Error('No guesses left.')
  }
  if (result.guesses.some((g) => g.skinId === skinId)) {
    throw new Error('You already guessed that skin.')
  }
  const guessed = getCatalogSkin(db, skinId)
  if (!guessed) throw new Error('Unknown skin. Pick one from the suggestions.')

  const answer = getCatalogSkin(db, puzzle.skinId)
  if (!answer) throw new Error(`puzzle skin ${puzzle.skinId} missing from catalog`)

  const correct = guessed.id === answer.id
  const guess: SplashdleGuess = {
    skinId: guessed.id,
    name: guessed.name,
    championId: guessed.championId,
    championName: guessed.championName,
    championMatch: !correct && guessed.championId === answer.championId,
    correct,
  }
  const guesses = [...result.guesses, guess]
  const status: ResultRow['status'] = correct
    ? 'won'
    : guesses.length >= MAX_GUESSES
      ? 'lost'
      : 'in_progress'
  const finished = status !== 'in_progress'

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
      guessNumber: guesses.length,
      skinId: guessed.id,
      correct,
      championMatch: guess.championMatch,
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
      payload: { won: status === 'won', guessesUsed: guesses.length },
      questionAsked: QUESTION,
      assetVersion: puzzle.assetVersion,
      trustTier: user.trustTier,
    })
    recordCompletion(db, user.id, GAME, date, status === 'won')
  }

  return assembleState(db, date, user, token, puzzle, { status, guesses })
}

// The hub's checklist slot, read-only.
export function chromaHubInfo(
  db: DatabaseSync,
  userId: string | null,
  date: string,
): { status: ResultRow['status'] | 'not_started'; guessesUsed: number } {
  const result = userId ? readResult(db, userId, date) : null
  if (!result) return { status: 'not_started', guessesUsed: 0 }
  return { status: result.status, guessesUsed: result.guesses.length }
}

// Data for the OG share card: today's puzzle number plus the level-0 mosaic
// - 15 color blocks reveal essentially nothing, spoiler-free by definition.
export async function chromaOgInfo(): Promise<{
  puzzleNumber: number
  mosaic: string
}> {
  const db = getDb()
  const date = puzzleDay()
  const puzzle = await getOrCreatePuzzle(db, date)
  return {
    puzzleNumber: puzzleNumber(date, EPOCH),
    mosaic: await mosaicDataUrl(db, date, puzzle, 0),
  }
}
