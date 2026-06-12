// The site map — the single source of truth for where everything lives.
//
// The navbar, footer, command palette, 404 page, and /sitemap.xml all render
// from this registry. To add a page to the site: create the route file, then
// add one entry here — it shows up in every navigation surface at once.
// Nothing should hand-roll its own list of site links.

import {
  faCoins,
  faCrown,
  faDice,
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
  faUser,
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
}

export interface SiteSection extends SitePage {
  // Dropdown/footer items. The section entry itself is the landing page.
  children?: SitePage[]
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
  label: 'My Profile',
  blurb: 'Your votes, stats, and account settings.',
  icon: faUser,
  search: 'account settings my votes sign in',
}

export const SITE_SECTIONS: SiteSection[] = [
  {
    to: '/champions',
    label: 'Champions',
    blurb: 'Every champion and their wardrobe — vote skin by skin.',
    icon: faUsers,
    search: 'roster browse vote',
  },
  {
    to: '/skins',
    label: 'Skins',
    blurb: 'The full skin catalog — search, sort, and explore.',
    icon: faShirt,
    search: 'catalog browse splash art',
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
      },
      {
        to: '/rankings',
        label: 'Browse the Slices',
        blurb: 'By price tier, skin line, champion, and year.',
        icon: faRankingStar,
        search: 'price tier skin line year champion slice',
      },
      {
        to: '/awards',
        label: 'Awards',
        blurb: 'Most starred, most banned — community superlatives.',
        icon: faCrown,
        search: 'best worst starred banned superlatives',
      },
      {
        to: '/rankings/drought',
        label: 'Drought Index',
        blurb: "Days since every champion's last skin, ranked.",
        icon: faHourglassHalf,
        search: 'insights days since last skin waiting forgotten',
      },
    ],
  },
  {
    to: '/games',
    label: 'Games',
    blurb: 'Daily challenges for skin connoisseurs.',
    icon: faDice,
    search: 'play daily puzzle hub challenges',
    children: [
      {
        to: '/games/splashdle',
        label: 'Splashdle',
        blurb: 'Name the skin from a sliver of its splash.',
        icon: faImage,
        search: 'wordle guess splash daily',
      },
      {
        to: '/games/price-check',
        label: 'Price Check',
        blurb: 'Guess what each skin cost in RP.',
        icon: faCoins,
        search: 'rp cost price guess daily',
      },
      {
        to: '/games/chroma-vision',
        label: 'Chroma Vision',
        blurb: 'Name the skin from its colors alone.',
        icon: faPalette,
        search: 'colors mosaic hard mode daily',
      },
      {
        to: '/games/quick-battle',
        label: 'Quick Battle',
        blurb: 'Two skins. Pick one. Endless.',
        icon: faShuffle,
        search: 'versus swipe battle endless',
      },
      {
        to: '/games/mirror',
        label: 'The Mirror',
        blurb: 'The tier list your battles build.',
        icon: faScaleUnbalanced,
        search: 'my taste tier list hot takes wardrobe',
      },
      {
        to: '/games/leaderboards',
        label: 'Leaderboards',
        blurb: 'Streaks, fastest solves, and battle volume.',
        icon: faTrophy,
        search: 'top players streaks ranks community',
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
