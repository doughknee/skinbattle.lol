// The skin dossier's <title> is the one line search renders, and ~1,900 of
// them ship. A title that names a skin nobody can place ("Birdio") wastes the
// slot; a title that repeats the champion it already contains ("Elementalist
// Lux (Lux)") reads like a bug. One rule decides both, so it gets a test.

import { describe, expect, it } from 'vitest'
import { championDisplayName, displaySkinName, skinTitleName } from './skinName'

describe('skinTitleName', () => {
  it('leaves a name that already carries its champion alone', () => {
    expect(skinTitleName('Elementalist Lux', 'Lux')).toBe('Elementalist Lux')
    expect(skinTitleName('Battle Boss Blitzcrank', 'Blitzcrank')).toBe(
      'Battle Boss Blitzcrank',
    )
  })

  it('names the champion when the skin name does not', () => {
    // Real catalog entries - 45 skins are named like this.
    expect(skinTitleName('Birdio', 'Galio')).toBe('Birdio (Galio)')
    expect(skinTitleName('Emumu', 'Amumu')).toBe('Emumu (Amumu)')
    expect(skinTitleName('Captain Fortune', 'Miss Fortune')).toBe(
      'Captain Fortune (Miss Fortune)',
    )
    expect(skinTitleName('Samurai Yi', 'Master Yi')).toBe(
      'Samurai Yi (Master Yi)',
    )
  })

  it('is not fooled by the punctuation the roster is full of', () => {
    // Champion names carrying apostrophes, periods and ampersands still match
    // the skin names built from them - otherwise every Kai'Sa and Dr. Mundo
    // skin would carry a redundant suffix.
    for (const championId of ['Kaisa', 'DrMundo', 'Nunu', 'Chogath']) {
      const champion = championDisplayName(championId)
      const skin = `Prestige ${champion}`
      expect(skinTitleName(skin, champion)).toBe(skin)
    }
    // "Nunu & Beelump" is NOT "Nunu & Willump", and must be disambiguated.
    expect(skinTitleName('Nunu & Beelump', 'Nunu & Willump')).toBe(
      'Nunu & Beelump (Nunu & Willump)',
    )
  })

  it('never produces an empty or dangling title', () => {
    for (const [skin, champion] of [
      ['', 'Lux'],
      ['Birdio', ''],
      ['', ''],
    ]) {
      const title = skinTitleName(skin, champion)
      expect(title).not.toMatch(/undefined|null/)
      expect(title.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('displaySkinName', () => {
  it('still renames the base look rather than printing "default"', () => {
    expect(displaySkinName('default', 'Kaisa')).toBe("Classic Kai'Sa")
    expect(displaySkinName('Elementalist Lux', 'Lux')).toBe('Elementalist Lux')
  })
})
