import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { PALETTE, SEMANTIC, GLOW_RGB, GOLD_HOVER } from './brand'

// Drift guard for the brand palette. brand.ts is canonical; the two files
// below carry literal copies because they can't import TS at runtime (Tailwind
// needs literal hex in the @theme block; the Logto CSS is injected into a
// separate self-hosted instance). If any value here drifts from brand.ts, this
// test fails — so the palette stays single-sourced in practice.

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), 'utf8')

const globalsCss = read('../styles/globals.css')
const logtoCss = read('../../../logto-signin-custom.css')

describe('globals.css @theme matches brand.ts', () => {
  for (const [name, hex] of Object.entries(PALETTE)) {
    it(`--color-${name} = ${hex}`, () => {
      expect(globalsCss).toContain(`--color-${name}: ${hex};`)
    })
  }
})

describe('globals.css semantic tokens match brand.ts', () => {
  for (const [name, hex] of Object.entries(SEMANTIC)) {
    it(`--color-${name} = ${hex}`, () => {
      expect(globalsCss).toContain(`--color-${name}: ${hex};`)
    })
  }
})

describe('logto-signin-custom.css matches brand.ts', () => {
  // Each Logto semantic var maps to one brand value. Keeping this table here
  // (rather than scattered in the CSS) means a palette change surfaces as a
  // single failing assertion pointing at the var that drifted.
  const HEX: Record<string, string> = {
    'bg-body': PALETTE.gradientTop,
    'bg-body-base': PALETTE.gradientTop,
    'bg-body-overlay': PALETTE.blue7,
    'bg-float': PALETTE.blue7,
    'bg-float-base': PALETTE.blue6,
    'bg-float-overlay': PALETTE.blue5,
    'bg-layer-1': PALETTE.blue6,
    'bg-layer-2': PALETTE.blue5,
    'bg-toast': PALETTE['grey-cool'],
    'bg-state-unselected': PALETTE.grey3,
    'bg-state-disabled': PALETTE.grey3,
    'brand-30': PALETTE.gold6,
    'brand-40': PALETTE.gold5,
    'brand-50': PALETTE.gold4,
    'brand-60': PALETTE.gold2,
    'brand-70': PALETTE.gold1,
    'brand-default': PALETTE.gold2,
    'brand-hover': GOLD_HOVER,
    'brand-pressed': PALETTE.gold4,
    'brand-loading': PALETTE.gold5,
    'type-primary': PALETTE.gold1,
    'type-secondary': PALETTE.grey1,
    'type-disabled': PALETTE['grey1-5'],
    'type-link': PALETTE.gold2,
    'line-border': PALETTE.gold6,
  }

  for (const [name, hex] of Object.entries(HEX)) {
    it(`--color-${name} = ${hex}`, () => {
      expect(logtoCss).toContain(`--color-${name}: ${hex} !important;`)
    })
  }

  // The gold glow is deduped behind the file's own --sb-glow custom property,
  // which must hold GLOW_RGB; the overlay vars then reference it.
  it('--sb-glow holds GLOW_RGB', () => {
    expect(logtoCss).toContain(`--sb-glow: ${GLOW_RGB};`)
  })
  const GLOW: Record<string, string> = {
    'line-divider': '0.18',
    'overlay-brand-hover': '0.12',
    'overlay-brand-focused': '0.16',
    'overlay-brand-pressed': '0.20',
  }
  for (const [name, alpha] of Object.entries(GLOW)) {
    it(`--color-${name} = rgba glow @ ${alpha}`, () => {
      expect(logtoCss).toContain(
        `--color-${name}: rgba(var(--sb-glow), ${alpha}) !important;`,
      )
    })
  }
})

describe('glow tracks gold2', () => {
  it('GLOW_RGB is gold2 as an rgb triplet', () => {
    const hex = PALETTE.gold2.replace('#', '')
    const rgb = [0, 2, 4]
      .map((i) => parseInt(hex.slice(i, i + 2), 16))
      .join(', ')
    expect(rgb).toBe(GLOW_RGB)
  })
})
