# skinbattle.lol — API Contract (v1)

Shared source of truth for the Go API (`/api`) and the TanStack frontend (`/web`).
The Go service serves all routes; in deployment the frontend reverse-proxies `/api/*` to it (same-origin).

## Auth model
- Auth is via **Logto** (OIDC). The frontend obtains a Logto **access token** (audience = the API resource) and sends it as `Authorization: Bearer <token>`.
- The Go API validates the JWT against Logto's JWKS (`{LOGTO_ENDPOINT}/oidc/jwks`), checking `iss` and `aud`.
- **JIT provisioning:** on any authenticated request, the API upserts a local `users` row keyed by `logto_id` (the token `sub`), capturing `email`/`username` claims. The local `users.id` (bigint) is the FK used by `user_skin_votes`.
- Endpoints marked **(auth optional)** work logged-out (no user-vote columns) and enriched when a valid token is present.

## Types
```
Champion { id: string, key: string, title: string, blurb: string, lore: string, skins: Skin[] }
Skin {
  id: string, champion_id: string, num: int, name: string, chromas: bool, splash_url: string,
  total_votes: int, total_stars: int, total_x: int,
  // present only when request is authenticated:
  user_vote?: int (-1|0|1), user_star?: bool, user_x?: bool
}
```

## Endpoints
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/healthz` | none | — | `{status:"ok"}` |
| GET | `/api/champions` | none | — | `Champion[]` (each with `skins`) |
| GET | `/api/champions/{id}` | optional | id case-insensitive | `Champion` with `skins` (skins ordered by `num`, include user vote cols if auth) |
| GET | `/api/skins` | none | — | `Skin[]` |
| GET | `/api/awards` | optional | — | `{ topStarred: Skin[10], topXed: Skin[10], allSkins: Skin[] }` |
| POST | `/api/votes` | required | `{ skinId: string, vote: -1\|0\|1, star: bool, x: bool }` | `{ message, totals: {total_votes,total_stars,total_x} }` |
| GET | `/api/user/stats` | required | — | `{ usedStars: int, usedX: int }` |
| GET | `/api/user/votes` | required | — | `{ skins: Skin[] }` (only skins where vote!=0 or star or x) |
| GET | `/api/me` | required | — | `{ id, email, username }` |
| DELETE | `/api/user` | required | — | `{ message }` (deletes local rows; deletes Logto user via Management API if configured) |

## Business rules (must preserve exactly)
- `vote` must be one of `-1, 0, 1`; `star`/`x` must be booleans → else 400.
- Per user: **max 3 `star`** and **max 3 `x`** across all skins. Exceeding → 400, transaction rolled back.
- A vote write upserts the row in `user_skin_votes`, then recomputes and persists `skins.total_votes` (SUM of vote), `skins.total_stars` (COUNT star=true), `skins.total_x` (COUNT x=true) for that skin, all in one transaction.

## Caching (Redis)
- Cache base champion list and per-champion base data (no user votes) with a short TTL; invalidate the affected champion + lists on vote write.
- Maintain leaderboard sorted sets `lb:stars` and `lb:x` (member=skin_id, score=total). The awards top-10s read from these; fall back to SQL on miss.

## Error shape
`{ error: string }` with appropriate HTTP status (400/401/404/500).

## Games framework (vertical slice — lives in the web tier for now)

The daily-games framework (GAMES_ROADMAP.md Phase 0 subset + Splashdle) is
currently implemented **inside the TanStack Start SSR server**, not the Go
API: TanStack server functions (`web/src/lib/games/serverFns.ts`) backed by
SQLite (`node:sqlite`, file at `web/.data/games.db`). This was a deliberate
call — the slice had to be runnable without Docker/Postgres/Redis — and the
schema mirrors Postgres conventions so the port is mechanical.

**RPC surface** (server functions, all guest-open — no Logto required):
- `fetchDailyHub({ restoreToken? })` → today's per-game status + streaks
- `fetchSplashdleState({ restoreToken? })` → puzzle state (server-cropped image as a data URL; the full splash URL is only revealed after completion)
- `submitSplashdleGuess({ skinId, restoreToken? })` → validated guess, updated state
- `fetchSplashdleOptions()` → guessable skin catalog for autocomplete

**Guest sessions:** first call mints a `game_users` row + 128-bit token in an
httpOnly `sb_guest` cookie (1 year). The token is echoed in responses and
mirrored to localStorage by the client; `restoreToken` re-establishes a
cleared cookie. Sign-up later attaches `logto_sub` to the same row
(attachment, not migration); `merged_into` supports lossless account merges.

**Tables** (`game_users`, `game_events`, `daily_puzzles`, `daily_results`,
`streaks`, `catalog_skins`/`catalog_meta`) are defined in
`web/src/lib/games/server/db.ts`. `game_events` is append-only and records
`question_asked`, `asset_version`, and `trust_tier` on every row per the
rating-system design.

**Migration path to the Go API:** create the same tables as a Postgres
migration (types map 1:1; JSON payloads → `jsonb`), port the engine modules
(`server/{catalog,daily,guests,streaks,splashdle}.ts`) as Go handlers under
`/api/games/*`, move splash-crop caching to Redis/disk, and turn each server
function into a fetch wrapper — component code doesn't change. Export the
SQLite event log (`game_events`) into Postgres verbatim; nothing is lossy.
