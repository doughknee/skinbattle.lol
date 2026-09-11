// The participation loop's shared vocabulary (client-safe): what a ranking's
// verdict state is called on a button, what a share says, where a share link
// points, and which battle counts earn a word of reinforcement. Every surface
// that asks a visitor to help settle a ranking - the champion page, the
// dossier, the ranking slices, the battle page, the /settle hub - reads from
// here, so they all make the same kind of ask in the same voice.
// docs/participation-loop.md is the design record.

import type { AnswerConfidence } from './answer'

export type RankingState = 'settled' | 'provisional' | 'empty'

// answer.ts calls the settled state 'confident'. On a button, in a share and
// in an event property it is 'settled' - the word the Verdict panel prints.
export const rankingStateOf = (c: AnswerConfidence): RankingState =>
  c === 'confident' ? 'settled' : c

// ─── the ask ────────────────────────────────────────────────────────────────

// The CTA on a ranking surface, by the verdict's own state. Never a number of
// votes needed: the model publishes a band and a head count (answer.ts), not a
// countdown, and a settled ranking is invited to be argued with, not sealed.
export function settleCta(
  state: RankingState,
  name: string,
): { label: string; hint: string } {
  switch (state) {
    case 'provisional':
      return {
        label: `Help settle ${name}'s ranking`,
        hint: 'The top of this ranking is still provisional. Your battles add evidence to the community ranking.',
      }
    case 'settled':
      return {
        label: `Battle ${name} skins`,
        hint: 'Think the community got it wrong? Every battle still counts, and the ranking keeps listening.',
      }
    default:
      return {
        label: `Battle ${name} skins`,
        hint: `No ${name} skin has been through a battle yet. Yours would be the first.`,
      }
  }
}

// ─── the share ──────────────────────────────────────────────────────────────

export type ShareMedium = 'copy' | 'native'

// Share attribution rides on the canonical page URL as ordinary campaign
// parameters, which PostHog reads on arrival without any code. `native` is the
// Web Share API: the sheet never says which app it handed the link to, so the
// medium stays honest at "native" rather than guessing a platform.
export const SHARE_SOURCE = 'share'
export const SHARE_CAMPAIGN = 'ranking'

export function shareUrl(origin: string, path: string, medium: ShareMedium): string {
  const q = new URLSearchParams({
    utm_source: SHARE_SOURCE,
    utm_medium: medium,
    utm_campaign: SHARE_CAMPAIGN,
  })
  return `${origin}${path}?${q}`
}

// The share text is built from the live rows the page just rendered, so it
// can never name a winner the page does not show - and a provisional ranking
// says so in the share, the same way the page does. Without `url` the last
// line is the bare call to action: the Web Share sheet carries the link in
// its own field, and targets that merge the two would otherwise print it
// twice.
export function rankingShareText(opts: {
  title: string // "Ahri", "975 RP skins", "League of Legends skins"
  top: string[] // the rows the page shows, best first; sliced to three here
  state: RankingState
  url?: string
}): string {
  const lines = [`${opts.title} · SkinBattle community ranking`]
  const top = opts.top.slice(0, 3)
  top.forEach((name, i) => lines.push(`#${i + 1} ${name}`))
  const cta =
    opts.state === 'provisional'
      ? ["Provisional: the top spot isn't settled yet.", 'Help settle it']
      : opts.state === 'settled'
        ? ['Settled by community battles.', 'Think they got it wrong?']
        : ['No battles yet.', 'Be the first to rank it']
  lines.push(cta[0])
  lines.push(opts.url ? `${cta[1]}: ${opts.url}` : cta[1])
  return lines.join('\n')
}

// ─── the arrival ────────────────────────────────────────────────────────────

export type PageType =
  | 'home'
  | 'champion'
  | 'skin'
  | 'ranking-slice'
  | 'battle'
  | 'settle'
  | 'other'

// The coarse landing-page bucket the funnel breaks down by. Same buckets the
// voter-funnel queries use, minus the 404 heuristic (a 404 lands on the
// notFoundComponent, which fires nothing).
export function pageTypeOf(pathname: string): PageType {
  if (pathname === '/') return 'home'
  if (pathname.startsWith('/champions/')) return 'champion'
  if (pathname.startsWith('/skins/')) return 'skin'
  if (pathname.startsWith('/rankings/')) return 'ranking-slice'
  if (pathname === '/settle') return 'settle'
  if (pathname === '/battle' || pathname.startsWith('/battle/')) return 'battle'
  return 'other'
}

// The champion a path is about, lowercased: /champions/ahri and
// /rankings/champion-ahri both name Ahri; anything else names nobody.
export function championOfPath(pathname: string): string | null {
  const m =
    /^\/champions\/([a-z0-9]+)\/?$/i.exec(pathname) ??
    /^\/rankings\/champion-([a-z0-9]+)\/?$/i.exec(pathname)
  return m ? m[1].toLowerCase() : null
}

export interface ShareReferral {
  medium: string
  campaign: string | null
}

// A visit that arrived through one of our own share links, or null. Only
// utm_source=share counts - a ChatGPT or newsletter utm is a different
// channel and is left to PostHog's own attribution.
export function parseShareReferral(search: string): ShareReferral | null {
  const q = new URLSearchParams(search)
  if (q.get('utm_source') !== SHARE_SOURCE) return null
  return { medium: q.get('utm_medium') ?? 'unknown', campaign: q.get('utm_campaign') }
}

// The same query string with every utm_* parameter removed, '' when nothing
// is left. Applied to the address bar after the referral is recorded, so the
// parameters never ride into a later navigation or a re-share.
export function stripUtm(search: string): string {
  const q = new URLSearchParams(search)
  for (const key of [...q.keys()]) if (key.startsWith('utm_')) q.delete(key)
  const s = q.toString()
  return s ? `?${s}` : ''
}

// ─── the payoff cadence ─────────────────────────────────────────────────────

// Which battle counts in one visit earn a line of reinforcement: the first
// (it landed), the third and fifth (it is adding up), then every fifth so the
// strip refreshes on the round numbers and never nags in between.
export const isMilestone = (n: number): boolean =>
  n === 1 || n === 3 || (n >= 5 && n % 5 === 0)

// Battles fought in this browser session, across pages - so a ranking view
// after a battle can say so on its event. sessionStorage: it ends with the
// tab, which is what "this session" means to a visitor. Never load-bearing:
// storage that is disabled just reads as zero.
const SESSION_KEY = 'sb:session-battles'

export function readSessionBattles(): number {
  try {
    const n = Number(sessionStorage.getItem(SESSION_KEY))
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

export function bumpSessionBattles(): number {
  const next = readSessionBattles() + 1
  try {
    sessionStorage.setItem(SESSION_KEY, String(next))
  } catch {
    /* storage disabled: the count just doesn't persist */
  }
  return next
}
