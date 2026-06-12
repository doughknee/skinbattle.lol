// Games freshness status (server-only): one JSON surface an external
// uptime monitor can watch so staleness never goes silent (GAMES_ROADMAP,
// "patch-cadence pipeline" step 6 - pipeline failure pings us instead of
// silently rotting). Returns 503 when something is critically stale, which
// is exactly what ping services alert on.
//
// NOT a container healthcheck - a stale catalog must not restart-loop the
// app. Point an external monitor (UptimeRobot et al.) at /games-status.

import { getDb } from './db'
import { getMeta } from './catalog'
import { factsSnapshotAt } from './facts'

// Catalog re-syncs every 12 h on traffic; double it before alarming.
const CATALOG_STALE_MS = 26 * 60 * 60 * 1000
// Patches land ~biweekly; a snapshot older than this means the refresh
// workflow has been failing (or its PRs aren't getting merged).
const FACTS_STALE_MS = 45 * 24 * 60 * 60 * 1000
// The auto-refit triggers at 500 fresh events - far past that means the
// hook is broken.
const REFIT_OVERDUE_EVENTS = 2000

export async function gamesStatusResponse(): Promise<Response> {
  const db = getDb()
  const now = Date.now()

  const syncedAt = Date.parse(getMeta(db, 'synced_at') ?? '') || 0
  const catalogCount = (
    db
      .prepare('SELECT COUNT(*) AS c FROM catalog_skins WHERE splash_ok = 1')
      .get() as { c: number }
  ).c
  const events = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM game_events WHERE type = 'battle_voted'`,
      )
      .get() as { c: number }
  ).c
  const refitAt = Date.parse(getMeta(db, 'refit_at') ?? '') || 0
  const refitEvents = Number(getMeta(db, 'refit_events') ?? '0')
  const factsAt = Date.parse(factsSnapshotAt) || 0

  const problems: string[] = []
  if (catalogCount < 1000) problems.push(`catalog has only ${catalogCount} skins`)
  if (now - syncedAt > CATALOG_STALE_MS) {
    problems.push(`catalog last synced ${Math.round((now - syncedAt) / 3_600_000)}h ago`)
  }
  if (now - factsAt > FACTS_STALE_MS) {
    problems.push(
      `facts snapshot is ${Math.round((now - factsAt) / 86_400_000)} days old`,
    )
  }
  if (events - refitEvents > REFIT_OVERDUE_EVENTS) {
    problems.push(
      `${events - refitEvents} battle events since the last rating refit`,
    )
  }

  const body = {
    healthy: problems.length === 0,
    problems,
    catalog: {
      ddVersion: getMeta(db, 'dd_version'),
      skins: catalogCount,
      syncedAt: syncedAt ? new Date(syncedAt).toISOString() : null,
      splashSweepVersion: getMeta(db, 'splash_sweep_version'),
    },
    facts: { snapshotAt: factsSnapshotAt },
    ratings: {
      battleEvents: events,
      refitAt: refitAt ? new Date(refitAt).toISOString() : null,
      eventsSinceRefit: events - refitEvents,
    },
  }
  return new Response(JSON.stringify(body, null, 2), {
    status: body.healthy ? 200 : 503,
    headers: { 'content-type': 'application/json' },
  })
}
