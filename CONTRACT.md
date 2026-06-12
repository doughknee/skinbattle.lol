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
- `fetchDailyHub({ restoreToken? })` → today's per-game status + streaks + Quick Battle volume counts
- `fetchSplashdleState({ restoreToken? })` → puzzle state (server-cropped image as a data URL; the full splash URL is only revealed after completion)
- `submitSplashdleGuess({ skinId, restoreToken? })` → validated guess, updated state
- `fetchSplashdleOptions()` → guessable skin catalog for autocomplete (shared by Splashdle and Chroma Vision)
- `fetchChromaVision({ restoreToken? })` / `submitChromaGuess({ skinId, restoreToken? })` → Chroma Vision (`/games/chroma-vision`): the splash as a server-rendered color mosaic (data URL) that sharpens per miss — 5×3 blocks → 44 columns over six levels; same six-guess/champion-hint/streak contracts as Splashdle
- `fetchQuickBattle({ restoreToken?, refit? })` → current pair + preloaded next pair + battle stats. Pairs are HMAC-signed stateless tokens (no row written on read); `refit` triggers the manual Bradley-Terry refit (guarded by `GAMES_ADMIN_SECRET` when set; reachable for cron via `GET /games/quick-battle?refit=…` which runs the loader)
- `submitBattleVote({ pairToken, winnerId, recent?, restoreToken? })` → appends the raw `battle_voted` event, applies the live Elo update (global + personal), burns the pair nonce, enforces rate limits, and returns feedback (delta, rank, agreement %) + the next pair
- `fetchPriceCheck({ restoreToken? })` / `submitPriceGuess({ tier, restoreToken? })` → Price Check (`/games/price-check`): five seeded skins a day, guess each one's RP tier. Prices come from the committed Meraki snapshot (`web/src/lib/games/data/skin-facts.json`, refreshed by `web/scripts/snapshot-facts.mjs` — never fetched at runtime). The unanswered round's price never reaches the client; win = 3+ exact of 5
- `fetchMirror({ restoreToken? })` → the Mirror (`/games/mirror`): personal tier list bucketed from `user_skin_ratings`, contrarian takes (personal vs community rating gaps with minimum battle counts on both sides), champion taste profile, wardrobe completion. Strictly read-only — never mints a user, never writes
- `fetchSkinPage({ slug, restoreToken? })` → one skin's stable page (`/skins/<slug>`): catalog identity, community rating ± uncertainty + rank, committed facts, viewer's personal rating. Slug = kebab(name)-id; the route 301s non-canonical slugs whose trailing ID resolves. `GET /og/skin/<id>` serves its share card
- `fetchLeaderboards()` → `/leaderboards`: today's fastest solves, per-game streak boards, Quick Battle volume (week/all-time). Members only on the boards (rows with `logto_sub`); display names captured at attach from the verified ID token (`POST /games-attach` accepts optional `idToken`, audience = `LOGTO_APP_ID`, sub must match the access token)
- `fetchRankings({ slice })` / `fetchRankingsIndex()` → ranking slices (`/rankings`, `/rankings/<slice>`): `all` | `price-<tier>` | `line-<kebab>` | `champion-<id>` | `year-<yyyy>`, rated skins ranked with uncertainty + battle counts and an "Early Rankings" calibrating flag (median battles < 10). `GET /og/rankings/<slice>` serves the share card
- `fetchDrought()` → the Skin Drought Index (`/insights/drought`): per-champion days since last skin, derived from the catalog + committed facts snapshot. Fully anonymous — no guest token involved
- `GET /games-status` (server route) → freshness JSON for external uptime monitors: 200 healthy / 503 stale (catalog sync age, facts snapshot age, rating-refit lag). Not a container healthcheck — staleness must not restart the app. The facts snapshot itself is refreshed by `.github/workflows/facts-snapshot.yml` (Mon+Thu cron → PR on data diff; failures email)
- `GET /og/<card>` (server route, not an RPC) → 1200×630 OG share-card PNG for `games` | `splashdle` | `quick-battle` | `mirror` | `price-check` | `drought` (`web/src/lib/games/server/og.ts`: satori + @resvg/resvg-js, fonts from `web/assets/og` — copied to `/app/assets` by the Dockerfile — cached per UTC day under `.data/cache`). The four games routes point `og:image` at these.

**Rating model** (`web/src/lib/games/server/ratings.ts`): live Glicko-lite
per pick (start 1500 ± 350, K 16–64 scaled by uncertainty, floor ± 60, guest
votes at 0.5 weight) for instant feedback, plus a periodic Bradley-Terry
MM refit over the full `game_events` history for canonical ratings ("Elo UX,
BT truth"). The refit weighs by each voter's CURRENT trust tier, so guest →
member conversion retroactively upgrades their history. Auto-refit runs
opportunistically after votes (every 500 events, or 6 h + ≥ 50 events).
Matchmaker mix: 50% informative (close rating, high uncertainty), 25%
placement (battles < 10), 15% dunk, 10% marquee — unfillable types fall back
to informative.

**Guest sessions:** first call mints a `game_users` row + 128-bit token in an
httpOnly `sb_guest` cookie (1 year). The token is echoed in responses and
mirrored to localStorage by the client; `restoreToken` re-establishes a
cleared cookie. Sign-up attaches `logto_sub` to the same row (attachment,
not migration) via `POST /games-attach` (`web/src/lib/games/server/attach.ts`):
the client's Logto API access token is verified server-side (jose against
`{LOGTO_ENDPOINT}/oidc/jwks`, issuer/audience strict, RS256) and the sub is
bound to the device's record — fired automatically by `<GuestAttachment>` in
the root layout once per browser session. If the sub already owns another
record, the guest merges into it losslessly: `game_events` reattributed (so
the next Bradley-Terry refit upgrades them to member weight), `daily_results`
unioned, streaks keep the better values, `user_skin_ratings` replayed from
the unioned battle log, `merged_into` set, and the device cookie switched to
the account's credential. Dev testing without real credentials:
`web/scripts/mock-logto.mjs` serves a mock JWKS and prints a self-signed
token (point `LOGTO_ENDPOINT` at it).

**Tables** (`game_users`, `game_events`, `daily_puzzles`, `daily_results`,
`streaks`, `skin_ratings`, `user_skin_ratings`, `battle_nonces`,
`catalog_skins`/`catalog_meta`) are defined in
`web/src/lib/games/server/db.ts`. `game_events` is append-only and records
`question_asked`, `asset_version`, and `trust_tier` on every row per the
rating-system design; `skin_ratings`/`user_skin_ratings` are derived and can
always be rebuilt from it by a refit.

**Migration path to the Go API:** create the same tables as a Postgres
migration (types map 1:1; JSON payloads → `jsonb`), port the engine modules
(`server/{catalog,daily,guests,streaks,splashdle}.ts`) as Go handlers under
`/api/games/*`, move splash-crop caching to Redis/disk, and turn each server
function into a fetch wrapper — component code doesn't change. Export the
SQLite event log (`game_events`) into Postgres verbatim; nothing is lossy.
