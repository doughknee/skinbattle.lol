import { describe, expect, it } from 'vitest'
import {
  answerBlock,
  FRESH_UNCERTAINTY,
  hasEnoughVoters,
  isConfident,
  MAX_CONFIDENT_UNCERTAINTY,
  MIN_CONFIDENT_VOTERS,
  VOTER_SKIN_CAP,
  skinAnswerBlock,
  weightedBattlesFor,
  type AnswerInput,
  type SkinAnswerInput,
} from './answer'
import { MIN_INDEXABLE_BATTLES } from './seo'
import { BATTLE_VOTER_SKIN_CAP, START_UNCERTAINTY } from './server/ratings'

const crowd = { members: 5, guests: 8 }

const base: AnswerInput = {
  scope: 'Ahri skins',
  leader: {
    name: 'Elderwood Ahri',
    rating: 1642,
    uncertainty: 62,
    battles: 41,
    voters: crowd,
  },
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

describe('the voter floor', () => {
  it('mirrors the anti-farm cap it is derived from', () => {
    // Same node:sqlite problem as FRESH_UNCERTAINTY: answer.ts ships to the
    // browser and cannot import ratings.ts, so it duplicates the constant.
    expect(VOTER_SKIN_CAP).toBe(BATTLE_VOTER_SKIN_CAP)
  })

  it('is the smallest crowd the confident band could have come from', () => {
    // The refit caps one voter's weighted pull on a single skin at the cap, so
    // MIN_CONFIDENT_VOTERS - 1 people cannot between them supply the weighted
    // battles a +/-100 band claims. Derivation, not a chosen number.
    const needed = weightedBattlesFor(MAX_CONFIDENT_UNCERTAINTY)
    expect((MIN_CONFIDENT_VOTERS - 1) * VOTER_SKIN_CAP).toBeLessThan(needed)
    expect(MIN_CONFIDENT_VOTERS * VOTER_SKIN_CAP).toBeGreaterThanOrEqual(needed)
  })

  it('counts a member whole and a signed-out cookie as half', () => {
    expect(hasEnoughVoters({ members: MIN_CONFIDENT_VOTERS, guests: 0 })).toBe(true)
    expect(hasEnoughVoters({ members: MIN_CONFIDENT_VOTERS - 1, guests: 0 })).toBe(
      false,
    )
    expect(hasEnoughVoters({ members: 0, guests: MIN_CONFIDENT_VOTERS * 2 })).toBe(
      true,
    )
    expect(
      hasEnoughVoters({ members: 0, guests: MIN_CONFIDENT_VOTERS * 2 - 1 }),
    ).toBe(false)
    // Mixed: one member plus enough cookies to make up the rest.
    expect(hasEnoughVoters({ members: 1, guests: 4 })).toBe(true)
  })

  it('treats missing or broken counts as nobody', () => {
    expect(hasEnoughVoters(null)).toBe(false)
    expect(hasEnoughVoters(undefined)).toBe(false)
    expect(hasEnoughVoters({ members: NaN as never, guests: 99 })).toBe(true)
    expect(hasEnoughVoters({ members: 0, guests: 0 })).toBe(false)
  })

  it('is a separate bar from the band, not a second confidence scale', () => {
    // One vocabulary: both failures read "provisional". DONI-86 retired the
    // competing "solid"/"settling in" wording and nothing here brings it back.
    const wideBandBigCrowd = answerBlock({
      ...base,
      leader: { ...base.leader!, uncertainty: 210 },
    })
    const tightBandNoCrowd = answerBlock({
      ...base,
      leader: { ...base.leader!, voters: { members: 1, guests: 1 } },
    })
    expect(wideBandBigCrowd.confidence).toBe('provisional')
    expect(tightBandNoCrowd.confidence).toBe('provisional')
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
      leader: {
        name: 'Foxfire Ahri',
        rating: 1512,
        uncertainty: 210,
        battles: 3,
        voters: { members: 0, guests: 3 },
      },
      rated: 4,
    })
    expect(b.confidence).toBe('provisional')
    expect(b.answer).toContain('currently rates highest')
    expect(b.answer).toContain('provisional')
    expect(b.basis).toContain('3 head-to-head battles')
  })

  it('holds the band but not the crowd: settled needs both', () => {
    // The DONI-94 case: a tight band that one person produced. Same band, same
    // Elo, different verdict - and the sentence says which bar it missed.
    const b = answerBlock({
      ...base,
      leader: { ...base.leader!, voters: { members: 1, guests: 0 } },
    })
    expect(b.confidence).toBe('provisional')
    expect(b.answer).toContain('too few people have voted')
    expect(b.answer).not.toContain('is the highest-rated')
    expect(b.basis).toContain('1 voter')
    expect(b.basis).not.toContain('1 voters')
    expect(b.basis).toContain(`${MIN_CONFIDENT_VOTERS} separate voters`)
    expect(b.basis).toContain('half a person')
  })

  it('names the band, not the crowd, when both bars are missed', () => {
    const b = answerBlock({
      ...base,
      leader: {
        ...base.leader!,
        uncertainty: 210,
        voters: { members: 1, guests: 0 },
      },
    })
    expect(b.answer).toContain('that placing is provisional')
    expect(b.answer).not.toContain('too few people')
    // ...but the stated rule still carries both halves, or the page would
    // publish a bar it no longer uses.
    expect(b.basis).toContain(`${MIN_CONFIDENT_VOTERS} separate voters`)
  })

  it('says how many people are behind a settled claim', () => {
    const b = answerBlock(base)
    expect(b.confidence).toBe('confident')
    expect(b.basis).toContain('from 13 voters')
  })

  it('never prints a zero head count', () => {
    const b = answerBlock({
      ...base,
      leader: { ...base.leader!, voters: { members: 0, guests: 0 } },
    })
    expect(b.basis).not.toContain('0 voters')
    expect(b.basis).not.toContain('from ')
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
      leader: {
        name: 'Foxfire Ahri',
        rating: 1500,
        uncertainty: 350,
        battles: 1,
        voters: { members: 1, guests: 0 },
      },
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
      leader: {
        name: '  ',
        rating: 1500,
        uncertainty: 90,
        battles: 0,
        voters: undefined as never,
      },
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
        voters: undefined as never,
      },
      rated: 5,
      total: 5,
    },
    {
      scope: 'Ahri skins',
      leader: {
        name: 'A',
        rating: NaN,
        uncertainty: Infinity,
        battles: -4,
        voters: { members: -2, guests: NaN as never },
      },
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

// ─── the dossier sentence ───────────────────────────────────────────────────

const dossier: SkinAnswerInput = {
  name: 'Elderwood Ahri',
  community: {
    rating: 1642,
    uncertainty: 62,
    battles: 41,
    rank: 3,
    voters: crowd,
  },
  rated: 1904,
  total: 1943,
}

describe('skinAnswerBlock', () => {
  it('answers about the skin the page is named after, not a leader', () => {
    const b = skinAnswerBlock(dossier)
    expect(b.answer).toContain('Elderwood Ahri rates 1,642 Elo')
    expect(b.answer).toContain('#3 of 1,904 ranked skins')
    // The dossier never claims a "best" it has not measured.
    expect(b.answer).not.toMatch(/highest-rated|best/)
  })

  it('is settled only when the band AND the crowd clear the same two bars', () => {
    expect(skinAnswerBlock(dossier).confidence).toBe('confident')
    // Band blown, crowd fine.
    expect(
      skinAnswerBlock({
        ...dossier,
        community: {
          ...dossier.community!,
          uncertainty: MAX_CONFIDENT_UNCERTAINTY + 1,
        },
      }).confidence,
    ).toBe('provisional')
    // Band fine, crowd too small - the case a single afternoon produces.
    expect(
      skinAnswerBlock({
        ...dossier,
        community: { ...dossier.community!, voters: { members: 1, guests: 1 } },
      }).confidence,
    ).toBe('provisional')
  })

  it('names which bar it missed, and quotes the same rule as a ranking', () => {
    const wideBand = skinAnswerBlock({
      ...dossier,
      community: { ...dossier.community!, uncertainty: 240 },
    })
    expect(wideBand.answer).toContain('at ±240 that placing is provisional')

    const thinCrowd = skinAnswerBlock({
      ...dossier,
      community: { ...dossier.community!, voters: { members: 1, guests: 0 } },
    })
    expect(thinCrowd.answer).toContain('too few people have voted')

    // One rule, one place. Both branches cite it, and so does answerBlock.
    const rule = `±${MAX_CONFIDENT_UNCERTAINTY} Elo`
    for (const b of [wideBand, thinCrowd]) {
      expect(b.basis).toContain(rule)
      expect(b.basis).toContain(`${MIN_CONFIDENT_VOTERS} separate voters`)
    }
  })

  it('says a never-battled skin has no rating rather than inventing one', () => {
    const b = skinAnswerBlock({ ...dossier, community: null })
    expect(b.confidence).toBe('empty')
    expect(b.answer).toContain('has not been through a head-to-head battle yet')
    expect(b.answer).not.toMatch(/\bElo\b/)
  })

  it('drops a rank it cannot stand behind instead of printing "#0 of 0"', () => {
    for (const rank of [0, -1, 1905]) {
      const b = skinAnswerBlock({
        ...dossier,
        community: { ...dossier.community!, rank },
      })
      expect(b.answer).not.toMatch(/#\s*-?\d/)
      expect(b.answer).toContain('1,642 Elo')
    }
  })

  it('never prints a zero head count', () => {
    const b = skinAnswerBlock({
      ...dossier,
      community: { ...dossier.community!, voters: { members: 0, guests: 0 } },
    })
    expect(b.basis).not.toContain('0 voters')
  })

  it('produces clean prose from hostile input', () => {
    const hostile: SkinAnswerInput[] = [
      { name: '', community: null, rated: 0, total: 0 },
      {
        name: undefined as never,
        community: undefined as never,
        rated: NaN,
        total: NaN,
      },
      {
        name: '  ',
        community: {
          rating: NaN,
          uncertainty: Infinity,
          battles: -4,
          rank: NaN,
          voters: { members: -2, guests: NaN as never },
        },
        rated: -1,
        total: 3,
      },
      {
        name: 'A',
        community: {
          rating: undefined as never,
          uncertainty: undefined as never,
          battles: undefined as never,
          rank: undefined as never,
          voters: undefined as never,
        },
        rated: 5,
        total: 2,
      },
      {
        name: "Bel'Veth's <script>",
        community: {
          rating: 1500,
          uncertainty: 0,
          battles: 1,
          rank: 1,
          voters: { members: 1, guests: 0 },
        },
        rated: 1,
        total: 1,
      },
    ]
    for (const input of hostile) {
      const b = skinAnswerBlock(input)
      for (const s of [b.answer, b.basis]) {
        expect(s).not.toMatch(/undefined|null|NaN|Infinity/)
        expect(s.trim()).toMatch(/\.$/)
        expect(s).not.toMatch(/\s{2,}|\s\./)
      }
      expect(['confident', 'provisional', 'empty']).toContain(b.confidence)
    }
  })

  it('is deterministic - same input, same words', () => {
    expect(skinAnswerBlock(dossier)).toEqual(skinAnswerBlock(dossier))
  })
})
