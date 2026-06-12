// Guest → account attachment (server-only): the other half of design
// principle 9. Sign-up has always been "attachment, not migration" in the
// schema (game_users.logto_sub, merged_into) - this wires it: a signed-in
// visitor's Logto access token proves their identity, and their guest
// record becomes their account record. Losslessly, or it's a churn landmine.
//
// Token validation is strict and standard: RS256 against Logto's JWKS,
// issuer `${LOGTO_ENDPOINT}/oidc`, audience = the API resource - the same
// access token the SPA already holds for Go-API calls. Any failure rejects;
// nothing is written on a rejected token.

import { randomBytes } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { DatabaseSync } from 'node:sqlite'
import { getDb } from './db'
import { ensureUser, issueCookie } from './guests'
import { START_RATING, expectedScore } from './ratings'

// Personal-rating replay uses the same fixed K as the live path
// (ratings.applyPersonalUpdate).
const K_PERSONAL = 48

// ─── token verification ─────────────────────────────────────────────────────

let jwks: { url: string; set: JWTVerifyGetKey } | null = null

function jwksFor(endpoint: string): JWTVerifyGetKey {
  const url = `${endpoint.replace(/\/$/, '')}/oidc/jwks`
  if (!jwks || jwks.url !== url) {
    jwks = { url, set: createRemoteJWKSet(new URL(url)) }
  }
  return jwks.set
}

// Returns the Logto subject for a valid access token, or null. Never throws
// - a bad token is a 401, not a 500.
export async function verifyLogtoToken(token: string): Promise<string | null> {
  const endpoint = process.env.LOGTO_ENDPOINT
  const resource = process.env.LOGTO_RESOURCE
  if (!endpoint || !resource) {
    console.warn('attach: LOGTO_ENDPOINT/LOGTO_RESOURCE not configured')
    return null
  }
  try {
    const { payload } = await jwtVerify(token, jwksFor(endpoint), {
      issuer: `${endpoint.replace(/\/$/, '')}/oidc`,
      audience: resource,
      algorithms: ['RS256'],
    })
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null
  } catch (err) {
    console.warn('attach: token rejected:', (err as Error).message)
    return null
  }
}

// The ID token (audience = the SPA's app id, same issuer/keys) carries the
// username claim the access token doesn't. Optional - attachment works
// without it; the username just feeds leaderboard display names. The sub
// must match the access token's: a mismatched pair is treated as no
// username, never as a different identity.
export async function verifyLogtoIdToken(
  idToken: string,
  expectedSub: string,
): Promise<string | null> {
  const endpoint = process.env.LOGTO_ENDPOINT
  const appId = process.env.LOGTO_APP_ID
  if (!endpoint || !appId) return null
  try {
    const { payload } = await jwtVerify(idToken, jwksFor(endpoint), {
      issuer: `${endpoint.replace(/\/$/, '')}/oidc`,
      audience: appId,
      algorithms: ['RS256'],
    })
    if (payload.sub !== expectedSub) return null
    const name = payload.username ?? payload.name
    return typeof name === 'string' && name.trim() ? name.trim() : null
  } catch (err) {
    console.warn('attach: id token rejected:', (err as Error).message)
    return null
  }
}

// ─── attachment & merge ─────────────────────────────────────────────────────

export interface AttachResult {
  // 'attached'   - this device's record now carries the account
  // 'merged'     - this device's guest progress was folded into the account
  // 'already'    - nothing to do (record already carries this account)
  outcome: 'attached' | 'merged' | 'already'
  guestToken: string
}

// Recompute a user's personal skin ratings from their (post-merge) raw
// battle history - the design doc's "recompute personal rating from the
// union". Same fixed-K Elo as the live per-pick update, replayed in order.
function replayPersonalRatings(db: DatabaseSync, userId: string): void {
  const events = db
    .prepare(
      `SELECT payload FROM game_events
       WHERE user_id = ? AND game = 'quick-battle' AND type = 'battle_voted'
       ORDER BY id`,
    )
    .all(userId) as unknown as { payload: string }[]

  const ratings = new Map<string, { rating: number; battles: number }>()
  const get = (id: string) =>
    ratings.get(id) ?? { rating: START_RATING, battles: 0 }
  for (const row of events) {
    const p = JSON.parse(row.payload) as { winnerId: string; loserId: string }
    const w = get(p.winnerId)
    const l = get(p.loserId)
    const delta = K_PERSONAL * (1 - expectedScore(w.rating, l.rating))
    ratings.set(p.winnerId, { rating: w.rating + delta, battles: w.battles + 1 })
    ratings.set(p.loserId, { rating: l.rating - delta, battles: l.battles + 1 })
  }

  db.prepare('DELETE FROM user_skin_ratings WHERE user_id = ?').run(userId)
  const put = db.prepare(
    `INSERT INTO user_skin_ratings (user_id, skin_id, rating, battles, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
  const now = new Date().toISOString()
  for (const [skinId, r] of ratings) {
    put.run(userId, skinId, r.rating, r.battles, now)
  }
}

// Fold the guest's progress into the account row, losslessly:
// - game_events move to the account (rows untouched beyond attribution, so
//   the next Bradley-Terry refit re-weights them at member strength)
// - daily_results move where the account hasn't played that day
// - streaks keep the better of the two
// - personal ratings are recomputed from the unioned battle history
// - the guest row stays, pointing at the account via merged_into
function mergeInto(db: DatabaseSync, guestId: string, accountId: string): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('UPDATE game_events SET user_id = ? WHERE user_id = ?').run(
      accountId,
      guestId,
    )
    db.prepare(
      `UPDATE daily_results SET user_id = ? WHERE user_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM daily_results d2
         WHERE d2.user_id = ? AND d2.game = daily_results.game
           AND d2.puzzle_date = daily_results.puzzle_date
       )`,
    ).run(accountId, guestId, accountId)
    db.prepare('DELETE FROM daily_results WHERE user_id = ?').run(guestId)

    const guestStreaks = db
      .prepare('SELECT * FROM streaks WHERE user_id = ?')
      .all(guestId) as unknown as {
      game: string
      current_streak: number
      best_streak: number
      last_result_date: string | null
      freeze_tokens: number
    }[]
    const upsertStreak = db.prepare(
      `INSERT INTO streaks (user_id, game, current_streak, best_streak, last_result_date, freeze_tokens)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, game) DO UPDATE SET
         current_streak = MAX(current_streak, excluded.current_streak),
         best_streak = MAX(best_streak, excluded.best_streak),
         last_result_date = MAX(COALESCE(last_result_date, ''), COALESCE(excluded.last_result_date, '')),
         freeze_tokens = freeze_tokens + excluded.freeze_tokens`,
    )
    for (const s of guestStreaks) {
      upsertStreak.run(
        accountId,
        s.game,
        s.current_streak,
        s.best_streak,
        s.last_result_date,
        s.freeze_tokens,
      )
    }
    db.prepare('DELETE FROM streaks WHERE user_id = ?').run(guestId)
    db.prepare('DELETE FROM user_skin_ratings WHERE user_id = ?').run(guestId)

    db.prepare(
      'UPDATE game_users SET merged_into = ?, guest_token = NULL, last_seen_at = ? WHERE id = ?',
    ).run(accountId, new Date().toISOString(), guestId)

    replayPersonalRatings(db, accountId)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// Attach the verified Logto subject to this device's record. Called from a
// request context (reads/sets the guest cookie via ensureUser). `username`
// (from the verified ID token) refreshes on every call - Logto lets users
// rename, and the leaderboard should follow.
export function attachSub(
  sub: string,
  restoreToken?: string | null,
  username?: string | null,
): AttachResult {
  const db = getDb()
  // ensureUser (not peek): a signed-in visitor with no guest record yet
  // still deserves a row - their plays from here on are attributed to the
  // account. This is a write endpoint by definition.
  const { user, token } = ensureUser(db, restoreToken)

  const setName = (id: string) => {
    if (username) {
      db.prepare('UPDATE game_users SET username = ? WHERE id = ?').run(
        username,
        id,
      )
    }
  }

  const existing = db
    .prepare('SELECT id FROM game_users WHERE logto_sub = ? AND merged_into IS NULL')
    .get(sub) as { id: string } | undefined

  if (existing && existing.id === user.id) {
    setName(existing.id)
    return { outcome: 'already', guestToken: token }
  }

  if (!existing) {
    // First sign-in for this account on this device: plain attachment.
    db.prepare(
      'UPDATE game_users SET logto_sub = ?, last_seen_at = ? WHERE id = ?',
    ).run(sub, new Date().toISOString(), user.id)
    setName(user.id)
    return { outcome: 'attached', guestToken: token }
  }

  // The account already exists (signed in on another device, or this device
  // re-minted a guest after clearing storage): fold this guest into it, then
  // hand the device the ACCOUNT's credential so future plays land there.
  mergeInto(db, user.id, existing.id)
  setName(existing.id)
  let accountToken = (
    db.prepare('SELECT guest_token FROM game_users WHERE id = ?').get(existing.id) as {
      guest_token: string | null
    }
  ).guest_token
  if (!accountToken) {
    accountToken = randomBytes(16).toString('hex')
    db.prepare('UPDATE game_users SET guest_token = ? WHERE id = ?').run(
      accountToken,
      existing.id,
    )
  }
  issueCookie(accountToken)
  return { outcome: 'merged', guestToken: accountToken }
}
