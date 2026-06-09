# Deploying skinbattle.lol on Coolify

Five services: **postgres**, **redis**, **logto**, **api**, **web**. Postgres/Redis/Logto
are one-click resources in Coolify; `api` and `web` deploy from this repo's Dockerfiles.

## 0. Prerequisites
- A Coolify instance with a project created.
- A domain (e.g. `skinbattle.lol`) and a subdomain for Logto (e.g. `auth.skinbattle.lol`).

## 1. Postgres
- Add a **PostgreSQL** resource. Note its internal connection string.
- The app and Logto can share the instance but need **separate databases** (`skinbattle`
  and `logto`). Create the `logto` database (Coolify DB terminal or `createdb logto`).

## 2. Redis
- Add a **Redis** resource. Note its internal URL (e.g. `redis://default:pass@redis:6379/0`).

## 3. Logto
- Deploy Logto (image `svhd/logto:latest`) as a service.
  - `DB_URL` → the `logto` database connection string.
  - `ENDPOINT` → `https://auth.skinbattle.lol`
  - `TRUST_PROXY_HEADER=1`
  - First boot: run `npm run cli db seed -- --swe` once (entrypoint in `docker-compose.yml`
    shows the pattern), then `npm start`.
  - Expose port 3001 (OIDC) behind `auth.skinbattle.lol`; 3002 is the admin console.
- In the **admin console**:
  1. **Applications → Create → Single Page App**. Name it "skinbattle web".
     - Redirect URI: `https://skinbattle.lol/callback`
     - Post sign-out redirect URI: `https://skinbattle.lol`
     - CORS allowed origins: `https://skinbattle.lol`
     - Copy the **App ID** → this is `VITE_LOGTO_APP_ID`.
  2. **API Resources → Create**. Identifier: `https://api.skinbattle.lol`
     (this exact string is `LOGTO_AUDIENCE` and `VITE_LOGTO_RESOURCE`).
  3. *(Optional, for account deletion)* **Applications → Create → Machine-to-Machine**.
     Grant it the **Logto Management API** role. Copy App ID/Secret →
     `LOGTO_M2M_APP_ID` / `LOGTO_M2M_APP_SECRET` on the API service.

## 4. API service (`/api`)
- New resource → **Dockerfile / Git**, base directory `api`.
- Env vars:
  ```
  DATABASE_URL=postgres://...@postgres:5432/skinbattle?sslmode=disable
  REDIS_URL=redis://...@redis:6379/0
  LOGTO_ENDPOINT=https://auth.skinbattle.lol
  LOGTO_AUDIENCE=https://api.skinbattle.lol
  CORS_ORIGIN=https://skinbattle.lol
  PORT=8080
  LOGTO_M2M_APP_ID=...        # optional
  LOGTO_M2M_APP_SECRET=...    # optional
  ```
- Health check path: `/healthz`. Migrations apply automatically on boot.
- Keep it on the internal network; it does not need a public domain if `web` proxies it.

## 5. Web service (`/web`)
- New resource → **Dockerfile / Git**, base directory `web`. Domain: `skinbattle.lol`.
- Env vars:
  ```
  API_INTERNAL_URL=http://api:8080        # SSR → API (internal)
  VITE_API_URL=/api                       # browser → same-origin proxy
  VITE_LOGTO_ENDPOINT=https://auth.skinbattle.lol
  VITE_LOGTO_APP_ID=<from step 3>
  VITE_LOGTO_RESOURCE=https://api.skinbattle.lol
  PORT=3000
  ```
- **Same-origin proxy:** route `https://skinbattle.lol/api/*` to the `api` service.
  Configure this in Coolify's proxy (Traefik label / additional domain rule) so the
  browser's `/api` calls reach Go. Alternatively give the API its own domain
  (`api.skinbattle.lol`), set `VITE_API_URL=https://api.skinbattle.lol/api`, and keep
  `CORS_ORIGIN=https://skinbattle.lol`.

## 6. Seed the data
After the API is up (tables exist), run the importer once:
```bash
cd seed && npm install
DATABASE_URL=postgres://...@<host>:5432/skinbattle npm run import
```
Run it from anywhere that can reach Postgres (locally over a tunnel, or a one-off
Coolify command).

## 7. Migrating existing users to Logto
Existing accounts live in the old `users` table with bcrypt `password_hash` values
(`bcryptjs`, standard bcrypt — Logto-compatible).

1. **Test one user first.** Export one row and import it into Logto via the Management
   API (`POST /api/users`) with `passwordDigest` + `passwordAlgorithm: "bcrypt"`.
   Verify that user can sign in through Logto before bulk-migrating.
2. Bulk import the rest the same way.
3. On first sign-in, the API's JIT provisioning **claims the legacy local row** by
   matching email and stamping its `logto_id` (see `store.UpsertUser`), so existing
   votes stay attached.
4. After everyone has a `logto_id`, drop the legacy auth columns (commented migration
   at the bottom of `api/migrations/0002_logto.sql`).

## Cutover & rollback
- Bring the new stack up on a staging domain, smoke-test (vote caps, leaderboards,
  auth, account delete), then point DNS at the `web` service.
- The original Next.js app at the repo root remains deployable as an instant rollback
  until you're confident, then decommission it.
```
