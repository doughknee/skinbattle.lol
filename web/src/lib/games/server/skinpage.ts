// Skin page engine (server-only): everything one skin's stable URL shows -
// catalog identity, community rating ± uncertainty with rank (uncertainty
// is a feature: low-confidence skins get a "needs more votes" flag, not an
// embarrassment), the committed facts, the verdict placing it in the field,
// and the viewer's own take when they have one. Strictly read-only: peekUser
// only, nothing written on view.

import type { DatabaseSync } from 'node:sqlite'
import type { SkinPageState } from '../types'
import { getDb } from './db'
import {
  catalogSkinTotal,
  championSkins,
  ensureCatalog,
  getCatalogSkin,
} from './catalog'
import { peekUser } from './guests'
import { globalRank, ratedCount, skinVoters } from './ratings'
import { factsFor } from './facts'
import { skinAnswerBlock } from '../answer'
import { skinIdFromSlug, skinSlug } from '../slug'

// Below this many battles the rating is flagged as still calibrating
// ("Early ranking - needs more votes").
export const CALIBRATED_BATTLES = 10

// Sibling skins linked from a dossier. Taken as the NEXT few in release order,
// wrapping past the end of the wardrobe, so every skin appears in exactly this
// many siblings' lists - a fixed "first 8" would orphan everything after the
// eighth. Deterministic either way, which is what a crawler needs.
const RELATED_SKINS = 6

export async function skinPageState(
  slugOrId: string,
  restoreToken?: string | null,
): Promise<SkinPageState | null> {
  const db: DatabaseSync = getDb()
  await ensureCatalog(db)

  const skinId = skinIdFromSlug(slugOrId)
  if (!skinId) return null
  const skin = getCatalogSkin(db, skinId)
  if (!skin) return null

  const community = db
    .prepare(
      'SELECT rating, uncertainty, battles, wins FROM skin_ratings WHERE skin_id = ? AND battles > 0',
    )
    .get(skinId) as
    | { rating: number; uncertainty: number; battles: number; wins: number }
    | undefined
  const ratedTotal = ratedCount(db)
  const catalogTotal = catalogSkinTotal(db)

  const known = peekUser(db, restoreToken)
  const personal = known
    ? (db
        .prepare(
          'SELECT rating, battles FROM user_skin_ratings WHERE user_id = ? AND skin_id = ? AND battles > 0',
        )
        .get(known.user.id, skinId) as
        | { rating: number; battles: number }
        | undefined)
    : undefined

  // Rounded to the integers the page prints, not the raw floats: the verdict
  // and the rating card sit on one screen, and a ±204.6 that printed "±205"
  // beside a sentence saying "±204" is the page arguing with itself. The
  // rounded band is the one a reader can see, so it is the one that decides.
  const rating = community ? Math.round(community.rating) : 0
  const uncertainty = community ? Math.round(community.uncertainty) : 0
  const rank = community ? globalRank(db, community.rating) : 0

  // Heads behind THIS skin's battles - the dossier's own crowd, not its
  // champion's. Queried only when there is something to be behind, and only
  // ever as two counts: no id, no per-person total, no voting history leaves
  // this function, so nothing here can reach the page or its JSON-LD.
  const answer = skinAnswerBlock({
    name: skin.name,
    community: community
      ? {
          rating,
          uncertainty,
          battles: community.battles,
          rank,
          voters: skinVoters(db, skinId),
        }
      : null,
    rated: ratedTotal,
    total: catalogTotal,
  })

  // Wardrobe neighbours, wrapping - see RELATED_SKINS. A base look (num 0) is
  // not in the wardrobe, so it simply gets no siblings rather than a wrong set.
  const wardrobe = championSkins(db, skin.championId)
  const at = wardrobe.findIndex((s) => s.id === skinId)
  const related =
    at < 0
      ? []
      : Array.from(
          { length: Math.min(RELATED_SKINS, wardrobe.length - 1) },
          (_, k) => wardrobe[(at + 1 + k) % wardrobe.length],
        ).map((s) => ({
          skinId: s.id,
          name: s.name,
          slug: skinSlug(s.name, s.id),
          splashUrl: s.splashUrl,
        }))

  return {
    skinId,
    slug: skinSlug(skin.name, skinId),
    name: skin.name,
    championId: skin.championId,
    championName: skin.championName,
    splashUrl: skin.splashUrl,
    facts: factsFor(skinId),
    community: community
      ? {
          rating,
          uncertainty,
          battles: community.battles,
          wins: community.wins,
          rank,
          calibrated: community.battles >= CALIBRATED_BATTLES,
        }
      : null,
    ratedTotal,
    catalogTotal,
    answer,
    related,
    personal: personal
      ? {
          rating: Math.round(personal.rating),
          battles: personal.battles,
          gap: community ? Math.round(personal.rating - rating) : null,
        }
      : null,
    guestToken: known?.token ?? '',
  }
}
