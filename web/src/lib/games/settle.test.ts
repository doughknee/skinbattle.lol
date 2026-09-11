import { describe, expect, it } from 'vitest'
import {
  championOfPath,
  isMilestone,
  pageTypeOf,
  parseShareReferral,
  rankingShareText,
  rankingStateOf,
  settleCta,
  shareUrl,
  stripUtm,
} from './settle'

describe('the ask follows the verdict', () => {
  it('maps the answer vocabulary onto the button vocabulary', () => {
    expect(rankingStateOf('confident')).toBe('settled')
    expect(rankingStateOf('provisional')).toBe('provisional')
    expect(rankingStateOf('empty')).toBe('empty')
  })

  it('asks for help only while the ranking is provisional', () => {
    expect(settleCta('provisional', 'Ahri').label).toBe("Help settle Ahri's ranking")
    expect(settleCta('settled', 'Ahri').label).toBe('Battle Ahri skins')
    expect(settleCta('settled', 'Ahri').hint).toMatch(/got it wrong/)
    expect(settleCta('empty', 'Ahri').hint).toMatch(/first/)
  })

  it('never promises a number of votes', () => {
    for (const state of ['provisional', 'settled', 'empty'] as const) {
      const { label, hint } = settleCta(state, 'Ahri')
      expect(`${label} ${hint}`).not.toMatch(/\d+ (more )?(votes|battles)/)
    }
  })
})

describe('the share payload', () => {
  const url = 'https://skinbattle.lol/champions/ahri?utm_source=share&utm_medium=copy&utm_campaign=ranking'

  it('lists the live top three and says provisional when it is', () => {
    const text = rankingShareText({
      title: 'Ahri',
      top: ['Spirit Blossom Ahri', 'K/DA ALL OUT Ahri', 'Elderwood Ahri', 'Arcade Ahri'],
      state: 'provisional',
      url,
    })
    expect(text.split('\n')).toEqual([
      'Ahri · SkinBattle community ranking',
      '#1 Spirit Blossom Ahri',
      '#2 K/DA ALL OUT Ahri',
      '#3 Elderwood Ahri',
      "Provisional: the top spot isn't settled yet.",
      `Help settle it: ${url}`,
    ])
  })

  it('does not call a settled ranking provisional, or invent a podium for an empty one', () => {
    expect(
      rankingShareText({ title: 'Ahri', top: ['A', 'B'], state: 'settled', url }),
    ).not.toMatch(/provisional/i)
    const empty = rankingShareText({ title: 'Ahri', top: [], state: 'empty', url })
    expect(empty).not.toMatch(/#1/)
    expect(empty).toMatch(/No battles yet/)
  })

  it('leaves the link to the share sheet when no url is given', () => {
    const text = rankingShareText({ title: 'Ahri', top: ['A'], state: 'provisional' })
    expect(text.split('\n').at(-1)).toBe('Help settle it')
    expect(text).not.toMatch(/https?:/)
  })

  it('attributes the share on the canonical path with the medium it used', () => {
    expect(shareUrl('https://skinbattle.lol', '/champions/ahri', 'copy')).toBe(url)
    expect(shareUrl('https://skinbattle.lol', '/rankings/all', 'native')).toBe(
      'https://skinbattle.lol/rankings/all?utm_source=share&utm_medium=native&utm_campaign=ranking',
    )
  })
})

describe('the arrival', () => {
  it('recognises only our own share links', () => {
    expect(parseShareReferral('?utm_source=share&utm_medium=native&utm_campaign=ranking')).toEqual({
      medium: 'native',
      campaign: 'ranking',
    })
    expect(parseShareReferral('?utm_source=chatgpt.com')).toBeNull()
    expect(parseShareReferral('')).toBeNull()
  })

  it('strips every utm parameter and nothing else', () => {
    expect(stripUtm('?utm_source=share&utm_medium=copy&utm_campaign=ranking')).toBe('')
    expect(stripUtm('?tab=account&utm_source=share')).toBe('?tab=account')
    expect(stripUtm('')).toBe('')
  })

  it('buckets landing pages the way the funnel does', () => {
    expect(pageTypeOf('/')).toBe('home')
    expect(pageTypeOf('/champions/ahri')).toBe('champion')
    expect(pageTypeOf('/skins/elderwood-ahri-103014')).toBe('skin')
    expect(pageTypeOf('/rankings/champion-ahri')).toBe('ranking-slice')
    expect(pageTypeOf('/battle')).toBe('battle')
    expect(pageTypeOf('/battle/tier-drop')).toBe('battle')
    expect(pageTypeOf('/settle')).toBe('settle')
    expect(pageTypeOf('/methodology')).toBe('other')
  })

  it('names the champion a page is about', () => {
    expect(championOfPath('/champions/Ahri')).toBe('ahri')
    expect(championOfPath('/rankings/champion-missfortune')).toBe('missfortune')
    expect(championOfPath('/rankings/all')).toBeNull()
    expect(championOfPath('/champions/miss-fortune')).toBeNull()
  })
})

describe('the payoff cadence', () => {
  it('speaks at 1, 3, 5 and every fifth after', () => {
    const spoken = Array.from({ length: 21 }, (_, i) => i).filter(isMilestone)
    expect(spoken).toEqual([1, 3, 5, 10, 15, 20])
  })
})
