# skinbattle.lol — Migration Plan

**Goal:** Better architecture — a cleanly separated frontend, API, and cache.
**Target stack:** TanStack Start (Vite + Tailwind 4) · Go API · PostgreSQL · Redis · Logto (auth)
**Deploy target:** Coolify (self-hosted, Docker)

---

## 1. Where we are today

| Layer | Current | Notes |
|---|---|---|
| Frontend | Next.js 15 App Router, React 19, Tailwind 4 | Already modern; mix of server + client components |
| API | Next.js route handlers (`src/app/api/**`) | 13 routes, raw `pg` SQL, transactional vote logic |
| Auth | `next-auth` v4 (JWT, Credentials), `bcryptjs`, Resend emails | register / login / verify / forgot / reset / delete |
| DB | PostgreSQL via `pg` | Raw parameterized SQL, no ORM |
| Seed | `backend/` Node script | One-shot import from Riot Data Dragon |

### Data model (keep as-is)
- `champions` (id, lore, key, blurb, title)
- `skins` (id, champion_id, num, name, chromas, splash_url, total_votes, total_stars, total_x)
- `users` (id, email, username, password_hash, is_verified, …)
- `user_skin_votes` (skin_id, user_id, vote ∈ {-1,0,1}, star bool, x bool, voted_at)

### Business rules to preserve
- A user gets **max 3 star votes** and **max 3 X votes** total (across all skins).
- Vote write recomputes `skins` aggregates in a single transaction.
- Awards page = top 10 by `total_stars`, top 10 by `total_x`, plus all skins; logged-in users see their own vote joined in.

---

## 2. Target architecture

```
                 ┌─────────────────────────┐
   browser ────► │ TanStack Start (SSR)     │  Vite + Tailwind 4
                 │  - route loaders         │
                 │  - Logto React SDK       │
                 └───────────┬──────────────┘
                             │ fetch + Bearer JWT
                             ▼
                 ┌─────────────────────────┐
                 │ Go API (chi/echo)        │  pgx + sqlc + go-redis
                 │  - validates Logto JWT   │
                 │  - business logic        │
                 └─────┬──────────────┬─────┘
                       ▼              ▼
                 ┌──────────┐   ┌──────────┐      ┌──────────┐
                 │ Postgres │   │  Redis   │      │  Logto   │ ◄── login/verify/reset
                 └──────────┘   └──────────┘      └──────────┘
```

**Redis roles:**
- Cache champion list + champion detail (Data Dragon data, rarely changes) — biggest read win.
- Leaderboards via sorted sets (`ZADD` on star/x counts) for the awards page top-10s.
- Per-user rate limiting on the vote endpoint.

**Repo layout (monorepo):**
```
/web      → TanStack Start app
/api      → Go service (cmd/, internal/, migrations/, queries/ for sqlc)
/seed     → Riot Data Dragon importer (port of backend/, or keep Node)
docker-compose.yml   → local dev (postgres, redis, logto, api, web)
```

---

## 3. Phased plan

### Phase 0 — Scaffolding & decisions
- Create monorepo structure; `docker-compose.yml` for local Postgres + Redis + Logto.
- Stand up Logto locally; create an Application (SPA/native) + an API resource for the Go API audience.
- Pick Go router (recommend **chi** — stdlib-friendly) and **sqlc** (generates typed Go from your existing SQL — near-direct port).
- Set up `golang-migrate`/`goose` migrations capturing the current schema.

### Phase 1 — Go API: data layer + read endpoints (no auth yet)
- `pgx` pool + config from env (mirror current `DB_*` vars).
- Port read endpoints: `GET /champions`, `GET /champions/:id`, `GET /skins`, `GET /awards`.
- Add Redis caching for champions/skins.
- Verify parity against current Next responses.

### Phase 2 — Auth via Logto
- Go middleware: validate Logto JWT via JWKS, extract user id → map to local `users.id`.
- Migrate existing users into Logto via Management API (import email/username + **bcrypt hash** — compatible).
- Decide: keep local `users` table as source of truth for app data, keyed by Logto `sub` (recommended), and drop password/verify columns once cut over.
- Retire `next-auth` routes + Resend flows (now Logto's job).

### Phase 3 — Go API: write endpoints
- `POST /votes` — port the transactional logic verbatim: upsert vote, enforce 3-star/3-X caps, recompute + persist aggregates.
- Update Redis leaderboard sorted sets on write.
- `GET /user/stats`, `GET /user/votes`, account delete (delete in Logto + local rows).

### Phase 4 — Frontend: TanStack Start
- Scaffold TanStack Start + Vite + Tailwind 4; port `globals.css` + the custom theme tokens (`gold2`, `grey1`, `gradientTop`, etc.).
- Port components 1:1 (Tailwind classes carry over): Navbar, SkinCard, ChampionSearch, Dropdown, UserStats, AccountButton, etc.
- Replace client-side `useEffect` fetches with **TanStack Router loaders** hitting the Go API (champion detail, awards, etc.).
- Integrate Logto React SDK for login/session; attach access token to API calls.
- Port pages: home, champions, champions/:id, awards, account, games, user/votes (auth pages now redirect to Logto).

### Phase 5 — Deploy to Coolify
- Postgres + Redis + Logto as Coolify services.
- Go API: Dockerfile (multi-stage, scratch/distroless), env vars, internal networking to PG/Redis/Logto.
- Web: TanStack Start as a Node service (or static if SPA mode).
- Domains + TLS; CORS or same-origin reverse-proxy (`/api/*` → Go) to avoid cross-site cookie friction.

### Phase 6 — Cutover
- Run seed importer against prod DB.
- Smoke-test all flows (vote caps, leaderboards, auth, reset).
- Point DNS; keep the Next.js app as instant rollback until confident, then decommission.

---

## 4. Effort & risk

| Area | Difficulty | Why |
|---|---|---|
| DB layer → Go (sqlc) | Low | SQL already clean + parameterized |
| Read endpoints + Redis | Low | Straightforward |
| Vote write logic | Low–Med | Port transaction faithfully; add Redis leaderboard |
| Auth (with Logto) | **Low–Med** | Logto removes the hard flows; main task is user import + JWT middleware |
| Frontend port | Med | Tailwind 1:1; rework routing/data-loading from Next → TanStack |
| Coolify deploy | Low–Med | 5 services, networking, TLS, CORS/proxy |

**Top risks / gotchas**
- **User migration to Logto** — verify bcrypt import preserves logins for existing accounts (test with a real hash first).
- **Cookie/CORS** — prefer same-origin reverse proxy (`/api`) over cross-origin to avoid SameSite headaches.
- **SSR vs SPA** — TanStack Start SSR is nicer for SEO on champion pages but adds a Node runtime to deploy; SPA is simpler. Decide in Phase 0.
- **Aggregate denormalization** — `skins.total_*` is already denormalized; keep it as the durable source and treat Redis as a cache/leaderboard, not source of truth.

---

## 5. Decisions (locked)
1. **Auth: Logto** (self-hosted on Coolify). Go API validates Logto JWTs; existing users imported with bcrypt hashes.
2. **Rendering: TanStack Start SSR.** Server-rendered champion/awards pages for SEO + first paint; deploy as a Node service on Coolify.
3. **User data: keep local `users` table, keyed by Logto `sub`.** Logto owns auth; local row owns app data (votes, stats). Drop `password_hash`/`is_verified` columns post-cutover.
4. **Queries: hand-written `pgx`** (repository layer in `api/internal/store`). *Deviation from the original sqlc plan:* sqlc requires running `sqlc generate`, and the Go toolchain/sqlc weren't available in the build environment, so queries were written directly against pgx to keep the service buildable with zero codegen step. Clean and parameterized; sqlc can be adopted later without changing the handler/contract layer.

**Build status:** Both halves scaffolded. Frontend `npm install` + `npm run build` verified green (SSR server boots). Go API written + reviewed for compile-correctness but not compiled locally (no Go toolchain); it builds via its Dockerfile (`go mod tidy` generates go.sum at build time).

### Still open
- Same-origin reverse proxy vs. cross-origin API (lean: same-origin `/api/*`).
- Keep seed importer in Node vs. port to Go (low stakes; runs rarely).
