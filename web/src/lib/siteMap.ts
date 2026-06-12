// The site map — the single source of truth for where everything lives.
//
// The navbar, footer, command palette, 404 page, and /sitemap.xml all render
// from this registry. To add a page to the site: create the route file, then
// add one entry here — it shows up in every navigation surface at once.
// Nothing should hand-roll its own list of site links.
//
// The model (see ROUTES.md): three doors, three verbs.
//   Battle = do. Skins = find. Rankings = see. Plus You behind the account
//   button. Leaf content (champion/skin pages, slices) never appears in nav.

import {
  faCoins,
  faCrown,
  faHourglassHalf,
  faHouse,
  faImage,
  faListOl,
  faPalette,
  faRankingStar,
  faScaleUnbalanced,
  faShirt,
  faShuffle,
  faTrophy,
  faUsers,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'

export interface SitePage {
  to: string
  label: string
  // One-line description — shown in nav dropdowns and the command palette.
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
}

export const HOME: SitePage = {
  to: '/',
  label: 'Home',
  blurb: 'The front page.',
  icon: faHouse,
  search: 'start front page',
}

export const PROFILE: SitePage = {
  to: '/profile',
  label: 'Your Mirror',
  blurb: 'The tier list your battles build — plus your votes and account.',
  icon: faScaleUnbalanced,
  search: 'profile account settings my votes mirror tier list taste sign in',
}

export const SITE_SECTIONS: SiteSection[] = [
  {
    to: '/battle',
    label: 'Battle',
    blurb: 'Two skins. Pick one. Every vote builds the rankings.',
    icon: faShuffle,
    // Carries the head-to-head terms too: the palette dedupes the child that
    // points at this same path, so its keywords must live here.
    search: 'play quick battle versus head to head 1v1 swipe endless vote',
    accent: true,
    children: [
      {
        to: '/battle',
        label: 'Head-to-Head',
        blurb: 'Two skins, pick one. Endless — jump straight in.',
        icon: faShuffle,
        search: 'versus quick battle head to head 1v1 swipe endless vs',
        hero: true,
      },
      {
        to: '/battle/splashdle',
        label: 'Splashdle',
        blurb: 'Name the skin from a sliver of its splash.',
        icon: faImage,
        search: 'wordle guess splash daily',
        group: 'Daily challenges',
      },
      {
        to: '/battle/price-check',
        label: 'Price Check',
        blurb: 'Guess what each skin cost in RP.',
        icon: faCoins,
        search: 'rp cost price guess daily',
        group: 'Daily challenges',
      },
      {
        to: '/battle/chroma-vision',
        label: 'Chroma Vision',
        blurb: 'Name the skin from its colors alone.',
        icon: faPalette,
        search: 'colors mosaic hard mode daily',
        group: 'Daily challenges',
      },
      {
        to: '/battle/leaderboards',
        label: 'Leaderboards',
        blurb: 'Streaks, fastest solves, and battle volume.',
        icon: faTrophy,
        search: 'top players streaks ranks community',
        group: 'Community',
      },
    ],
  },
  {
    to: '/skins',
    label: 'Skins',
    blurb: 'The catalog — every skin, every champion, ready to star or ban.',
    icon: faShirt,
    search: 'catalog browse splash art collection',
    children: [
      {
        to: '/skins',
        label: 'All Skins',
        blurb: 'The full catalog — search, sort, and spend your stars and bans.',
        icon: faShirt,
        search: 'catalog browse every skin',
      },
      {
        to: '/champions',
        label: 'By Champion',
        blurb: 'Every champion and their wardrobe — star and ban skin by skin.',
        icon: faUsers,
        search: 'roster champions browse vote wardrobe',
      },
    ],
  },
  {
    to: '/rankings',
    label: 'Rankings',
    blurb: 'The community verdict, sliced every way an argument needs.',
    icon: faRankingStar,
    search: 'best worst top tier list insights',
    children: [
      {
        to: '/rankings/all',
        label: 'The Full Ranking',
        blurb: 'Every skin, one list, settled by battle.',
        icon: faListOl,
        search: 'best skins overall top list',
        hero: true,
      },
      {
        to: '/rankings',
        label: 'Browse the Slices',
        blurb: 'By price tier, skin line, champion, and year.',
        icon: faRankingStar,
        search: 'price tier skin line year champion slice',
        group: 'More ways to settle it',
      },
      {
        to: '/rankings/awards',
        label: 'Awards',
        blurb: 'Most starred, most banned — community superlatives.',
        icon: faCrown,
        search: 'best worst starred banned superlatives awards',
        group: 'More ways to settle it',
      },
      {
        to: '/rankings/drought',
        label: 'Drought Index',
        blurb: "Days since every champion's last skin, ranked.",
        icon: faHourglassHalf,
        search: 'insights days since last skin waiting forgotten',
        group: 'More ways to settle it',
      },
    ],
  },
]

// Flat, deduped list of every navigable page — powers the command palette.
export function allSitePages(): SitePage[] {
  const seen = new Set<string>()
  const out: SitePage[] = []
  for (const p of [HOME, ...SITE_SECTIONS, PROFILE]) {
    if (!seen.has(p.to)) {
      seen.add(p.to)
      out.push(p)
    }
    if ('children' in p) {
      for (const c of (p as SiteSection).children ?? []) {
        if (seen.has(c.to)) continue
        seen.add(c.to)
        out.push(c)
      }
    }
  }
  return out
}

// The curated short list shown before the user types anything.
export function quickNavPages(): SitePage[] {
  return [HOME, ...SITE_SECTIONS, PROFILE]
}

// Public, crawlable paths for /sitemap.xml (profile is personal — excluded).
export function indexablePaths(): string[] {
  return allSitePages()
    .map((p) => p.to)
    .filter((to) => to !== PROFILE.to)
}
