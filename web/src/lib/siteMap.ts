// The site map - the single source of truth for where everything lives.
//
// The navbar, mobile nav, footer, command palette, 404 page, and /sitemap.xml
// all render from this registry. To add a page to the site: create the route
// file, then add one entry here - it shows up in every navigation surface at
// once. Nothing should hand-roll its own list of site links.
//
// The model (see ROUTES.md): the top nav is a growth instrument, not a filing
// cabinet. Three doors - Play (do), Rankings (see), Mirror (your taste) - plus
// Search and the account avatar on the right. Everything else (Champions,
// search, the legal/utility pages) lives in the footer, which is the full
// sitemap. Leaf content (champion/skin detail pages, slices) never appears.

import {
  faChartLine,
  faCoins,
  faFileContract,
  faHourglassHalf,
  faHouse,
  faImage,
  faLayerGroup,
  faListOl,
  faPalette,
  faRankingStar,
  faRoad,
  faRocket,
  faScaleUnbalanced,
  faShieldHalved,
  faShuffle,
  faTrophy,
  faUser,
  faUsers,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'

export interface SitePage {
  to: string
  // Search params for links that target a tab of a page (/profile?tab=account).
  linkSearch?: Record<string, string>
  label: string
  // One-line description - shown in nav dropdowns and the command palette.
  blurb: string
  icon: IconDefinition
  // Extra match terms for the command palette ("wordle" finds Splashdle).
  search?: string
  // Dropdown presentation: the hero renders as the menu's featured tile;
  // group labels render as eyebrow headings over consecutive runs.
  hero?: boolean
  group?: string
}

export interface SiteSection extends SitePage {
  // Dropdown/footer items. The section entry itself is the landing page.
  children?: SitePage[]
  // The navbar renders this section as the highlighted brand action.
  accent?: boolean
  // Pathname prefix that marks the section active, when its landing page
  // lives deeper than the subtree it owns (Rankings lands on /rankings/all
  // but owns every /rankings/* leaf).
  match?: string
}

export const HOME: SitePage = {
  to: '/',
  label: 'Home',
  blurb: 'The front page.',
  icon: faHouse,
  search: 'start front page',
}

// ─── Individual pages, defined once and reused across nav + footer ──────────

// Play
const HEAD_TO_HEAD: SitePage = {
  to: '/battle',
  label: 'Head-to-Head',
  blurb: 'Two skins, pick one. Endless. Jump straight in.',
  icon: faShuffle,
  search: 'versus quick battle head to head 1v1 swipe endless vs',
  hero: true,
}
const TIER_DROP: SitePage = {
  to: '/battle/tiers',
  label: 'Tier Drop',
  blurb: "Rank a champion's skins S to D - dozens of verdicts in one go.",
  icon: faLayerGroup,
  search: 'tier drop tier list rank s a b c d champion skins drag tierlist',
  group: 'Battles',
}
const SPLASHDLE: SitePage = {
  to: '/battle/splashdle',
  label: 'Splashdle',
  blurb: 'Name the skin from a sliver of its splash.',
  icon: faImage,
  search: 'wordle guess splash daily',
  group: 'Puzzles',
}
const PRICE_POINT: SitePage = {
  to: '/battle/price-point',
  label: 'Price Point',
  blurb: 'Guess what each skin cost in RP.',
  icon: faCoins,
  search: 'rp cost price point check guess daily',
  group: 'Puzzles',
}
const CHROMA_VISION: SitePage = {
  to: '/battle/chroma-vision',
  label: 'Chroma Vision',
  blurb: 'Name the skin from its colors alone.',
  icon: faPalette,
  search: 'colors mosaic hard mode daily',
  group: 'Puzzles',
}

// Rankings
const ALL_SKINS: SitePage = {
  to: '/rankings/all',
  label: 'All skins',
  blurb: 'Every skin, one list - slice it by price, line, champion, year.',
  icon: faListOl,
  search: 'best skins overall top list full ranking all',
}
const DROUGHT: SitePage = {
  to: '/rankings/drought',
  label: 'Drought Index',
  blurb: "Days since every champion's last skin, ranked.",
  icon: faHourglassHalf,
  search: 'insights days since last skin waiting forgotten',
}
const LEADERBOARDS: SitePage = {
  to: '/battle/leaderboards',
  label: 'Leaderboards',
  blurb: 'Streaks, fastest solves, and battle volume.',
  icon: faTrophy,
  search: 'top players streaks ranks community leaderboards',
}
const HOW_RANKINGS_WORK: SitePage = {
  to: '/rankings/elo',
  label: 'How Rankings Work',
  blurb: 'The rating system behind the lists, explained for humans.',
  icon: faChartLine,
  search:
    'elo rating explainer how it works bradley terry calibrating uncertainty mmr math',
}

// Explore (footer)
export const CHAMPIONS: SitePage = {
  to: '/champions',
  label: 'Champions',
  blurb: 'Every champion and their wardrobe, ranked skin by skin.',
  icon: faUsers,
  search:
    'catalog browse champions roster splash art collection wardrobe skins',
}

// Mirror tabs. Account lives in the avatar menu and the footer (not the nav
// dropdown), so the Mirror door stays focused on your taste artifacts.
const YOUR_TIER_LIST: SitePage = {
  to: '/profile',
  label: 'Your tier list',
  blurb: 'The ranking your battles build, plus your contrarian takes.',
  icon: faLayerGroup,
  search: 'mirror tier list taste my ranking stats',
  hero: true,
}
export const ACCOUNT: SitePage = {
  to: '/profile',
  linkSearch: { tab: 'account' },
  label: 'Account',
  blurb: 'Username, avatar, and sign-in settings.',
  icon: faUser,
  search: 'account settings username avatar sign in out profile',
}

// ─── The three doors (navbar) ───────────────────────────────────────────────

export const SITE_SECTIONS: SiteSection[] = [
  {
    to: '/battle',
    label: 'Play',
    blurb: 'Battles and daily puzzles. Jump in.',
    icon: faShuffle,
    // Carries the head-to-head terms too: the palette dedupes the child that
    // points at this same path, so its keywords must live here.
    search:
      'play games quick battle versus head to head 1v1 swipe endless vote tier list puzzles daily',
    accent: true,
    children: [HEAD_TO_HEAD, TIER_DROP, SPLASHDLE, PRICE_POINT, CHROMA_VISION],
  },
  {
    // The section lands on the full ranking - the list IS the product, and its
    // slice bar handles price/line/champion/year discovery in-page. A plain
    // link, no dropdown: the deeper rankings views live in the footer.
    to: '/rankings/all',
    match: '/rankings',
    label: 'Rankings',
    blurb: 'The community verdict, sliced every way an argument needs.',
    icon: faRankingStar,
    search:
      'best worst top tier list insights skins overall price tier skin line year champion slice rankings',
  },
  {
    // The personal door: the tier list your battles build. Account/sign-in
    // stay in the avatar menu. Guest-capable, so even a signed-out visitor has
    // a Mirror (which makes it the sign-up pitch). A plain link, no dropdown -
    // the door and its one child (the tier list) point at the same page.
    to: '/profile',
    label: 'Mirror',
    blurb: 'The tier list your battles build.',
    icon: faScaleUnbalanced,
    search: 'profile mirror tier list taste my ranking stats history you',
  },
]

// ─── Footer columns - the full sitemap, curated by intent ───────────────────
// Rendered by Footer.tsx. The Explore column also gets a Search button (a ⌘K
// action, not a page), appended in the component.

export const FOOTER_COLUMNS: { title: string; pages: SitePage[] }[] = [
  {
    title: 'Play',
    pages: [HEAD_TO_HEAD, TIER_DROP, SPLASHDLE, PRICE_POINT, CHROMA_VISION],
  },
  {
    title: 'Rankings',
    pages: [ALL_SKINS, DROUGHT, LEADERBOARDS, HOW_RANKINGS_WORK],
  },
  { title: 'Explore', pages: [CHAMPIONS] },
  { title: 'Mirror', pages: [YOUR_TIER_LIST, ACCOUNT] },
  // Filled from SECONDARY_PAGES below so the palette and footer never drift.
  { title: 'More', pages: [] },
]

// Secondary pages: real destinations that aren't one of the three doors. They
// live in the footer's "More" column, the command palette, and the sitemap -
// never in the navbar.
export const SECONDARY_PAGES: SitePage[] = [
  {
    to: '/roadmap',
    label: 'Roadmap',
    blurb: 'What is live, what is next, and the milestones that unlock it.',
    icon: faRoad,
    search:
      'roadmap upcoming future plans skin cup hot takes milestones progress eras wardrobe gauntlet',
  },
  {
    to: '/releases',
    label: 'Releases',
    blurb: 'What just shipped, in plain language.',
    icon: faRocket,
    search: 'releases changelog updates news whats new patch notes shipped',
  },
  {
    to: '/privacy',
    label: 'Privacy',
    blurb: 'What the site collects (very little), why, and how to delete it.',
    icon: faShieldHalved,
    search: 'privacy policy data gdpr cookies delete legal',
  },
  {
    to: '/terms',
    label: 'Terms',
    blurb: 'The ground rules for a free fan project.',
    icon: faFileContract,
    search: 'terms of use service legal rules riot disclaimer',
  },
]
FOOTER_COLUMNS[FOOTER_COLUMNS.length - 1].pages = SECONDARY_PAGES

// Flat, deduped list of every navigable page - powers the command palette and
// the sitemap. Includes pages that aren't in the navbar (Champions, the deeper
// rankings views) so Search and crawlers still reach them.
export function allSitePages(): SitePage[] {
  const seen = new Set<string>()
  const out: SitePage[] = []
  const push = (p: SitePage) => {
    if (seen.has(p.to)) return
    seen.add(p.to)
    out.push(p)
  }
  push(HOME)
  for (const s of SITE_SECTIONS) {
    push(s)
    for (const c of s.children ?? []) push(c)
  }
  push(CHAMPIONS)
  for (const p of [ALL_SKINS, DROUGHT, LEADERBOARDS, HOW_RANKINGS_WORK]) {
    push(p)
  }
  for (const p of SECONDARY_PAGES) push(p)
  return out
}

// The curated short list shown before the user types anything. Champions left
// the navbar, so it earns a spot here to stay one keystroke away.
export function quickNavPages(): SitePage[] {
  return [HOME, ...SITE_SECTIONS, CHAMPIONS]
}

// Public, crawlable paths for /sitemap.xml (profile is personal - excluded).
export function indexablePaths(): string[] {
  return allSitePages()
    .map((p) => p.to)
    .filter((to) => to !== '/profile')
}
