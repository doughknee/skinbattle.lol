// The canonical brand palette — the single source of truth for every brand
// color on the site.
//
// Most code should NOT import from here directly: in the app, reference the
// Tailwind tokens (`text-gold2`, `bg-blue7`, …) which are defined from these
// same values in styles/globals.css. This file exists because two consumers
// cannot read CSS custom properties at runtime and must carry literal copies:
//
//   1. lib/games/server/og.ts — renders OG cards via satori/resvg outside the
//      browser, with no CSS. It imports PALETTE/OG_RED from here directly, so
//      it is a true single source (no copy).
//   2. styles/globals.css `@theme` and the root-level logto-signin-custom.css
//      (injected into a separate self-hosted Logto instance) — both need
//      literal hex. They keep their own copies, and brand.test.ts asserts
//      those copies match the values below, so any drift fails the test suite.
//
// PALETTE keys are exactly the `--color-<key>` suffixes used in globals.css, so
// the drift guard can map them one-to-one.

export const PALETTE = {
  subText: '#9f9b8d',
  titleText: '#978351',

  gradientTop: '#030912',
  gradientBottom: '#1a3243',

  icon: '#c9bf96',
  iconActive: '#eee7d4',

  // Golds
  gold1: '#f0e6d2',
  gold2: '#c8aa6e',
  gold3: '#c8aa6e',
  gold4: '#c8983c',
  gold5: '#785a28',
  gold6: '#463714',
  gold7: '#32281e',

  // Blues
  blue1: '#cdfafa',
  blue2: '#0ac8b9',
  blue3: '#0397ab',
  blue4: '#005a82',
  blue5: '#0a323c',
  blue6: '#091428',
  blue7: '#0a1428',

  // Greys
  grey1: '#a09b8c',
  'grey1-5': '#5b5a56',
  grey2: '#3c3c41',
  grey3: '#1e2328',
  'grey-cool': '#1e282d',
  'hextech-black': '#010a13',
} as const

export type PaletteToken = keyof typeof PALETTE

// gold2 expressed as an RGB triplet, for the rgba() glows that need an alpha
// channel (the signature gold bloom). Item 3 builds the --shadow-glow tokens
// on this; the Logto CSS uses it for its divider/overlay rgbas. brand.test.ts
// asserts this stays in lockstep with gold2.
export const GLOW_RGB = '200, 170, 110'

// A lighter gold used only by the Logto sign-in button's hover state. Lives
// here so it isn't an orphaned literal in logto-signin-custom.css; it has no
// Tailwind token because nothing else on the site uses it.
export const GOLD_HOVER = '#d9bb80'

// Semantic state colors. The hextech palette has no red or green, so these are
// the one sanctioned off-palette hue family — defined once here and mirrored as
// `--color-danger*` / `--color-success` tokens in globals.css (the drift guard
// asserts the match). Keys are the `--color-<key>` suffixes used there.
export const SEMANTIC = {
  danger: '#fca5a5', // danger text / icon
  'danger-border': '#f87171', // danger outlines & borders
  'danger-surface': '#450a0a', // danger fills (tinted with /opacity at use)
  success: '#047857', // correct / success fills
  'success-border': '#34d399', // success outlines & borders
} as const

export type SemanticToken = keyof typeof SEMANTIC

// The OG cards render outside the browser and can't read the danger token, so
// they reference the same value here directly.
export const OG_RED = SEMANTIC.danger
