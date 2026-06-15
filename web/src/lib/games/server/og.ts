// OG share-card renderer (server-only): every games surface gets a
// purpose-built 1200×630 image so links unfurl beautifully on
// Discord/Twitter/Reddit - "a citation that unfurls badly is a citation
// lost" (GAMES_ROADMAP, stable URLs & share cards).
//
// satori lays the card out from a plain VDOM (no React needed) using
// committed TTFs (web/assets/og - Cinzel + Inter, both OFL), then
// @resvg/resvg-js rasterizes to PNG. No system fonts, no headless browser -
// works identically in dev (Windows) and the alpine container.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import { DATA_DIR, getDb } from './db'
import { ensureCatalog } from './catalog'
import { utcToday } from './daily'
import { communityBattleCount } from './quickbattle'
import { splashdleOgInfo } from './splashdle'
import { PALETTE, OG_RED } from '~/lib/brand'

export const OG_CARDS = [
  'games',
  'splashdle',
  'quick-battle',
  'mirror',
  'price-check',
  'chroma-vision',
  'drought',
  'leaderboards',
] as const
export type OgCard = (typeof OG_CARDS)[number]

const W = 1200
const H = 630

// Hextech palette, sourced from the canonical brand constants (satori renders
// outside the browser, so it can't read the Tailwind/CSS tokens).
const C = {
  black: PALETTE['hextech-black'],
  gold1: PALETTE.gold1,
  gold2: PALETTE.gold2,
  gold5: PALETTE.gold5,
  blue2: PALETTE.blue2,
  grey1: PALETTE.grey1,
  red: OG_RED,
}

// ─── fonts ──────────────────────────────────────────────────────────────────

// Committed under web/assets/og; the Dockerfile copies them to /app/assets/og.
function fontsDir(): string {
  for (const dir of [
    process.env.OG_ASSETS_DIR,
    join(process.cwd(), 'assets', 'og'),
    join(process.cwd(), 'web', 'assets', 'og'),
  ]) {
    if (dir && existsSync(join(dir, 'Cinzel-Bold.ttf'))) return dir
  }
  throw new Error('OG fonts not found; expected web/assets/og/*.ttf')
}

let fontCache: { name: string; data: Buffer; weight: 400 | 600 | 700 }[] | null =
  null

function fonts() {
  if (fontCache) return fontCache
  const dir = fontsDir()
  fontCache = [
    { name: 'Cinzel', data: readFileSync(join(dir, 'Cinzel-Bold.ttf')), weight: 700 },
    { name: 'Inter', data: readFileSync(join(dir, 'Inter-Regular.ttf')), weight: 400 },
    { name: 'Inter', data: readFileSync(join(dir, 'Inter-SemiBold.ttf')), weight: 600 },
  ]
  return fontCache
}

// ─── tiny VDOM helpers (satori needs explicit flex everywhere) ──────────────

interface Node {
  type: string
  props: Record<string, unknown>
}

function el(
  type: string,
  style: Record<string, unknown>,
  ...children: (Node | string)[]
): Node {
  return {
    type,
    props: {
      style: { display: 'flex', ...style },
      children: children.length <= 1 ? children[0] : children,
    },
  }
}

const text = (
  content: string,
  style: Record<string, unknown>,
): Node => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children: content },
})

const eyebrow = (s: string) =>
  text(s.toUpperCase(), {
    fontFamily: 'Inter',
    fontWeight: 600,
    fontSize: 24,
    letterSpacing: 8,
    color: C.gold2,
  })

const title = (s: string, size = 84) =>
  text(s, {
    fontFamily: 'Cinzel',
    fontWeight: 700,
    fontSize: size,
    color: C.gold1,
    lineHeight: 1.1,
  })

const body = (s: string, size = 30) =>
  text(s, {
    fontFamily: 'Inter',
    fontWeight: 400,
    fontSize: size,
    color: C.grey1,
    lineHeight: 1.45,
  })

function frame(bg: Node | null, content: Node[]): Node {
  return el(
    'div',
    {
      width: W,
      height: H,
      backgroundColor: C.black,
      position: 'relative',
      fontFamily: 'Inter',
    },
    ...(bg ? [bg] : []),
    el(
      'div',
      {
        position: 'absolute',
        top: 24,
        left: 24,
        right: 24,
        bottom: 24,
        border: `2px solid ${C.gold5}`,
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 52,
      },
      el('div', { flexDirection: 'column', gap: 18, flexGrow: 1 }, ...content),
      el(
        'div',
        { justifyContent: 'space-between', alignItems: 'baseline' },
        text('SKINBATTLE.LOL', {
          fontFamily: 'Cinzel',
          fontWeight: 700,
          fontSize: 30,
          letterSpacing: 6,
          color: C.gold2,
        }),
        text('free · no account needed', {
          fontFamily: 'Inter',
          fontWeight: 400,
          fontSize: 24,
          color: C.grey1,
        }),
      ),
    ),
  )
}

// Full-bleed splash background with a readability gradient.
function splashBg(dataUri: string): Node {
  return el(
    'div',
    { position: 'absolute', top: 0, left: 0, width: W, height: H },
    {
      type: 'img',
      props: {
        src: dataUri,
        width: W,
        height: H,
        style: { objectFit: 'cover', width: W, height: H },
      },
    },
    el('div', {
      position: 'absolute',
      top: 0,
      left: 0,
      width: W,
      height: H,
      backgroundImage:
        'linear-gradient(to right, rgba(1,10,19,0.94) 30%, rgba(1,10,19,0.55) 100%)',
    }),
  )
}

// ─── data ───────────────────────────────────────────────────────────────────

async function fetchAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

function topSkin(): { name: string; splashUrl: string } | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT c.name AS name, c.splash_url AS splashUrl
       FROM skin_ratings r JOIN catalog_skins c ON c.id = r.skin_id
       WHERE r.battles >= 5 ORDER BY r.rating DESC LIMIT 1`,
    )
    .get() as { name: string; splashUrl: string } | undefined
  return row ?? null
}

// ─── cards ──────────────────────────────────────────────────────────────────

async function buildCard(card: OgCard): Promise<Node> {
  const db = getDb()
  await ensureCatalog(db)
  const battles = communityBattleCount(db)
  const battlesLine =
    battles > 0 ? `${battles.toLocaleString('en-US')} community battles fought` : ''

  switch (card) {
    case 'splashdle': {
      const info = await splashdleOgInfo()
      return frame(null, [
        el(
          'div',
          { gap: 48, alignItems: 'center', flexGrow: 1 },
          el(
            'div',
            { flexDirection: 'column', gap: 18, flexGrow: 1, width: 540 },
            eyebrow('Daily · guess the skin'),
            title(`Splashdle #${info.puzzleNumber}`, 76),
            body(
              'Name the skin from a sliver of its splash. It zooms out with every miss. Six guesses.',
            ),
          ),
          {
            type: 'img',
            props: {
              src: info.crop,
              width: 460,
              height: 259,
              style: {
                width: 460,
                height: 259,
                objectFit: 'cover',
                border: `2px solid ${C.gold5}`,
              },
            },
          },
        ),
      ])
    }
    case 'quick-battle': {
      const top = topSkin()
      const bg = top ? await fetchAsDataUri(top.splashUrl) : null
      return frame(bg ? splashBg(bg) : null, [
        el(
          'div',
          { flexDirection: 'column', gap: 18, justifyContent: 'center', flexGrow: 1 },
          eyebrow('Endless · which do you like more?'),
          title('Head-to-Head'),
          body('Two skins. Pick one. Every vote builds the community ranking.'),
          battlesLine
            ? text(battlesLine, {
                fontFamily: 'Inter',
                fontWeight: 600,
                fontSize: 30,
                color: C.gold1,
              })
            : body(''),
        ),
      ])
    }
    case 'mirror': {
      const tierColors = [C.gold1, C.gold2, C.blue2, C.grey1, C.red]
      return frame(null, [
        el(
          'div',
          { flexDirection: 'column', gap: 18, justifyContent: 'center', flexGrow: 1 },
          eyebrow('Your taste, reflected'),
          title('The Mirror'),
          body(
            'The personal tier list your battles build, plus your most contrarian takes.',
          ),
          el(
            'div',
            { gap: 14, marginTop: 10 },
            ...['S', 'A', 'B', 'C', 'D'].map((t, i) =>
              el(
                'div',
                {
                  width: 84,
                  height: 84,
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `2px solid ${C.gold5}`,
                  backgroundColor: 'rgba(1,10,19,0.6)',
                },
                text(t, {
                  fontFamily: 'Cinzel',
                  fontWeight: 700,
                  fontSize: 48,
                  color: tierColors[i],
                }),
              ),
            ),
          ),
        ),
      ])
    }
    case 'chroma-vision': {
      const { chromaOgInfo } = await import('./chromavision')
      const info = await chromaOgInfo()
      return frame(null, [
        el(
          'div',
          { gap: 48, alignItems: 'center', flexGrow: 1 },
          el(
            'div',
            { flexDirection: 'column', gap: 18, flexGrow: 1, width: 540 },
            eyebrow('Daily · hard mode · colors only'),
            title(`Chroma Vision #${info.puzzleNumber}`, 70),
            body(
              'Name the skin from its colors alone. The mosaic sharpens with every miss. Six guesses.',
            ),
          ),
          {
            type: 'img',
            props: {
              src: info.mosaic,
              width: 460,
              height: 259,
              style: {
                width: 460,
                height: 259,
                objectFit: 'cover',
                border: `2px solid ${C.gold5}`,
              },
            },
          },
        ),
      ])
    }
    case 'price-check': {
      const { priceCheckPuzzleNumber } = await import('./pricecheck')
      const { PRICE_TIERS } = await import('./facts')
      return frame(null, [
        el(
          'div',
          { flexDirection: 'column', gap: 18, justifyContent: 'center', flexGrow: 1 },
          eyebrow('Daily · what did it cost?'),
          title(`Price Point #${priceCheckPuzzleNumber(utcToday())}`, 76),
          body('Five skins. Guess what each cost in RP. Legacy relics included.'),
          el(
            'div',
            { gap: 12, marginTop: 10 },
            ...PRICE_TIERS.map((t) =>
              el(
                'div',
                {
                  height: 56,
                  paddingLeft: 22,
                  paddingRight: 22,
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `2px solid ${C.gold5}`,
                  backgroundColor: 'rgba(1,10,19,0.6)',
                },
                text(t.toLocaleString('en-US'), {
                  fontFamily: 'Cinzel',
                  fontWeight: 700,
                  fontSize: 26,
                  color: C.gold1,
                }),
              ),
            ),
          ),
        ),
      ])
    }
    case 'leaderboards': {
      const { leaderboardsState } = await import('./leaderboards')
      const lb = await leaderboardsState()
      const top = lb.battleBoards.find((b) => b.period === 'all')?.entries[0]
      return frame(null, [
        el(
          'div',
          { flexDirection: 'column', gap: 18, justifyContent: 'center', flexGrow: 1 },
          eyebrow('Community · named players only'),
          title('Leaderboards', 84),
          body('Streaks, fastest daily solves, and battle volume.'),
          top
            ? text(
                `Most battles: ${top.name} · ${top.battles.toLocaleString('en-US')}`,
                {
                  fontFamily: 'Inter',
                  fontWeight: 600,
                  fontSize: 30,
                  color: C.gold1,
                },
              )
            : body('The boards are open. Be the first name on them.'),
        ),
      ])
    }
    case 'drought': {
      const { droughtIndex } = await import('./insights')
      const drought = await droughtIndex()
      const leader = drought.rows[0]
      const bg = leader ? await fetchAsDataUri(leader.lastSkinSplashUrl) : null
      return frame(bg ? splashBg(bg) : null, [
        el(
          'div',
          { flexDirection: 'column', gap: 18, justifyContent: 'center', flexGrow: 1 },
          eyebrow('Insights · days since last skin'),
          title('The Skin Drought Index', 68),
          leader
            ? text(
                `${leader.championName}: ${leader.days.toLocaleString('en-US')} days and counting`,
                {
                  fontFamily: 'Inter',
                  fontWeight: 600,
                  fontSize: 32,
                  color: C.gold1,
                },
              )
            : body(''),
          body(
            `${drought.stats.overTwoYears} champions have waited 2+ years. Every champion, ranked.`,
          ),
        ),
      ])
    }
    case 'games':
      return frame(null, [
        el(
          'div',
          { flexDirection: 'column', gap: 18, justifyContent: 'center', flexGrow: 1 },
          eyebrow('A new puzzle every day'),
          title('Daily Skin Games'),
          body(
            'Splashdle · Head-to-Head · The Mirror: daily challenges for League skin connoisseurs.',
          ),
          battlesLine
            ? text(battlesLine, {
                fontFamily: 'Inter',
                fontWeight: 600,
                fontSize: 30,
                color: C.gold1,
              })
            : body(''),
        ),
      ])
  }
}

// ─── public surface ─────────────────────────────────────────────────────────

// Cards are cached per UTC day (stat lines and the Splashdle crop change
// daily; scrapers re-fetch rarely anyway).
async function renderCard(card: OgCard): Promise<Buffer> {
  const dir = join(DATA_DIR, 'cache')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `og-${card}-${utcToday()}.png`)
  if (existsSync(path)) return readFileSync(path)

  const node = await buildCard(card)
  const svg = await satori(node as never, {
    width: W,
    height: H,
    fonts: fonts() as never,
  })
  const png = Buffer.from(
    new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng(),
  )
  writeFileSync(path, png)
  return png
}

// Per-skin OG card: splash + rating ± confidence + rank + battle count
// (the roadmap's skin-page card spec). Cached per skin per UTC day.
export async function skinOgResponse(skinId: string): Promise<Response> {
  const db = getDb()
  await ensureCatalog(db)
  const { getCatalogSkin } = await import('./catalog')
  const skin = getCatalogSkin(db, skinId)
  if (!skin || !/^\d+$/.test(skinId)) {
    return new Response('Not found', { status: 404 })
  }

  try {
    const dir = join(DATA_DIR, 'cache')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `og-skin-${skinId}-${utcToday()}.png`)
    let png: Buffer
    if (existsSync(path)) {
      png = readFileSync(path)
    } else {
      const rating = db
        .prepare(
          'SELECT rating, uncertainty, battles FROM skin_ratings WHERE skin_id = ? AND battles > 0',
        )
        .get(skinId) as
        | { rating: number; uncertainty: number; battles: number }
        | undefined
      const { globalRank } = await import('./ratings')
      const ratedTotal = (
        db
          .prepare('SELECT COUNT(*) AS c FROM skin_ratings WHERE battles > 0')
          .get() as { c: number }
      ).c
      const statLine = rating
        ? `${Math.round(rating.rating)} ± ${Math.round(rating.uncertainty)} · #${globalRank(db, rating.rating)} of ${ratedTotal} rated · ${rating.battles} battles`
        : 'Unranked: no battles fought yet'

      const bg = await fetchAsDataUri(skin.splashUrl)
      const node = frame(bg ? splashBg(bg) : null, [
        el(
          'div',
          { flexDirection: 'column', gap: 16, justifyContent: 'flex-end', flexGrow: 1 },
          eyebrow(skin.championName),
          title(skin.name, 66),
          text(statLine, {
            fontFamily: 'Inter',
            fontWeight: 600,
            fontSize: 30,
            color: C.gold1,
          }),
        ),
      ])
      const svg = await satori(node as never, {
        width: W,
        height: H,
        fonts: fonts() as never,
      })
      png = Buffer.from(
        new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng(),
      )
      writeFileSync(path, png)
    }
    return new Response(new Uint8Array(png), {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=3600',
      },
    })
  } catch (err) {
    console.error(`og skin card render failed (${skinId}):`, err)
    return new Response('Card unavailable', { status: 500 })
  }
}

// Ranking-slice OG card: slice title + top-3 podium text over the #1 skin's
// splash. Cached per slice per UTC day.
export async function rankingsOgResponse(slice: string): Promise<Response> {
  const { rankingsState } = await import('./rankings')
  const state = await rankingsState(slice)
  if (!state) return new Response('Not found', { status: 404 })

  try {
    const dir = join(DATA_DIR, 'cache')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `og-rankings-${slice}-${utcToday()}.png`)
    let png: Buffer
    if (existsSync(path)) {
      png = readFileSync(path)
    } else {
      const top = state.rows.slice(0, 3)
      const bg = top[0] ? await fetchAsDataUri(top[0].splashUrl) : null
      const medals = ['1.', '2.', '3.']
      const node = frame(bg ? splashBg(bg) : null, [
        el(
          'div',
          { flexDirection: 'column', gap: 14, justifyContent: 'center', flexGrow: 1 },
          eyebrow('Community rankings'),
          title(state.title, 60),
          ...(top.length > 0
            ? top.map((r, i) =>
                text(`${medals[i]} ${r.name} · ${r.rating}`, {
                  fontFamily: 'Inter',
                  fontWeight: i === 0 ? 600 : 400,
                  fontSize: i === 0 ? 30 : 26,
                  color: i === 0 ? C.gold1 : C.grey1,
                }),
              )
            : [body('No battles in this slice yet. Be the first.')]),
          state.calibrating
            ? text('Early rankings: still calibrating', {
                fontFamily: 'Inter',
                fontWeight: 400,
                fontSize: 22,
                color: C.blue2,
              })
            : body(''),
        ),
      ])
      const svg = await satori(node as never, {
        width: W,
        height: H,
        fonts: fonts() as never,
      })
      png = Buffer.from(
        new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng(),
      )
      writeFileSync(path, png)
    }
    return new Response(new Uint8Array(png), {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=3600',
      },
    })
  } catch (err) {
    console.error(`og rankings card render failed (${slice}):`, err)
    return new Response('Card unavailable', { status: 500 })
  }
}

export async function ogCardResponse(card: string): Promise<Response> {
  if (!(OG_CARDS as readonly string[]).includes(card)) {
    return new Response('Not found', { status: 404 })
  }
  try {
    const png = await renderCard(card as OgCard)
    return new Response(new Uint8Array(png), {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=3600',
      },
    })
  } catch (err) {
    console.error(`og card render failed (${card}):`, err)
    return new Response('Card unavailable', { status: 500 })
  }
}
