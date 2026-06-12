// Guest-first play (design principle 9): the first request mints a real user
// record with no credentials attached. The credential is an unguessable
// 128-bit token kept in an httpOnly cookie, with a localStorage backup the
// client relays back if the cookie is ever cleared. Sign-up later attaches a
// logto_sub to this same row — attachment, not migration.

import { randomBytes, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getCookie, setCookie } from '@tanstack/react-start/server'

const COOKIE_NAME = 'sb_guest'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365
const TOKEN_RE = /^[0-9a-f]{32}$/

export interface GameUser {
  id: string
  trustTier: 'guest' | 'member'
}

// Resolve an EXISTING user for this request without creating anything.
// Read paths (page views) use this so crawlers and drive-by visits never
// write rows — a user is only minted by their first actual play.
export function peekUser(
  db: DatabaseSync,
  restoreToken?: string | null,
): { user: GameUser; token: string } | null {
  const now = new Date().toISOString()

  // Cookie first; then the localStorage backup the client passed along.
  for (const token of [getCookie(COOKIE_NAME), restoreToken]) {
    if (!token || !TOKEN_RE.test(token)) continue
    const row = db
      .prepare(
        'SELECT id, logto_sub FROM game_users WHERE guest_token = ? AND merged_into IS NULL',
      )
      .get(token) as { id: string; logto_sub: string | null } | undefined
    if (!row) continue
    db.prepare('UPDATE game_users SET last_seen_at = ? WHERE id = ?').run(
      now,
      row.id,
    )
    refreshCookie(token)
    return {
      user: { id: row.id, trustTier: row.logto_sub ? 'member' : 'guest' },
      token,
    }
  }
  return null
}

// Resolve the user for this request, minting a guest if needed. Write
// paths (submitting a guess) use this. Must be called inside a
// server-function handler (it reads/writes request cookies).
export function ensureUser(
  db: DatabaseSync,
  restoreToken?: string | null,
): { user: GameUser; token: string } {
  const existing = peekUser(db, restoreToken)
  if (existing) return existing

  const now = new Date().toISOString()
  const token = randomBytes(16).toString('hex')
  const id = randomUUID()
  db.prepare(
    'INSERT INTO game_users (id, guest_token, created_at, last_seen_at) VALUES (?, ?, ?, ?)',
  ).run(id, token, now, now)
  refreshCookie(token)
  return { user: { id, trustTier: 'guest' }, token }
}

function refreshCookie(token: string): void {
  setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === 'production',
  })
}

// Point this device at a different record's credential — used by account
// merges, where the surviving row's token replaces the absorbed guest's.
export function issueCookie(token: string): void {
  refreshCookie(token)
}
