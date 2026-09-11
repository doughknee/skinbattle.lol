import { describe, expect, it } from 'vitest'
import {
  answerBlock,
  FRESH_UNCERTAINTY,
  isConfident,
  MAX_CONFIDENT_UNCERTAINTY,
  weightedBattlesFor,
  type AnswerInput,
} from './answer'
import { MIN_INDEXABLE_BATTLES } from './seo'
import { START_UNCERTAINTY } from './server/ratings'

const base: AnswerInput = {
  scope: 'Ahri skins',
  leader: { name: 'Elderwood Ahri', rating: 1642, uncertainty: 62, battles: 41 },
  rated: 24,
  total: 24,
}

describe('the threshold', () => {
  it('mirrors the engine constant it is derived from', () => {
    // answer.ts cannot import ratings.ts (node:sqlite), so it duplicates this.
    expect(FRESH_UNCERTAINTY).toBe(START_UNCERTAINTY)
  })

  it('inverts the refit formula uncertainty = START / sqrt(weighted)', () => {
    for (const weighted of [1, 4, 9, 12, 25, 49]) {
      const band = FRESH_UNCERTAINTY / Math.sqrt(weighted)
      expect(weightedBattlesFor(band)).toBe(weighted)
    }
  })

  it('sits well above the indexing threshold rather than reusing it', () => {
    // The whole point of DONI-84: indexing admits a 3-battle page, phrasing
    // must not. A 3-battle skin's band is ~202 (350/sqrt(3), best case, every
    // vote full weight) - comfortably outside the confident band.
    const bestCaseBandAtIndexingFloor =
      FRESH_UNCERTAINTY / Math.sqrt(MIN_INDEXABLE_BATTLES)
    expect(isConfident(bestCaseBandAtIndexingFloor)).toBe(false)
    expect(weightedBattlesFor(MAX_CONFIDENT_UNCERTAINTY)).toBeGreaterThan(
      MIN_INDEXABLE_BATTLES,
    )
  })

  it('draws the line at the band, not the raw battle count', () => {
    expect(isConfident(MAX_CONFIDENT_UNCERTAINTY)).toBe(true)
    expect(isConfident(MAX_CONFIDENT_UNCERTAINTY + 1)).toBe(false)
    expect(isConfident(0)).toBe(false)
    expect(isConfident(null)).toBe(false)
  })
})

describe('answerBlock branches', () => {
  it('is confident when the band is tight', () => {
    const b = answerBlock(base)
    expect(b.confidence).toBe('confident')
    expect(b.answer).toContain('Elderwood Ahri is the highest-rated')
    expect(b.answer).toContain('1,642 Elo')
    expect(b.basis).toContain('41 head-to-head battles')
  })

  it('is provisional at the band a real page actually carries today', () => {
    // The live sample behind DONI-84: 3 battles, +/-140 to +/-350.
    const b = answerBlock({
      ...base,
      leader: { name: 'Foxfire Ahri', rating: 1512, uncertainty: 210, battles: 3 },
      rated: 4,
    })
    expect(b.confidence).toBe('provisional')
    expect(b.answer).toContain('currently rates highest')
    expect(b.answer).toContain('provisional')
    expect(b.basis).toContain('3 head-to-head battles')
  })

  it('is empty when nothing in scope has been battled', () => {
    const b = answerBlock({ ...base, leader: null, rated: 0 })
    expect(b.confidence).toBe('empty')
    expect(b.answer).toContain('No Ahri skins have been through')
    expect(b.basis).toContain('24 skins')
  })

  it('stays grammatical when exactly one thing is rated', () => {
    const b = answerBlock({
      ...base,
      leader: { name: 'Foxfire Ahri', rating: 1500, uncertainty: 350, battles: 1 },
      rated: 1,
    })
    expect(b.answer).toContain('is the only one of the Ahri skins')
    expect(b.basis).toContain('1 head-to-head battle')
    expect(b.basis).not.toContain('1 head-to-head battles')
    expect(b.basis).toContain('1 of 24 skins in this group has battle data')
  })

  it('does not pluralise a single skin in the empty branch', () => {
    const b = answerBlock({ scope: 'Gwen skins', leader: null, rated: 0, total: 1 })
    expect(b.basis).toContain('1 skin in this group')
    expect(b.basis).not.toContain('1 skins')
  })
})

describe('never emits undefined', () => {
  // Templates are the one place a data gap turns into a public sentence, so
  // this sweeps the hostile inputs rather than trusting the happy path.
  const hostile: AnswerInput[] = [
    { scope: '', leader: null, rated: 0, total: 0 },
    { scope: undefined as never, leader: undefined as never, rated: NaN, total: NaN },
    {
      scope: '   ',
      leader: { name: '  ', rating: 1500, uncertainty: 90, battles: 0 },
      rated: 1,
      total: 0,
    },
    {
      scope: 'Ahri skins',
      leader: {
        name: undefined as never,
        rating: undefined as never,
        uncertainty: undefined as never,
        battles: undefined as never,
      },
      rated: 5,
      total: 5,
    },
    {
      scope: 'Ahri skins',
      leader: { name: 'A', rating: NaN, uncertainty: Infinity, battles: -4 },
      rated: -1,
      total: 3,
    },
  ]

  it.each(hostile.map((input, i) => [i, input] as const))(
    'case %i produces clean prose',
    (_i, input) => {
      const b = answerBlock(input)
      for (const s of [b.answer, b.basis]) {
        expect(s).not.toMatch(/undefined|null|NaN|Infinity/)
        expect(s.trim().length).toBeGreaterThan(0)
        // Grammatical enough to paste into a page: ends in a full stop and
        // never collapses to a dangling "the ." from a missing value.
        expect(s.trim()).toMatch(/\.$/)
        expect(s).not.toMatch(/\s{2,}|\s\./)
      }
      expect(['confident', 'provisional', 'empty']).toContain(b.confidence)
    },
  )

  it('is deterministic - same input, same words', () => {
    expect(answerBlock(base)).toEqual(answerBlock(base))
  })
})
