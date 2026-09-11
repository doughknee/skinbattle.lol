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
  it('opens with a hook, lists the live podium with medals, and says provisional when it is', () => {
    const text = rankingShareText({
      title: 'Ahri',
      champion: true,
      top: ['Spirit Blossom Ahri', 'K/DA ALL OUT Ahri', 'Elderwood Ahri', 'Arcade Ahri'],
      state: 'provisional',
      battles: 21,
    })
    expect(text.split('\n')).toEqual([
      "Ahri's best skin isn't settled yet:",
      '🥇 Spirit Blossom Ahri (leading)',
      '🥈 K/DA ALL OUT Ahri',
      '🥉 Elderwood Ahri',
      'Provisional after 21 battles. Your vote could decide it, no account needed:',
    ])
  })

  it('invites an argument once settled, and never carries the link itself', () => {
    const text = rankingShareText({
      title: 'Jhin',
      champion: true,
      top: ['Dark Cosmic Jhin', 'Mythmaker Jhin', 'Dark Cosmic Erasure Jhin'],
      state: 'settled',
      battles: 87,
    })
    expect(text.split('\n')[0]).toBe("Jhin's best skin, by community vote:")
    expect(text).not.toMatch(/provisional|leading/i)
    expect(text.split('\n').at(-1)).toBe(
      'Settled after 87 battles. Think the community got it wrong? Vote, no account needed:',
    )
    expect(text).not.toMatch(/https?:/)
  })

  it('names a cross-champion slice in the singular and skips the count when there is none', () => {
    const text = rankingShareText({
      title: '975 RP skins',
      champion: false,
      top: ['A', 'B'],
      state: 'settled',
      battles: 0,
    })
    expect(text.split('\n')[0]).toBe('The best 975 RP skin, by community vote:')
    expect(text).toMatch(/^Settled\. Think/m)
    expect(text).not.toMatch(/🥉/)
    expect(
      rankingShareText({ title: 'Ahri', champion: true, top: ['A'], state: 'provisional', battles: 1 }),
    ).toMatch(/after 1 battle\./)
  })

  it('invents no podium for an empty ranking', () => {
    const empty = rankingShareText({ title: 'Ahri', champion: true, top: [], state: 'empty', battles: 0 })
    expect(empty).not.toMatch(/🥇/)
    expect(empty).toBe('No Ahri skin has been through a battle yet. Be the first to vote, no account needed:')
  })

  it('attributes the share on the canonical path with the medium it used, and nothing more', () => {
    expect(shareUrl('https://skinbattle.lol', '/champions/ahri', 'copy')).toBe(
      'https://skinbattle.lol/champions/ahri?utm_source=share&utm_medium=copy',
    )
    expect(shareUrl('https://skinbattle.lol', '/rankings/all', 'native')).toBe(
      'https://skinbattle.lol/rankings/all?utm_source=share&utm_medium=native',
    )
  })
})

describe('the arrival', () => {
  it('recognises only our own share links', () => {
    expect(parseShareReferral('?utm_source=share&utm_medium=native')).toEqual({
      medium: 'native',
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
