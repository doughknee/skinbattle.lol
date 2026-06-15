// Curated release notes. This file is the single source of truth for the
// /releases page. It is written by hand, on purpose: git history speaks
// engineer, this file speaks player. Writing guide: docs/RELEASE_NOTES.md.

export interface ReleaseEntry {
  // ISO date (UTC) the release went live, e.g. '2026-06-12'.
  date: string
  // One excited, user-facing headline. No jargon, no file names.
  title: string
  // The big wins, most exciting first. Rendered front and center.
  highlights: string[]
  // Small fixes and polish, grouped together. Rendered quietly.
  fixes: string[]
}

// Newest first. The page renders this array top to bottom.
export const RELEASES: ReleaseEntry[] = [
  {
    date: '2026-06-12',
    title: 'New skins now land here the same week Riot ships them',
    highlights: [
      'The catalog now tracks brand-new releases almost in real time. Prices, release dates, and skin lines update within days of a patch, so the newest drops are battle-ready while the hype is still hot.',
      'The Battle tab caught fire. Literally. Watch for the embers.',
    ],
    fixes: [
      'Cleared out phantom "skins" that were really chromas with no splash art of their own.',
      'Restored splash art for a handful of skins that were hiding behind outdated image names.',
      'Dropdown menus now stay lit while you browse them and close when you click anywhere else.',
    ],
  },
  {
    date: '2026-06-11',
    title: 'Chroma Vision, leaderboards, and accounts that keep everything',
    highlights: [
      'Chroma Vision is live: name the skin from its colors alone. The splash starts as a handful of colored blocks and sharpens with every miss. Six guesses. Good luck.',
      'Leaderboards are open: fastest daily solves, longest streaks, and the biggest battle volumes, with your name on them once you sign in.',
      'Creating an account now keeps everything you earned as a guest: your streaks, your battles, your tier list. Nothing resets. Ever.',
      'The whole site reorganized around three doors: Battle, Rankings, and Skins. Everything is now at most two clicks away.',
    ],
    fixes: [
      'Your profile and your Mirror merged into one page, so your tier list, stars, and stats finally live together.',
    ],
  },
  {
    date: '2026-06-11',
    title: 'The games arrive: Splashdle, Head-to-Head, Price Point, and your Mirror',
    highlights: [
      'Splashdle: name the skin from a tiny sliver of its splash art. A fresh puzzle every midnight UTC and a streak to defend.',
      'Head-to-Head: two skins, pick one, repeat forever. Every pick moves the community rankings the instant you click, and the site tells you exactly what your vote just did.',
      'The Mirror: a personal tier list that builds itself from your battles, plus your most contrarian takes and the skin lines you secretly over-love.',
      'Price Point: guess what each skin cost in RP. Five skins a day. Harder than it sounds.',
      'Every skin got a permanent page, the rankings learned to slice by price, skin line, champion, and year, and the Drought Index now ranks every champion by days since their last skin.',
    ],
    fixes: [
      'Signing in is sturdier and your profile shows real data from your first visit.',
      'Cards and buttons answer every click immediately, even on a slow connection.',
    ],
  },
]
