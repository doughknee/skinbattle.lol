// The counts every public page prints, tested against one fixture that has
// every way the numbers went wrong in production on 2026-09-11:
//
//   - the home page said 2,116 "skins to rank" (the Go API's copy, base looks
//     included) against 1,941 "in the catalog" two sections down;
//   - /champions gave Ahri 21 skins, /champions/ahri gave her 20;
//   - /methodology said 1,944 skins had battle data in a catalog of 1,941
//     (seven rating rows for skins a sync had dropped);
//   - /skins listed 1,943 while the rankings counted 1,941 (the two catalogs
//     had synced Community Dragon at different moments).
//
// Every one of those is a relationship between two helpers in catalog.ts and
// ratings.ts. This pins the relationships, not the production numbers.

import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  allCatalogSkins,
  catalogFingerprint,
  catalogSkinTotal,
  championCount,
  championRoster,
  championSkins,
} from './catalog'
import { ratedCount } from './ratings'

function db(): DatabaseSync {
  const d = new DatabaseSync(':memory:')
  d.exec(`CREATE TABLE catalog_skins (id TEXT PRIMARY KEY, champion_id TEXT NOT NULL,
    champion_name TEXT NOT NULL, num INTEGER NOT NULL, name TEXT NOT NULL,
    splash_url TEXT NOT NULL, tile_url TEXT, loadscreen_url TEXT,
    uncentered_splash_url TEXT);
   CREATE TABLE skin_ratings (skin_id TEXT PRIMARY KEY, rating REAL NOT NULL,
    uncertainty REAL NOT NULL, battles INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
    last_battle_at TEXT);`)
  return d
}

const skin = (d: DatabaseSync, champion: string, num: number) =>
  d
    .prepare(
      'INSERT INTO catalog_skins (id, champion_id, champion_name, num, name, splash_url) VALUES (?,?,?,?,?,?)',
    )
    .run(
      `${champion}-${num}`,
      champion,
      champion,
      num,
      num === 0 ? 'default' : `${champion} ${num}`,
      `http://x/${champion}-${num}.jpg`,
    )

const rating = (d: DatabaseSync, id: string, battles = 5) =>
  d
    .prepare(
      'INSERT INTO skin_ratings (skin_id, rating, uncertainty, battles, wins, updated_at) VALUES (?,?,?,?,?,?)',
    )
    .run(id, 1500, 80, battles, 2, '2026-09-11T00:00:00.000Z')

// Three champions: Ahri with a base look and three skins, Lux with a base
// look and one skin, and a Zaahen-style newcomer with only a base look.
function fixture(): DatabaseSync {
  const d = db()
  skin(d, 'Ahri', 0)
  skin(d, 'Ahri', 1)
  skin(d, 'Ahri', 2)
  skin(d, 'Ahri', 3)
  skin(d, 'Lux', 0)
  skin(d, 'Lux', 1)
  skin(d, 'Newcomer', 0)
  // Battle data: two Ahri skins and Lux's one, plus the two kinds of row
  // that must never count - a base look someone placed on a Tier Drop
  // board, and an orphan for a skin the catalog no longer has.
  rating(d, 'Ahri-1')
  rating(d, 'Ahri-2')
  rating(d, 'Lux-1')
  rating(d, 'Ahri-0')
  rating(d, 'gone-7')
  return d
}

describe('one definition of "skin"', () => {
  it('is a catalog row with num != 0, everywhere', () => {
    const d = fixture()
    expect(catalogSkinTotal(d)).toBe(4)
    expect(allCatalogSkins(d)).toHaveLength(4)
    expect(allCatalogSkins(d).every((s) => s.num !== 0)).toBe(true)
  })

  it('counts a champion only when it has a skin to rank', () => {
    const d = fixture()
    expect(championCount(d)).toBe(2)
    expect(championRoster(d).map((r) => r.championId)).toEqual(['Ahri', 'Lux'])
  })
})

describe('the champion directory and the champion page agree', () => {
  // /champions prints roster.skinCount on the card; /champions/$id counts
  // championSkins(). Ahri 21 vs 20 was the two being computed differently.
  it('gives every champion the same count on the card and on the page', () => {
    const d = fixture()
    for (const entry of championRoster(d)) {
      expect(entry.skinCount).toBe(championSkins(d, entry.championId).length)
    }
  })

  it('sums the roster to the catalog total', () => {
    const d = fixture()
    const sum = championRoster(d).reduce((n, r) => n + r.skinCount, 0)
    expect(sum).toBe(catalogSkinTotal(d))
  })

  it('leads each card with the base look', () => {
    const d = fixture()
    const ahri = championRoster(d).find((r) => r.championId === 'Ahri')!
    expect(ahri.splashUrl).toBe('http://x/Ahri-0.jpg')
  })
})

describe('rated + awaiting = total', () => {
  // The relationship /rankings/all prints ("N ranked, M still waiting for a
  // first vote", together the catalog) and the one /methodology can never
  // invert (more skins with battle data than skins).
  it('never counts more rated skins than the catalog has', () => {
    const d = fixture()
    const total = catalogSkinTotal(d)
    const rated = ratedCount(d)
    const awaiting = allCatalogSkins(d).filter(
      (s) =>
        !d
          .prepare('SELECT 1 FROM skin_ratings WHERE skin_id = ? AND battles > 0')
          .get(s.id),
    ).length
    expect(rated).toBe(3)
    expect(rated).toBeLessThanOrEqual(total)
    expect(rated + awaiting).toBe(total)
  })

  it('ignores the orphan and the rated base look', () => {
    const d = fixture()
    // Five rating rows exist; only three describe a skin anyone can open.
    expect(
      (d.prepare('SELECT COUNT(*) AS c FROM skin_ratings').get() as { c: number }).c,
    ).toBe(5)
    expect(ratedCount(d)).toBe(3)
  })
})

describe('the catalog re-imports when Community Dragon changes', () => {
  // The bug: both catalogs keyed their re-import on the Data Dragon version,
  // while the skin list comes from Community Dragon, which updates on its own
  // clock. Production ran a patch behind on two skins. The fingerprint is
  // what ensureCatalog now compares.
  const champions = { Ahri: { id: 'Ahri', key: '103', name: 'Ahri' } }
  const skins = {
    '103000': { id: 103000, isBase: true, name: 'Ahri', splashPath: null, uncenteredSplashPath: null, tilePath: null, loadScreenPath: null },
    '103001': { id: 103001, isBase: false, name: 'Dynasty Ahri', splashPath: null, uncenteredSplashPath: null, tilePath: null, loadScreenPath: null },
  }

  it('is stable for the same upstream content', () => {
    expect(catalogFingerprint(champions, skins)).toBe(
      catalogFingerprint(champions, { ...skins }),
    )
  })

  it('changes when a skin is added', () => {
    const more = {
      ...skins,
      '103090': { ...skins['103001'], id: 103090, name: 'Risen Legend Ahri' },
    }
    expect(catalogFingerprint(champions, more)).not.toBe(
      catalogFingerprint(champions, skins),
    )
  })

  it('changes when a skin is renamed', () => {
    const renamed = {
      ...skins,
      '103001': { ...skins['103001'], name: 'Dynasty Ahri (2026)' },
    }
    expect(catalogFingerprint(champions, renamed)).not.toBe(
      catalogFingerprint(champions, skins),
    )
  })

  it('ignores skins whose champion Data Dragon does not list, like the import does', () => {
    const stray = {
      ...skins,
      '999001': { ...skins['103001'], id: 999001, name: 'Unreleased' },
    }
    expect(catalogFingerprint(champions, stray)).toBe(
      catalogFingerprint(champions, skins),
    )
  })
})
