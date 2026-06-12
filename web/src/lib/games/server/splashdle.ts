// Splashdle engine (server-only): a tight crop of a skin splash that zooms
// out with each wrong guess. 6 guesses, guess-the-skin across the full
// catalog. All state is server-authoritative — the client only ever sees
// the crop for its current zoom level, so the answer can't be peeked from
// a splash URL or the full image until the game is over.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Jimp } from 'jimp'
import type { DatabaseSync } from 'node:sqlite'
import type {
  DailyHubState,
  GuessOption,
  SplashdleGuess,
  SplashdleState,
  StreakInfo,
} from '../types'
import { appendEvent, DATA_DIR, getDb } from './db'
import { MAX_GUESSES, puzzleNumber, seedFloats, utcToday } from './daily'
import { allCatalogSkins, ensureCatalog, getCatalogSkin } from './catalog'
import { ensureUser, peekUser, type GameUser } from './guests'
import { getStreak, recordCompletion } from './streaks'
import { communityBattleCount, userBattleCounts } from './quickbattle'
import { priceCheckHubInfo, ROUNDS as PRICE_ROUNDS } from './pricecheck'
import { newThisPatch } from './insights'

const GAME = 'splashdle'
// Recorded on every event so themed variants can be added later without
// poisoning the dataset (rating-system design: store which question was asked).
const QUESTION = 'guess-the-skin'

// Crop width as a fraction of the splash, per zoom level. Level = number of
// guesses made so far; the last level is what a player on their 6th guess sees.
const LEVELS = [0.14, 0.2, 0.28, 0.38, 0.52, 0.7]

interface PuzzleRow {
  skinId: string
  cx: number
  cy: number
  assetVersion: string
}

// ─── puzzle selection ───────────────────────────────────────────────────────

// The day's puzzle is deterministic from the date, then frozen in the db so
// a mid-day patch sync can never swap the answer under players.
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
  const pool = db
    .prepare(
      'SELECT id FROM catalog_skins WHERE splash_ok = 1 ORDER BY champion_id, num',
    )
    .all() as unknown as { id: string }[]
  if (pool.length === 0) throw new Error('skin catalog is empty')

  const [pick, rx, ry] = seedFloats(`${GAME}:${date}`, 3)
  // The seeded pick is only a starting point: a catalog entry can lack real
  // splash art (Riot data is messy), so walk forward until one fetches.
  // Deterministic, and the winner is frozen in daily_puzzles anyway.
  const start = Math.floor(pick * pool.length) % pool.length
  let skinId: string | null = null
  for (let i = 0; i < 25 && !skinId; i++) {
    const candidate = pool[(start + i) % pool.length].id
    if (await fetchSplashToCache(db, date, candidate)) skinId = candidate
  }
  if (!skinId) throw new Error('no candidate skin with a fetchable splash')

  const puzzle: PuzzleRow = {
    skinId,
    // Crop center, kept away from the edges; biased slightly above center
    // where splash subjects tend to sit.
    cx: 0.3 + rx * 0.4,
    cy: 0.28 + ry * 0.36,
    assetVersion,
  }
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

// Download the splash for a candidate skin into the day's cache slot.
// Returns false (without caching) when the asset doesn't exist.
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

// 16:9 crop around the puzzle's center point at the given zoom level,
// cached on disk (6 crops per day, total).
async function cropDataUrl(
  db: DatabaseSync,
  date: string,
  puzzle: PuzzleRow,
  level: number,
): Promise<string> {
  const lv = clamp(level, 0, LEVELS.length - 1)
  const path = join(cacheDir(), `${GAME}-${date}-L${lv}.jpg`)
  if (existsSync(path)) {
    return `data:image/jpeg;base64,${readFileSync(path).toString('base64')}`
  }

  const image = await Jimp.fromBuffer(await fullSplash(db, date, puzzle))
  const W = image.width
  const H = image.height
  let w = Math.round(LEVELS[lv] * W)
  let h = Math.round((w * 9) / 16)
  if (h > H) {
    h = H
    w = Math.min(W, Math.round((h * 16) / 9))
  }
  const x = clamp(Math.round(puzzle.cx * W - w / 2), 0, W - w)
  const y = clamp(Math.round(puzzle.cy * H - h / 2), 0, H - h)
  image.crop({ x, y, w, h })
  const out = await image.getBuffer('image/jpeg', { quality: 82 })
  writeFileSync(path, out)
  return `data:image/jpeg;base64,${Buffer.from(out).toString('base64')}`
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

// Spoiler-free by construction: the grid encodes guess quality, never names.
function buildShareText(
  date: string,
  result: ResultRow,
  streak: StreakInfo,
): string {
  const score =
    result.status === 'won' ? `${result.guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`
  const grid = result.guesses
    .map((g) => (g.correct ? '🟩' : g.championMatch ? '🟨' : '🟥'))
    .join('')
  const lines = [`Splashdle #${puzzleNumber(date)} ${score}`, grid]
  if (result.status === 'won' && streak.current > 1) {
    lines.push(`🔥 ${streak.current}-day streak`)
  }
  lines.push('skinbattle.lol/games')
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
): Promise<SplashdleState> {
  const finished = result.status !== 'in_progress'
  const zoomLevel = clamp(result.guesses.length, 0, LEVELS.length - 1)
  const streakRow = getStreak(db, user.id, GAME)
  const streak = { current: streakRow.current, best: streakRow.best }

  const base: SplashdleState = {
    date,
    puzzleNumber: puzzleNumber(date),
    maxGuesses: MAX_GUESSES,
    status: result.status,
    guesses: result.guesses,
    image: '',
    zoomLevel,
    totalLevels: LEVELS.length,
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
    base.image = await cropDataUrl(db, date, puzzle, zoomLevel)
  }
  return base
}

// ─── public surface (called from server functions) ──────────────────────────

// Read-only: viewing the puzzle never writes. Anonymous visitors (no
// cookie, no backup token — including every crawler) get a playable state
// with an empty guestToken; their user record is minted by their first
// guess, not their first pageview.
export async function splashdleState(
  restoreToken?: string | null,
): Promise<SplashdleState> {
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

export async function submitSplashdleGuess(
  skinId: string,
  restoreToken?: string | null,
): Promise<SplashdleState> {
  const db = getDb()
  const date = utcToday()
  const { user, token } = ensureUser(db, restoreToken)
  const puzzle = await getOrCreatePuzzle(db, date)

  // First guess starts the puzzle: the result row and puzzle_started event
  // are written here, not on pageview, so only real players leave a trace.
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
      payload: { puzzleNumber: puzzleNumber(date) },
      questionAsked: QUESTION,
      assetVersion: puzzle.assetVersion,
      trustTier: user.trustTier,
    })
    result = { status: 'in_progress', guesses: [] }
  }
  if (result.status !== 'in_progress') {
    throw new Error("Today's Splashdle is already finished — come back tomorrow!")
  }
  if (result.guesses.length >= MAX_GUESSES) {
    throw new Error('No guesses left.')
  }
  if (result.guesses.some((g) => g.skinId === skinId)) {
    throw new Error('You already guessed that skin.')
  }
  const guessed = getCatalogSkin(db, skinId)
  if (!guessed) throw new Error('Unknown skin — pick one from the suggestions.')

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

// Data for the Splashdle OG share card: today's puzzle number plus the
// level-0 crop — exactly what a new player sees first, so it's spoiler-free
// by definition.
export async function splashdleOgInfo(): Promise<{
  puzzleNumber: number
  crop: string
}> {
  const db = getDb()
  const date = utcToday()
  const puzzle = await getOrCreatePuzzle(db, date)
  return {
    puzzleNumber: puzzleNumber(date),
    crop: await cropDataUrl(db, date, puzzle, 0),
  }
}

// Autocomplete options for the guess input — the full guessable catalog.
export async function splashdleOptions(): Promise<GuessOption[]> {
  const db = getDb()
  await ensureCatalog(db)
  return allCatalogSkins(db).map((s) => ({
    skinId: s.id,
    name: s.name,
    championId: s.championId,
    championName: s.championName,
  }))
}

// The Daily Hub's today-checklist. Read-only: visiting the hub must not
// start a puzzle (no puzzle_started event, no result row).
export async function dailyHub(
  restoreToken?: string | null,
): Promise<DailyHubState> {
  const db = getDb()
  const date = utcToday()
  const known = peekUser(db, restoreToken)
  const user = known?.user ?? { id: '', trustTier: 'guest' as const }
  const result = known ? readResult(db, user.id, date) : null
  const streakRow = getStreak(db, user.id, GAME)
  const price = priceCheckHubInfo(db, known?.user.id ?? null, date)
  const priceStreak = getStreak(db, user.id, 'price-check')
  return {
    date,
    guestToken: known?.token ?? '',
    quickBattle: {
      userBattles: userBattleCounts(db, known?.user.id ?? null).total,
      communityBattles: communityBattleCount(db),
    },
    mirror: {
      skinsRated: known
        ? (
            db
              .prepare(
                'SELECT COUNT(*) AS c FROM user_skin_ratings WHERE user_id = ? AND battles > 0',
              )
              .get(known.user.id) as { c: number }
          ).c
        : 0,
    },
    newSkins: newThisPatch(db, date),
    games: [
      {
        id: GAME,
        status: result ? result.status : 'not_started',
        guessesUsed: result?.guesses.length ?? 0,
        maxGuesses: MAX_GUESSES,
        streak: { current: streakRow.current, best: streakRow.best },
      },
      {
        id: 'price-check',
        status: price.status === 'not_started' ? 'not_started' : price.status,
        guessesUsed: price.rounds,
        maxGuesses: PRICE_ROUNDS,
        score: price.score,
        streak: { current: priceStreak.current, best: priceStreak.best },
      },
    ],
  }
}
