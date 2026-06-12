// Static skin facts (server-only): RP cost, rarity, availability, skin
// lines, release dates — snapshotted from Meraki Analytics into the
// committed dataset at ../data/skin-facts.json (see scripts/snapshot-facts.mjs).
// Never fetched at runtime: a community CDN outage must not take a game down.

import dataset from '../data/skin-facts.json'

export interface SkinFacts {
  cost: number | null
  rarity: string | null
  availability: string | null
  sets: string[]
  release: string | null
}

// Meraki stamps not-yet-released skins with release "0000-00-00" (and
// availability "Upcoming") — normalize that to null so date math never sees
// an unparseable string.
const SKINS: Record<string, SkinFacts> = Object.fromEntries(
  Object.entries(dataset.skins as Record<string, SkinFacts>).map(([id, f]) => [
    id,
    {
      ...f,
      release:
        f.release && !Number.isNaN(Date.parse(`${f.release}T00:00:00Z`))
          ? f.release
          : null,
    },
  ]),
)

// The RP tiers Price Check offers as answers. Rarer price points (390 RP
// relics, one-off 2775/5000, gacha 150000) are excluded — a button that is
// almost never the answer is a wasted button.
export const PRICE_TIERS = [520, 750, 975, 1350, 1820, 3250] as const

export function factsFor(skinId: string): SkinFacts | null {
  return SKINS[skinId] ?? null
}

// Skin ids eligible for Price Check: a known cost on a standard tier.
export function priceCheckIds(): string[] {
  return Object.entries(SKINS)
    .filter(([, f]) => f.cost !== null && (PRICE_TIERS as readonly number[]).includes(f.cost))
    .map(([id]) => id)
}

// skinId → skin lines, for the Mirror's taste profile ("you over-index on
// Coven"). Most skins carry exactly one set. Meraki also files 81 vaulted
// skins under a "Legacy" set — that's an availability bucket, not a theme,
// so it's excluded here (availability already carries it).
export function skinSets(skinId: string): string[] {
  return (SKINS[skinId]?.sets ?? []).filter((s) => s !== 'Legacy')
}

export const factsSnapshotAt: string = dataset.snapshotAt
