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
import { createHash } from 'node:crypto'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import { DATA_DIR, getDb } from './db'
import { ensureCatalog } from './catalog'
import { puzzleDay } from './daily'
import { communityBattleCount } from './quickbattle'
import { splashdleOgInfo } from './splashdle'
import { PALETTE, OG_RED } from '~/lib/brand'

export const OG_CARDS = [
  'games',
  'splashdle',
  'quick-battle',
  'tier-list',
  'mirror',
  'price-check',
  'chroma-vision',
  'drought',
  'leaderboards',
] as const
export type OgCard = (typeof OG_CARDS)[number]

const W = 1200
const H = 630

// The downloadable tier-list share image is taller (5 tier rows of thumbnails).
const SHARE_W = 1200
const SHARE_H = 1000

// Tier colors for the share image, matching the in-app builder. [fill, text].
const TIER_HEX: Record<string, [string, string]> = {
  S: ['#c8423a', '#ffffff'],
  A: ['#d98a2b', '#0a1014'],
  B: ['#3fa05a', '#0a1014'],
  C: ['#3a78c8', '#ffffff'],
  D: ['#565a63', '#ffffff'],
}

// Hextech palette, sourced from the canonical brand constants (satori renders
// outside the browser, so it can't read the Tailwind/CSS tokens).
const C = {
  black: PALETTE['hextech-black'],
  gold1: PALETTE.gold1,
  gold2: PALETTE.gold2,
  gold5: PALETTE.gold5,
  blue2: PALETTE.blue2,
  grey1: PALETTE.grey1,
  icon: PALETTE.icon,
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

// `cta` swaps the footer's right-hand line for a share card's ask - in gold,
// and large enough to survive a chat thumbnail.
function frame(bg: Node | null, content: Node[], cta?: string): Node {
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
        cta
          ? text(cta, {
              fontFamily: 'Inter',
              fontWeight: 600,
              fontSize: 34,
              color: C.gold1,
            })
          : text('free · no account needed', {
              fontFamily: 'Inter',
              fontWeight: 400,
              fontSize: 24,
              color: C.grey1,
            }),
      ),
    ),
  )
}

// Full-bleed splash background with a readability gradient. `vivid` keeps
// the art bright on the right half (the text column sits on the left), for
// cards whose whole point is the skin - a ranking share is an argument about
// art, and a near-black wash over it argues for nothing.
function splashBg(dataUri: string, vivid = false): Node {
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
      backgroundImage: vivid
        ? 'linear-gradient(to right, rgba(1,10,19,0.96) 0%, rgba(1,10,19,0.9) 40%, rgba(1,10,19,0.3) 66%, rgba(1,10,19,0.1) 100%)'
        : 'linear-gradient(to right, rgba(1,10,19,0.94) 30%, rgba(1,10,19,0.55) 100%)',
    }),
    ...(vivid
      ? [
          // A low fade so the footer strip stays legible over bright art.
          el('div', {
            position: 'absolute',
            top: 0,
            left: 0,
            width: W,
            height: H,
            backgroundImage:
              'linear-gradient(to bottom, rgba(1,10,19,0) 70%, rgba(1,10,19,0.75) 100%)',
          }),
        ]
      : []),
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

// The share cards' backdrop, composed with jimp (already here for the
// Splashdle crops) because satori has neither blur nor masks: the splash
// blurred edge to edge, with the crisp splash blended back in from the middle
// rightward through a horizontal alpha ramp. The satori overlay on top
// (shareBg) then leans dark on the left - black plus blur behind the words -
// and lifts to a light tint on the right, so the skin itself reads at near
// full strength where no words are. Contrast where the type is, art where it
// is not: what a chat thumbnail needs.
// The text column runs to ~90% of the width on its longest lines, so the
// crisp art only takes over on the right third; long lines still sit on the
// black-and-blur side.
const BLEND_FROM = 0.5 // the crisp art starts here, as a fraction of the width
const BLEND_TO = 0.74 // ...and is fully crisp from here

async function shareBackground(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const { Jimp } = await import('jimp')
    const src = await Jimp.fromBuffer(Buffer.from(await res.arrayBuffer()))
    src.cover({ w: W, h: H })
    const blurred = src.clone().blur(16)
    // Grayscale ramp: black (transparent) on the left, white (opaque) on the
    // right, so masking the crisp copy with it fades the art in left to right.
    const ramp = new Jimp({ width: W, height: H, color: 0x000000ff })
    const x0 = Math.round(W * BLEND_FROM)
    const x1 = Math.round(W * BLEND_TO)
    ramp.scan((x, _y, idx) => {
      const t = x <= x0 ? 0 : x >= x1 ? 1 : (x - x0) / (x1 - x0)
      const v = Math.round(255 * t)
      ramp.bitmap.data[idx] = v
      ramp.bitmap.data[idx + 1] = v
      ramp.bitmap.data[idx + 2] = v
      ramp.bitmap.data[idx + 3] = 255
    })
    const crisp = src.clone().mask({ src: ramp })
    blurred.composite(crisp, 0, 0)
    const jpg = await blurred.getBuffer('image/jpeg', { quality: 84 })
    return `data:image/jpeg;base64,${jpg.toString('base64')}`
  } catch {
    return null
  }
}

// The overlay that finishes the share backdrop: black leaning left, a light
// tint right, and a low fade so the footer stays legible over bright art.
function shareBg(dataUri: string): Node {
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
        'linear-gradient(to right, rgba(1,10,19,0.86) 0%, rgba(1,10,19,0.84) 48%, rgba(1,10,19,0.38) 74%, rgba(1,10,19,0.1) 100%)',
    }),
    el('div', {
      position: 'absolute',
      top: 0,
      left: 0,
      width: W,
      height: H,
      backgroundImage:
        'linear-gradient(to bottom, rgba(1,10,19,0) 72%, rgba(1,10,19,0.7) 100%)',
    }),
  )
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
    case 'tier-list': {
      const tierColors = [C.red, C.gold2, C.blue2, C.gold1, C.grey1]
      return frame(null, [
        el(
          'div',
          { flexDirection: 'column', gap: 18, justifyContent: 'center', flexGrow: 1 },
          eyebrow("New · sort a champion's wardrobe"),
          title('Tier Drop'),
          body(
            "Rank a champion's skins S to D. One board counts for up to eight head-to-head battles' worth of evidence.",
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
          title(`Price Point #${priceCheckPuzzleNumber(puzzleDay())}`, 76),
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
          eyebrow('Rankings · days since last skin'),
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
          eyebrow('Community skin rankings'),
          title('SkinBattle'),
          body(
            'Every League skin, ranked by community battles. Head-to-Head, Tier Drop, and a new puzzle every day.',
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
  const path = join(dir, `og-${card}-${puzzleDay()}.png`)
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

// ─── the share cards ────────────────────────────────────────────────────────
//
// Discord, Reddit and X show an OG card at roughly a third of its size - a
// 1200-wide card renders about 400 wide in a chat - so a card that reads like
// a page reads like nothing. The rule for the two cards below: at most five
// lines of text, the two that matter at 60px or more, nothing under 28px,
// and the ask in the footer rather than a sixth line. Long strings step down
// a size so the fixed 1200×630 keeps its shape.

const stepDown = (
  s: string,
  steps: [max: number, size: number][],
  floor: number,
): number => steps.find(([max]) => s.length <= max)?.[1] ?? floor

// "COMMUNITY RANKING · SETTLED": the context and the verdict's state in one
// line, in the Verdict panel's own tones and words.
const contextLine = (
  label: string,
  confidence: 'confident' | 'provisional' | 'empty',
): Node =>
  text(
    `${label} · ${
      confidence === 'confident'
        ? 'Settled'
        : confidence === 'provisional'
          ? 'Provisional'
          : 'No battles yet'
    }`.toUpperCase(),
    {
      fontFamily: 'Inter',
      fontWeight: 700,
      fontSize: 34,
      letterSpacing: 6,
      color:
        confidence === 'provisional'
          ? C.blue2
          : confidence === 'confident'
            ? C.gold2
            : C.grey1,
    },
  )

const VOTE_CTA = 'Vote now · free · no account needed'

const n = (v: number): string => v.toLocaleString('en-US')

// Per-skin OG card: the dossier as a share - the splash kept vivid, the
// skin's name, where it stands (its champion's #N, #N of all rated skins),
// the verdict's state in the dossier's own words, and the ask. Cached per
// skin per UTC day; the key carries a version so a redesign replaces
// yesterday's cards at once.
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
    const path = join(dir, `og-skin-v3-${skinId}-${puzzleDay()}.png`)
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
      // Same rank, denominator, rounding, voters and rule as the dossier
      // (server/skinpage.ts), so the card can never say a different word or
      // a different "#N of M" than the page it unfurls for.
      const { globalRank, ratedCount, skinVoters } = await import('./ratings')
      const { catalogSkinTotal } = await import('./catalog')
      const { skinAnswerBlock } = await import('../answer')
      const ratedTotal = ratedCount(db)
      const rank = rating ? globalRank(db, rating.rating) : 0
      const confidence = skinAnswerBlock({
        name: skin.name,
        community: rating
          ? {
              rating: Math.round(rating.rating),
              uncertainty: Math.round(rating.uncertainty),
              battles: rating.battles,
              rank,
              voters: skinVoters(db, skinId),
            }
          : null,
        rated: ratedTotal,
        total: catalogSkinTotal(db),
      }).confidence
      // Its place in its own wardrobe - the number a fan actually argues
      // about. Same catalog join and battles > 0 rule as globalRank.
      const championRank = rating
        ? (
            db
              .prepare(
                `SELECT COUNT(*) AS c FROM skin_ratings r
                   JOIN catalog_skins c ON c.id = r.skin_id
                  WHERE c.champion_id = ? AND c.num != 0 AND r.battles > 0 AND r.rating > ?`,
              )
              .get(skin.championId, rating.rating) as { c: number }
          ).c + 1
        : 0
      const standing = rating
        ? `${skin.championName}'s #${championRank} skin · #${n(rank)} of ${n(ratedTotal)} overall`
        : `${/^[aeiou]/i.test(skin.championName) ? 'An' : 'A'} ${skin.championName} skin · no battles yet`
      const detail = rating
        ? `${n(rating.battles)} ${rating.battles === 1 ? 'battle' : 'battles'} · rated ${n(Math.round(rating.rating))} ± ${Math.round(rating.uncertainty)}`
        : 'Be the first to vote on it'

      const bg = await shareBackground(skin.splashUrl)
      const node = frame(
        bg ? shareBg(bg) : null,
        [
          el(
            'div',
            { flexDirection: 'column', gap: 14, justifyContent: 'center', flexGrow: 1, width: 1000 },
            contextLine('Community rating', confidence),
            title(skin.name, stepDown(skin.name, [[16, 84], [24, 70], [34, 56]], 46)),
            text(standing, {
              fontFamily: 'Cinzel',
              fontWeight: 700,
              fontSize: 40,
              color: C.gold1,
              lineHeight: 1.2,
              marginTop: 6,
            }),
            text(detail, {
              fontFamily: 'Inter',
              fontWeight: 500,
              fontSize: 34,
              color: confidence === 'provisional' ? C.blue2 : C.gold2,
            }),
          ),
        ],
        VOTE_CTA,
      )
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

// Ranking-slice OG card - the share that has to make a stranger click: the
// #1 skin's splash kept vivid, the title, a podium in the same medal order
// the share text uses (no Elo numbers - they mean nothing to someone who has
// never seen the site), the verdict's state in its own words, and the ask.
// Cached per slice per UTC day; the key carries a version so a redesign
// replaces yesterday's cards instead of waiting for midnight.
export async function rankingsOgResponse(slice: string): Promise<Response> {
  const { rankingsState } = await import('./rankings')
  const state = await rankingsState(slice)
  if (!state) return new Response('Not found', { status: 404 })

  try {
    const dir = join(DATA_DIR, 'cache')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `og-rankings-v3-${slice}-${puzzleDay()}.png`)
    let png: Buffer
    if (existsSync(path)) {
      png = readFileSync(path)
    } else {
      const top = state.rows.slice(0, 3)
      const bg = top[0] ? await shareBackground(top[0].splashUrl) : null
      const confidence = state.answer.confidence
      const leaderBattles = top[0]?.battles ?? 0
      const after =
        leaderBattles > 0
          ? ` after ${n(leaderBattles)} ${leaderBattles === 1 ? 'battle' : 'battles'}`
          : ''
      const verdictLine =
        confidence === 'provisional'
          ? `Provisional${after} · your vote could decide it`
          : confidence === 'confident'
            ? `Settled${after} · think they got it wrong?`
            : 'No battles yet · be the first to vote'
      // Five lines, big: a long title or a long #1 name wraps, and every
      // wrapped line is height the footer no longer has, so long strings step
      // down; a name that still wraps keeps its numeral on its first line.
      const titleSize = stepDown(state.title, [[18, 76], [26, 62]], 50)
      const leadSize = stepDown(top[0]?.name ?? '', [[16, 70], [24, 60], [32, 50]], 42)
      const podium = (r: (typeof top)[number], i: number) =>
        el(
          'div',
          { alignItems: 'flex-start', gap: 20 },
          text(String(i + 1), {
            fontFamily: 'Cinzel',
            fontWeight: 700,
            fontSize: i === 0 ? leadSize - 8 : 36,
            lineHeight: 1.12,
            color: i === 0 ? C.gold2 : C.gold5,
            width: 56,
            justifyContent: 'flex-end',
          }),
          text(r.name, {
            fontFamily: i === 0 ? 'Cinzel' : 'Inter',
            fontWeight: i === 0 ? 700 : 500,
            fontSize:
              i === 0
                ? leadSize
                : stepDown(r.name, [[30, i === 1 ? 44 : 40]], 34),
            color: i === 0 ? C.gold1 : C.icon,
            lineHeight: 1.12,
          }),
        )
      const node = frame(
        bg ? shareBg(bg) : null,
        [
          el(
            'div',
            { flexDirection: 'column', gap: 12, justifyContent: 'center', flexGrow: 1, width: 1000 },
            contextLine('Community ranking', confidence),
            title(state.title, titleSize),
            ...(top.length > 0
              ? [el('div', { flexDirection: 'column', gap: 6, marginTop: 8 }, ...top.map(podium))]
              : [body('Nothing here has been through a battle yet. Be the first.', 36)]),
            text(verdictLine, {
              fontFamily: 'Inter',
              fontWeight: 500,
              fontSize: 32,
              color: confidence === 'provisional' ? C.blue2 : C.gold2,
              marginTop: 6,
            }),
          ),
        ],
        VOTE_CTA,
      )
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

// The downloadable share image: the sharer's tiers, thumbnails and all, with
// their name and a SKINBATTLE.LOL watermark.
function buildTierShareCard(
  name: string | undefined,
  champ: string,
  rows: { tier: string; skins: { uri: string }[] }[],
): Node {
  return el(
    'div',
    {
      width: SHARE_W,
      height: SHARE_H,
      backgroundColor: C.black,
      flexDirection: 'column',
      fontFamily: 'Inter',
      padding: 44,
    },
    el(
      'div',
      {
        flexDirection: 'column',
        flexGrow: 1,
        border: `2px solid ${C.gold5}`,
        padding: 40,
        gap: 16,
      },
      el(
        'div',
        { flexDirection: 'column', gap: 4 },
        text(name ? `${name}'s tier list` : 'My tier list', {
          fontFamily: 'Cinzel',
          fontWeight: 700,
          fontSize: 54,
          color: C.gold1,
        }),
        text(champ.toUpperCase(), {
          fontFamily: 'Inter',
          fontWeight: 600,
          fontSize: 26,
          letterSpacing: 4,
          color: C.gold2,
        }),
      ),
      el(
        'div',
        { flexDirection: 'column', gap: 10, flexGrow: 1 },
        ...rows.map((r) =>
          el(
            'div',
            { gap: 10, flexGrow: 1, alignItems: 'stretch' },
            el(
              'div',
              {
                width: 84,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: TIER_HEX[r.tier][0],
              },
              text(r.tier, {
                fontFamily: 'Cinzel',
                fontWeight: 700,
                fontSize: 44,
                color: TIER_HEX[r.tier][1],
              }),
            ),
            el(
              'div',
              {
                flexGrow: 1,
                flexWrap: 'wrap',
                gap: 8,
                alignContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.04)',
                padding: 8,
              },
              ...r.skins.map((s) => ({
                type: 'img',
                props: {
                  src: s.uri,
                  width: 76,
                  height: 76,
                  style: { width: 76, height: 76, objectFit: 'cover' },
                },
              })),
            ),
          ),
        ),
      ),
      el(
        'div',
        { justifyContent: 'center', alignItems: 'baseline' },
        text('SKINBATTLE.LOL', {
          fontFamily: 'Cinzel',
          fontWeight: 700,
          fontSize: 32,
          letterSpacing: 8,
          color: C.gold2,
        }),
      ),
    ),
  )
}

// Per-share tier-list image (the sharer's ranking). The encoded payload carries
// the tiers + name; thumbnails are resolved from the catalog. Cached per payload
// per UTC day.
export async function tierShareImageResponse(id: string): Promise<Response> {
  const db = getDb()
  await ensureCatalog(db)
  const { getTierShare } = await import('./tierlist')
  const { getCatalogSkin } = await import('./catalog')
  const payload = getTierShare(db, id)
  if (!payload || !payload.tiers) return new Response('Not found', { status: 404 })
  const data = id

  try {
    const dir = join(DATA_DIR, 'cache')
    mkdirSync(dir, { recursive: true })
    const key = createHash('sha1').update(data).digest('hex').slice(0, 16)
    const path = join(dir, `og-tier-${key}-${puzzleDay()}.png`)
    let png: Buffer
    if (existsSync(path)) {
      png = readFileSync(path)
    } else {
      const order = ['S', 'A', 'B', 'C', 'D'] as const
      let champ = ''
      const rows = await Promise.all(
        order.map(async (t) => {
          const ids = payload.tiers![t] ?? []
          const skins = (
            await Promise.all(
              ids.map(async (id) => {
                const s = getCatalogSkin(db, id)
                if (!s) return null
                if (!champ) champ = s.championName
                const uri = await fetchAsDataUri(s.tileUrl || s.splashUrl)
                return uri ? { uri } : null
              }),
            )
          ).filter((x): x is { uri: string } => x !== null)
          return { tier: t, skins }
        }),
      )
      const node = buildTierShareCard(payload.name, champ, rows)
      const svg = await satori(node as never, {
        width: SHARE_W,
        height: SHARE_H,
        fonts: fonts() as never,
      })
      png = Buffer.from(
        new Resvg(svg, { fitTo: { mode: 'width', value: SHARE_W } }).render().asPng(),
      )
      writeFileSync(path, png)
    }
    return new Response(new Uint8Array(png), {
      headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' },
    })
  } catch (err) {
    console.error('og tier-share render failed:', err)
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
