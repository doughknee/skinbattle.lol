// Skin page engine (server-only): everything one skin's stable URL shows -
// catalog identity, community rating ± uncertainty with rank (uncertainty
// is a feature: low-confidence skins get a "needs more votes" flag, not an
// embarrassment), the committed facts, and the viewer's own take when they
// have one. Strictly read-only: peekUser only, nothing written on view.

import type { DatabaseSync } from 'node:sqlite'
import type { SkinPageState } from '../types'
import { getDb } from './db'
import { ensureCatalog, getCatalogSkin } from './catalog'
import { peekUser } from './guests'
import { globalRank } from './ratings'
import { factsFor } from './facts'
import { skinIdFromSlug, skinSlug } from '../slug'

// Below this many battles the rating is flagged as still calibrating
// ("Early ranking - needs more votes").
export const CALIBRATED_BATTLES = 10

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
  const ratedTotal = (
    db
      .prepare('SELECT COUNT(*) AS c FROM skin_ratings WHERE battles > 0')
      .get() as { c: number }
  ).c

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
          rating: Math.round(community.rating),
          uncertainty: Math.round(community.uncertainty),
          battles: community.battles,
          wins: community.wins,
          rank: globalRank(db, community.rating),
          calibrated: community.battles >= CALIBRATED_BATTLES,
        }
      : null,
    ratedTotal,
    personal: personal
      ? {
          rating: Math.round(personal.rating),
          battles: personal.battles,
          gap: community
            ? Math.round(personal.rating - community.rating)
            : null,
        }
      : null,
    guestToken: known?.token ?? '',
  }
}
