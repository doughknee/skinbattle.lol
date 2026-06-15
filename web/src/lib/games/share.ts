// Tier-list share payloads. Shares are stored server-side (lib/games/server
// /tierlist.ts) and addressed by a short id, so links stay short and the image
// endpoint + recipient view resolve by id. This module is client-safe: it holds
// the payload shape plus the validator both sides use.

import type { TierName } from './types'

// What a shared link reveals to whoever opens it:
//  - 'reveal': show the sharer's ranking right away (read-only + make-your-own).
//  - 'hide':   the challenge - the recipient ranks the board first, THEN sees
//              the sharer's ranking compared to theirs.
//  - 'board':  just the blank board (the set of skins), no answer shared.
export type ShareMode = 'reveal' | 'hide' | 'board'

export interface SharePayload {
  v: 1
  boardId: string
  // The sharer's tiers, best→worst label keys. Omitted for 'board' mode.
  tiers?: Partial<Record<TierName, string[]>>
  // The name printed on the card/image (account username or a typed-in one).
  name?: string
  mode: ShareMode
}

const SKIN_ID = /^\d+$/
const TIER_KEYS: TierName[] = ['S', 'A', 'B', 'C', 'D']

// Validate + normalize an untrusted share input (it comes from a client RPC).
// Every field is checked; skin ids are constrained to digits before they ever
// reach a query. Returns null on anything malformed.
export function sanitizeSharePayload(input: unknown): SharePayload | null {
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  if (typeof o.boardId !== 'string' || !o.boardId) return null
  if (o.mode !== 'reveal' && o.mode !== 'hide' && o.mode !== 'board') return null
  const out: SharePayload = { v: 1, boardId: o.boardId.slice(0, 120), mode: o.mode }
  if (typeof o.name === 'string' && o.name.trim()) out.name = o.name.trim().slice(0, 40)
  if (o.tiers && typeof o.tiers === 'object') {
    const tiers: Partial<Record<TierName, string[]>> = {}
    const seen = new Set<string>()
    for (const t of TIER_KEYS) {
      const ids = (o.tiers as Record<string, unknown>)[t]
      if (!Array.isArray(ids)) continue
      const clean = ids.filter(
        (id): id is string =>
          typeof id === 'string' &&
          SKIN_ID.test(id) &&
          !seen.has(id) &&
          (seen.add(id), true),
      )
      if (clean.length) tiers[t] = clean
    }
    if (Object.keys(tiers).length) out.tiers = tiers
  }
  return out
}
