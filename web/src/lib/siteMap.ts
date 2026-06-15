// The site map - the single source of truth for where everything lives.
//
// The navbar, footer, command palette, 404 page, and /sitemap.xml all render
// from this registry. To add a page to the site: create the route file, then
// add one entry here - it shows up in every navigation surface at once.
// Nothing should hand-roll its own list of site links.
//
// The model (see ROUTES.md): three doors, three verbs.
//   Battle = do. Champions = find. Rankings = see. Plus You behind the account
//   button. Leaf content (champion/skin detail pages, slices) never appears in
//   nav.

import {
  faChartLine,
  faCheckToSlot,
  faCoins,
  faCrown,
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
  // Search params for links that target a tab of a page (/profile?tab=votes).
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

export const PROFILE: SitePage = {
  to: '/profile',
  label: 'Your Mirror',
  blurb: 'The tier list your battles build, plus your votes and account.',
  icon: faScaleUnbalanced,
  search: 'profile account settings my votes mirror tier list taste sign in',
}

// The profile's tabs, for surfaces that link straight into them (the
// footer's You column). Not part of allSitePages - they share /profile.
export const PROFILE_PAGES: SitePage[] = [
  PROFILE,
  {
    to: '/profile',
    linkSearch: { tab: 'votes' },
    label: 'My Votes',
    blurb: 'Your stars and bans, in one place.',
    icon: faCheckToSlot,
  },
  {
    to: '/profile',
    linkSearch: { tab: 'account' },
    label: 'Account',
    blurb: 'Username, avatar, and sign-in settings.',
    icon: faUser,
  },
]

export const SITE_SECTIONS: SiteSection[] = [
  {
    to: '/battle',
    label: 'Battle',
    blurb: 'Two skins. Pick one. Every vote builds the rankings.',
    icon: faShuffle,
    // Carries the head-to-head terms too: the palette dedupes the child that
    // points at this same path, so its keywords must live here.
    search:
      'play quick battle versus head to head 1v1 swipe endless vote tier list',
    accent: true,
    children: [
      {
        to: '/battle',
        label: 'Head-to-Head',
        blurb: 'Two skins, pick one. Endless. Jump straight in.',
        icon: faShuffle,
        search: 'versus quick battle head to head 1v1 swipe endless vs',
        hero: true,
      },
      {
        to: '/battle/tiers',
        label: 'Tier Drop',
        blurb: "Rank a champion's skins S to D - dozens of verdicts in one go.",
        icon: faLayerGroup,
        search: 'tier drop tier list rank s a b c d champion skins drag tierlist',
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
        to: '/battle/price-point',
        label: 'Price Point',
        blurb: 'Guess what each skin cost in RP.',
        icon: faCoins,
        search: 'rp cost price point check guess daily',
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
    // The section lands on the full ranking - the list IS the product, and
    // its slice bar handles price/line/champion/year discovery in-page
    // (the old slice hub redirects here).
    to: '/rankings/all',
    match: '/rankings',
    label: 'Rankings',
    blurb: 'The community verdict, sliced every way an argument needs.',
    icon: faRankingStar,
    search:
      'best worst top tier list insights skins overall price tier skin line year champion slice',
    children: [
      {
        to: '/rankings/all',
        label: 'The Full Ranking',
        blurb: 'Every skin, one list - slice it by price, line, champion, year.',
        icon: faListOl,
        search: 'best skins overall top list',
        hero: true,
      },
      {
        to: '/rankings/awards',
        label: 'Awards',
        blurb: 'Most starred, most banned: community superlatives.',
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
  {
    // The catalog door. Browsing by champion is the most natural axis for a
    // League audience; dive into any wardrobe to star or ban skin by skin. A
    // plain link, no dropdown - there's one way in, the roster.
    to: '/champions',
    label: 'Champions',
    blurb: 'Every champion and their wardrobe. Star and ban skin by skin.',
    icon: faUsers,
    search:
      'catalog browse champions roster splash art collection wardrobe skins',
  },
]

// Secondary pages: real destinations that aren't one of the three doors.
// They live in the footer, the command palette, and the sitemap - never in
// the navbar (the doors stay three).
export const SECONDARY_PAGES: SitePage[] = [
  {
    to: '/roadmap',
    label: 'Roadmap',
    blurb: 'What is live, what is next, and the milestones that unlock it.',
    icon: faRoad,
    search: 'roadmap upcoming future plans skin cup hot takes milestones progress eras',
  },
  {
    to: '/releases',
    label: 'Releases',
    blurb: 'What just shipped, in plain language.',
    icon: faRocket,
    search: 'releases changelog updates news whats new patch notes shipped',
  },
  {
    to: '/rankings/elo',
    label: 'How Rankings Work',
    blurb: 'The rating system behind the lists, explained for humans.',
    icon: faChartLine,
    search: 'elo rating explainer how it works bradley terry calibrating uncertainty mmr math',
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

// Flat, deduped list of every navigable page - powers the command palette.
export function allSitePages(): SitePage[] {
  const seen = new Set<string>()
  const out: SitePage[] = []
  for (const p of [HOME, ...SITE_SECTIONS, PROFILE, ...SECONDARY_PAGES]) {
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

// Public, crawlable paths for /sitemap.xml (profile is personal - excluded).
export function indexablePaths(): string[] {
  return allSitePages()
    .map((p) => p.to)
    .filter((to) => to !== PROFILE.to)
}
