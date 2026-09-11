// Guard for the one way JSON-LD silently dies: a name the serializer or the
// HTML around it mangles, so the block stops parsing and the rich result just
// never appears. Nothing surfaces that in a page render - the markup is in a
// <script> tag nobody reads.
//
// The champion pages are where this bites: 173 of them, and League's roster is
// full of apostrophes, ampersands and periods (Kai'Sa, Nunu & Willump, Dr.
// Mundo). Skin names add quotes and accents on top.

import { describe, expect, it } from 'vitest'
import { breadcrumbJsonLd, itemListJsonLd, absUrl } from './jsonLd'
import { championDisplayName } from '../skinName'

// Exactly what components/JsonLd.tsx writes into the document. If that
// escaping changes, this test has to change with it.
const serialize = (block: object): string =>
  JSON.stringify(block).replace(/</g, '\\u003c')

// Every champion id whose display name carries punctuation, plus a couple of
// hostile skin names.
const HOSTILE_CHAMPIONS = [
  'Kaisa',
  'Belveth',
  'KSante',
  'RekSai',
  'Velkoz',
  'Chogath',
  'Khazix',
  'KogMaw',
  'DrMundo',
  'Nunu',
  'Leblanc',
  'MonkeyKing',
  'JarvanIV',
]

const HOSTILE_SKIN_NAMES = [
  "Kai'Sa Prestige K/DA ALL OUT",
  'Nunu & Willump: Papercraft',
  'Bel\'Veth "Prestige"',
  'Dr. Mundo, Feat. <script>',
  'Renata Glasc — Admiral',
  'Køgmaw Ásgard',
]

describe('champion breadcrumbs survive the roster', () => {
  it.each(HOSTILE_CHAMPIONS)('parses for %s', (championId) => {
    const name = championDisplayName(championId)
    const block = breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Champions', path: '/champions' },
      { name, path: `/champions/${championId.toLowerCase()}` },
    ])

    const parsed = JSON.parse(serialize(block))
    expect(parsed['@type']).toBe('BreadcrumbList')
    expect(parsed.itemListElement).toHaveLength(3)
    // The name round-trips intact - a mangled apostrophe is worse than none.
    expect(parsed.itemListElement[2].name).toBe(name)
    expect(parsed.itemListElement[2].item).toBe(
      absUrl(`/champions/${championId.toLowerCase()}`),
    )
  })

  it('keeps the punctuation the exceptions map exists to produce', () => {
    // Proves the fixtures above are actually hostile, not just PascalCase ids.
    expect(championDisplayName('Kaisa')).toBe("Kai'Sa")
    expect(championDisplayName('Nunu')).toBe('Nunu & Willump')
    expect(championDisplayName('DrMundo')).toBe('Dr. Mundo')
    expect(championDisplayName('JarvanIV')).toBe('Jarvan IV')
  })
})

describe('the ranked ItemList survives skin names', () => {
  it('parses, and keeps names and positions intact', () => {
    const items = HOSTILE_SKIN_NAMES.map((name, i) => ({
      name,
      path: `/skins/skin-${i}`,
    }))
    const parsed = JSON.parse(
      serialize(itemListJsonLd({ name: "Kai'Sa skins ranked", items })),
    )

    expect(parsed['@type']).toBe('ItemList')
    expect(parsed.numberOfItems).toBe(items.length)
    expect(parsed.itemListElement.map((e: { name: string }) => e.name)).toEqual(
      HOSTILE_SKIN_NAMES,
    )
    // Positions are 1-based and in the order handed in - the champion page
    // feeds this the same array it renders, so these are the visible ranks.
    expect(
      parsed.itemListElement.map((e: { position: number }) => e.position),
    ).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('escapes < so a name can never close the script tag', () => {
    // The real hazard: "</script>" inside a name would end the block early and
    // dump the rest of the JSON into the page as markup.
    const raw = serialize(
      itemListJsonLd({
        name: 'x',
        items: [{ name: '</script><img onerror=1>', path: '/skins/x' }],
      }),
    )
    expect(raw).not.toContain('<')
    expect(JSON.parse(raw).itemListElement[0].name).toBe(
      '</script><img onerror=1>',
    )
  })
})
