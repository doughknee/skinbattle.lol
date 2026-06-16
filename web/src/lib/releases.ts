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
    date: '2026-06-16',
    title: 'Daily puzzles now reset at midnight Central',
    highlights: [
      'The daily puzzles, Splashdle, Chroma Vision, and Price Point, now refresh at midnight US Central time instead of midnight UTC. A fresh puzzle lands first thing in the morning for North America instead of mid-afternoon. The countdown on every game points at the new moment, and it follows daylight saving, so midnight always means midnight.',
    ],
    fixes: [],
  },
  {
    date: '2026-06-16',
    title: 'Battles decide the rankings',
    highlights: [
      "Stars and bans are gone. The skins you pick in battle now decide the rankings outright, instead of a separate 'spend your 10 stars and 10 bans' vote running alongside them. One ranking, and every pick you make feeds it.",
    ],
    fixes: [
      'The Awards and My Votes pages retired along with the old voting. Their links now take you straight to the full ranking.',
      'Your battles, your Mirror tier list, and your stats are all untouched.',
    ],
  },
  {
    date: '2026-06-15',
    title: 'Tier Drop: rank any set you want',
    highlights: [
      "Build a tier list for any set you can think of. Pick a champion, a skin line, a release year, a price tier, or a rarity, and sort it from S all the way down to D. Can't decide where to start? Hit Surprise Me for a case-opening style spin that drops you on a random set.",
      'See how everyone else ranked it. A new community page shows the tier lists players are making, filterable by champion, skin line, year, price, or rarity. Tap any one to rank the same set yourself.',
    ],
    fixes: [
      'Tier List is now Tier Drop. Same game, sharper name.',
      "Submitting a board animates straight into your results, your finished board comes back if you've already ranked it, and your 'how you compare to the crowd' stats now sit right on top of it.",
      'The top nav slimmed to three doors, Play, Rankings, and your Mirror, and the footer became a full map of the site, so Champions, search, and the deeper rankings are always a click away.',
      'Fixed the gold community-ranking border getting clipped when you hovered a skin on your board.',
    ],
  },
  {
    date: '2026-06-15',
    title: 'Tier Lists arrive',
    highlights: [
      "Sort a champion's entire wardrobe into S, A, B, C, and D tiers in one sitting, then see how your take stacks up against everyone else's, hot takes and all. One tier list moves the rankings as much as dozens of head-to-head battles. Find it alongside Head-to-Head.",
    ],
    fixes: [
      'Tier list links now unfurl with a proper share card on Discord, Twitter, and Reddit, so sharing a board actually looks like an invitation.',
      'Fixed a crash that could hit when you undid your most recent battle vote.',
    ],
  },
  {
    date: '2026-06-15',
    title: 'Every skin gets its turn',
    highlights: [
      "The arena now spreads battles across the whole roster. Matchmaking gives priority to skins that haven't fought yet, so the rankings fill in across every champion instead of fixating on a popular few, and brand-new skins get worked into the rotation automatically.",
      "Rankings stay alive. A skin's standing can keep shifting over time instead of freezing once it settles, so as more people vote the rankings keep reflecting the community rather than the first handful of votes.",
    ],
    fixes: [],
  },
  {
    date: '2026-06-15',
    title: 'Head-to-Head answers back',
    highlights: [
      "Every Head-to-Head pick now tells you what it did: where that skin sits in the live ranking, how far it just climbed, and how the rest of the room voted on that exact matchup: “you're the first to pick this” or “521 players agree with you.”",
      'A "More ways to play" shelf now lives at the bottom of every game, so you can jump straight between Head-to-Head and the daily puzzles from anywhere.',
      'The daily games show the crowd too: each guess tells you how many other players made the same call for today’s puzzle.',
    ],
    fixes: [
      'Price Check is now Price Point.',
      'You can undo your most recent Head-to-Head pick if you mis-clicked.',
      'Daily games open with a snappier entrance, and the daily card now shows your streak and a live countdown to the next puzzle.',
      'Tidied up the Head-to-Head cards so the only thing to do is pick a side.',
    ],
  },
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
