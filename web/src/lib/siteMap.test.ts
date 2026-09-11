// Guard for the navigation model in ROUTES.md.
//
// The bug this exists to prevent: the nav drifted off the documented three
// doors (Battle · Skins · Rankings) to Play · Rankings · Mirror, Champions got
// demoted to the footer, and /skins was never built at all - while the sitemap
// went on advertising ~1,900 /skins/$slug URLs whose parent returned 404. None
// of that was caught because nothing checked the registry against either the
// doc or the routes on disk.

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CHAMPIONS,
  SITE_SECTIONS,
  SKIN_CATALOG,
  allSitePages,
  indexablePaths,
} from './siteMap'

describe('the three doors', () => {
  // ROUTES.md: "Three doors, three verbs - Battle (do), Skins (find),
  // Rankings (see)". If this list changes, ROUTES.md changes in the same PR -
  // that is the whole point of the registry being the single source of truth.
  it('is exactly Battle, Skins, Rankings', () => {
    expect(SITE_SECTIONS.map((s) => s.label)).toEqual([
      'Battle',
      'Skins',
      'Rankings',
    ])
  })

  it('keeps the profile/Mirror out of the navbar', () => {
    // It lives behind the account button, not in the nav.
    expect(SITE_SECTIONS.map((s) => s.to)).not.toContain('/profile')
  })

  it('hangs both catalog lenses off the Skins door', () => {
    // One door, two routes. If /champions ever floats free of this door again,
    // the catalog reads as two competing places.
    const skins = SITE_SECTIONS.find((s) => s.label === 'Skins')
    expect(skins?.to).toBe('/skins')
    expect(skins?.children?.map((c) => c.to)).toEqual([
      SKIN_CATALOG.to,
      CHAMPIONS.to,
    ])
  })
})

describe('the registry and the routes agree', () => {
  // Every path the registry advertises has to be served by something. The
  // sitemap is generated from indexablePaths(), so a path with no route is a
  // 404 submitted straight to Google.
  const ROUTES = join(import.meta.dirname, '../routes')

  const routeFileExists = (path: string): boolean => {
    const segments = path.split('/').filter(Boolean)
    // "/" is routes/index.tsx.
    if (segments.length === 0) return true
    const dir = segments.slice(0, -1)
    const leaf = segments[segments.length - 1]
    const listing = (sub: string[]): string[] => {
      try {
        return readdirSync(join(ROUTES, ...sub))
      } catch {
        return []
      }
    }
    const siblings = listing(dir)
    return (
      // battle/price-point.tsx, or the flat spelling battle.price-point.tsx
      siblings.includes(`${leaf}.tsx`) ||
      listing([]).includes(`${[...dir, leaf].join('.')}.tsx`) ||
      // skins/index.tsx
      listing([...dir, leaf]).includes('index.tsx') ||
      // /rankings/all is served by rankings/$slice.tsx
      siblings.some((f) => f.startsWith('$') && f.endsWith('.tsx'))
    )
  }

  it('serves every path in the sitemap', () => {
    const unserved = indexablePaths().filter((p) => !routeFileExists(p))
    expect(unserved).toEqual([])
  })

  it('serves every path in the command palette', () => {
    const unserved = allSitePages()
      .map((p) => p.to)
      .filter((p) => !routeFileExists(p))
    expect(unserved).toEqual([])
  })
})

describe('the command palette reaches the pages the navbar does not', () => {
  it('still lists the Mirror', () => {
    // /profile stopped being a door; without an explicit push in
    // allSitePages() it silently vanishes from search entirely.
    expect(allSitePages().map((p) => p.to)).toContain('/profile')
  })

  it('lists the catalog parent the skin pages hang off', () => {
    expect(indexablePaths()).toContain('/skins')
  })

  it('keeps the personal page out of the sitemap', () => {
    expect(indexablePaths()).not.toContain('/profile')
  })
})
