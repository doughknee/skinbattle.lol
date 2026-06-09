# skinbattle.lol

A League of Legends skin voting site. **Rewritten** from a Next.js monolith into a
cleanly separated stack:

| Part | Stack | Location |
|---|---|---|
| Frontend | TanStack Start (SSR) · Vite · React 19 · Tailwind 4 | [`web/`](web/) |
| API | Go · chi · pgx · go-redis · go-oidc | [`api/`](api/) |
| Auth | Logto (OIDC, self-hosted) | external service |
| Data | PostgreSQL + Redis | — |
| Seeder | Node · Riot Data Dragon importer | [`seed/`](seed/) |

The API contract both halves implement is [`CONTRACT.md`](CONTRACT.md). The migration
rationale and phasing is [`MIGRATION.md`](MIGRATION.md). Deployment (Coolify + Logto +
user migration) is [`DEPLOY.md`](DEPLOY.md).

> The original Next.js app still lives at the repo root (`src/`, root `package.json`)
> and is kept as an instant rollback until the new stack is cut over.

## Quick start (local, Docker)

```bash
cp .env.example .env          # fill in VITE_LOGTO_APP_ID after Logto setup
docker compose up --build     # postgres, redis, logto, api, web
```

- Web: http://localhost:3000
- API: http://localhost:8080 (health: `/healthz`)
- Logto admin console: http://localhost:3002 (first visit creates the admin account)

Then configure Logto (see [`DEPLOY.md`](DEPLOY.md) §Logto), set `VITE_LOGTO_APP_ID`,
restart `web`, and seed the data:

```bash
cd seed && npm install
DATABASE_URL=postgres://skinbattle:skinbattle@localhost:5432/skinbattle npm run import
```

## Running pieces individually (without Docker)

**API** (needs Go 1.23+, Postgres, Redis):
```bash
cd api
export DATABASE_URL=... REDIS_URL=... LOGTO_ENDPOINT=... LOGTO_AUDIENCE=...
go mod tidy
go run ./cmd/server
```
Migrations run automatically on startup (embedded; tracked in `schema_migrations`).

**Web** (needs Node 22+):
```bash
cd web
npm install
npm run dev      # Vite dev server
npm run build && npm start   # production SSR
```

## Architecture notes

- The frontend reverse-proxies `/api/*` to the Go service (same-origin) in production
  to avoid cross-site cookie/CORS friction; in dev it can hit the API directly.
- Auth: the browser gets a Logto **access token** (audience = the API resource) and
  sends it as a Bearer token. The Go API validates it against Logto's JWKS and
  **JIT-provisions** a local `users` row keyed by the Logto `sub`. The local row owns
  app data (votes/stats); Logto owns identity.
- Redis caches champion/skins reads and maintains `lb:stars` / `lb:x` leaderboards for
  the awards page (with SQL fallback).
- Data access in the Go API is hand-written `pgx` (not sqlc — see MIGRATION.md note).
