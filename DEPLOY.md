# Deploying skinbattle.lol on Coolify

Five services: **postgres**, **redis**, **logto**, **api**, **web**.

There are two ways to deploy. **Option A (recommended)** brings the whole stack up from
one Docker Compose file. **Option B** wires up five individual Coolify resources by hand.

---

## Option A — One-shot Docker Compose (recommended)

Uses [`docker-compose.coolify.yml`](docker-compose.coolify.yml), which auto-generates all
domains and passwords via Coolify's `SERVICE_*` magic variables.

1. **New Resource → Docker Compose**, from this Git repo (`doughknee/skinbattle.lol`,
   branch `main`). Set the compose file to `docker-compose.coolify.yml`.
2. **Deploy.** Coolify generates domains for `web`, `api`, and `logto` (OIDC + admin), and
   random passwords for Postgres/Redis. Migrations run on the API's first boot.
3. **Configure Logto:** open the generated Logto **admin** domain → create:
   - a **Single Page App**: redirect URI `<web-url>/callback`, post-logout `<web-url>`,
     CORS origin `<web-url>`. Copy its **App ID**.
   - an **API Resource** with identifier matching `LOGTO_AUDIENCE`
     (default `https://api.skinbattle.lol`).
4. **Set `LOGTO_APP_ID`** in the resource's environment variables → **restart the `web`
   service**. No rebuild needed — the frontend reads Logto config at runtime.
   (Optionally set `LOGTO_AUDIENCE` if you want a different resource identifier; set it on
   the same env screen so both `api` and `web` pick it up.)
5. **Seed the data** (see step 6 below): run the importer against the Postgres service once.
6. **Migrate users** into Logto (see step 7 below).

Notes:
- The browser calls the API cross-origin at its generated domain; the API's `CORS_ORIGIN`
  is wired to the web domain automatically. Want a single domain instead? Give `web` your
  apex domain and add a Coolify proxy rule sending `/api/*` to the `api` service, then set
  `PUBLIC_API_URL=/api` on `web`.
- `LOGTO_APP_ID` is the only value you must paste by hand; everything else is generated.

---

## Option B — Individual resources

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
  3. *(Optional, for account deletion & username changes)* **Applications → Create →
     Machine-to-Machine**. Grant it the **Logto Management API** role. Copy App ID/Secret →
     `LOGTO_M2M_APP_ID` / `LOGTO_M2M_APP_SECRET` on the API service. Without these,
     account deletion only removes local data and `PATCH /api/me` rejects username
     changes with a 503 (avatar changes still work — they're local-only).

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

## Sign-in & security features (Logto console checklist)

Password change, email change, and social-connector linking are **native** on the app's
Account tab (`/profile?tab=account`) — `SecuritySettings.tsx` talks to Logto's Account
API (`{LOGTO_ENDPOINT}/api/my-account` + `/api/verifications`, CORS-open by design)
using the opaque access token. Passkeys and 2-step verification still link out to the
hosted Account Center security page at **`{LOGTO_ENDPOINT}/account/security`**. Note the
path: the bare `/account` base renders Logto's deliberate not-found page (as of v1.40
the security page is the Account Center's only released page), so links must target
`/account/security`.

Version requirements (the compose files pin `svhd/logto`; if you bump, stay ≥ these):
- **≥ v1.38** — passkey sign-in (first-class WebAuthn login).
- **≥ v1.39** — Account Center security page + Account API (both gated by the same
  Account Center settings).

Console toggles (all under the generated Logto **admin** domain):

1. **Account Center settings — required for the app's native security section.**
   **Console → Sign-in & account → Account center** → enable, and set at least
   **email**, **password**, and **social** to *Edit*. The same settings drive both the
   Account API (which the app's security section calls) and the hosted page; if the
   Account API is unreachable or disabled the app falls back to a plain link-out.
   Equivalent Management API call (M2M token with the Management API role):
   ```
   PATCH {LOGTO_ENDPOINT}/api/account-center
   {"enabled": true, "fields": {"email": "Edit", "password": "Edit", "social": "Edit",
    "username": "Edit", "name": "Off", "avatar": "Off", "profile": "Off",
    "phone": "Off", "mfa": "Edit", "customData": "Off"}}
   ```
   If you enable the Account Center **delete account** entry, point its delete-account
   URL at `https://skinbattle.lol/profile?tab=account` so deletions run through the app
   (which removes local votes/stats *and* the Logto user).
2. **Social connector redirect URIs — required for "Connected accounts".**
   The native link flow sends the provider back to **`https://skinbattle.lol/social-callback`**.
   That exact URL must be registered with each provider:
   - **Discord** developer portal → your app → OAuth2 → Redirects → add
     `https://skinbattle.lol/social-callback` (keep the existing
     `https://auth.skinbattle.lol/callback/<connector-id>` used by sign-in).
   - **Google** Cloud console → OAuth client → Authorized redirect URIs → add the same.
   The hosted Account Center's own linking flow uses yet another redirect —
   `https://auth.skinbattle.lol/account/callback/social/<connector-id>` — which is why
   linking from the hosted page fails with "invalid uri" unless you also register that.
   With the native flow in the app this is optional.
3. **Email connector — required for email change & forgot password.** The native email
   flow and identity verification send codes through Logto's email connector
   (**Console → Connectors → Email and SMS connectors** — SMTP or a provider). Without
   one, "change email" and "email me a code" fail at the send step.
4. **Forgot password**: with the email connector in place, **Console → Sign-in &
   account → Sign-up and sign-in** → keep **Password** enabled as a sign-in method and
   enable **Email verification code** under **Forgot password**. The "Forgot password?"
   link then appears on the hosted sign-in page automatically.
5. **Passkeys (WebAuthn)** — two independent toggles:
   - *Passkey sign-in* (passwordless login): **Console → Sign-in & account → Sign-up and
     sign-in** → enable **Passkey** ("Continue with passkey" button, optional autofill).
   - *Passkey as 2-step verification*: **Console → Multi-factor auth** → enable
     **Passkey (WebAuthn)**.
   WebAuthn requires the Logto endpoint to be served over **HTTPS on a stable domain**
   (the passkey is bound to e.g. `auth.skinbattle.lol` — changing the auth domain later
   orphans enrolled passkeys). `localhost` works for dev.
6. **Sign-in page branding**: **Console → Sign-in & account → Sign-in experience →
   Branding** → set the app logo to **`https://skinbattle.lol/icon-512.png`**
   (512×512; `https://skinbattle.lol/favicon.svg` also works and scales cleanly) and
   the brand color to **`#c8aa6e`** (the site's gold). `logto-signin-custom.css` at the
   repo root is the custom-CSS source of truth for the rest of the hextech theme — it
   currently *replaces* the logo with a SKINBATTLE.LOL wordmark, so drop that block if
   you'd rather show the image logo you set here.

Heads-up after deploying the Identities scope change (`web/src/lib/logto.ts`): scopes
are baked into each user's grant at sign-in, so **existing sessions must sign out and
back in** before the Connected-accounts section works; the app shows a hint until then.

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
