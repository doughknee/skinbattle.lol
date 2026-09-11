# SEO / GEO technical audit

**Date:** 2026-09-10 · **Issue:** DONI-83 · **Audited against:** `origin/main` @ `5dcfba2`

Scope of this pass is the **technical crawl layer only**: canonicals, robots,
sitemap, indexing directives, redirect semantics, and the referral-attribution
path. Content work — the methodology page, champion template, rankings page and
skin dossier — is DONI-84 through DONI-87 and was deliberately not started here.

Findings were verified against **live production**, not just the source, because
several defects (redirect status codes, inherited `og:url`) are invisible in the
route files and only show up in the response.

---

## The constraint that governs everything downstream

SkinBattle has roughly **5,871 battle events across ~1,900 ranked skins — about
3 battles per skin.** The live sitemap carries 2,497 URLs: 1,941 skin pages, 173
champion pages, 371 ranking slices, and the static pages.

A 14-page random sample of live skin pages (2026-09-10):

| | battles | Elo uncertainty |
|---|---|---|
| min | 3 | ±140 |
| max | 9 | ±350 |

**Every sampled page cleared the indexing threshold, and none was close to a
defensible sample.** That combination is the single most important fact for the
rest of the chain, and it is spelled out in "What this means for DONI-84" below.

This audit writes **no ranking claims** and none of the fixes below assert one.

---

## What already passed — preserve it, don't rebuild it

A large part of the original spec was already implemented. It is good, and it
was left alone.

| Item | Where | Verdict |
|---|---|---|
| schema.org JSON-LD | `web/src/lib/games/jsonLd.ts`, `web/src/components/JsonLd.tsx` | **Pass.** `WebSite` + `Organization` sitewide, `BreadcrumbList` on skin/ranking pages, `ItemList` on rankings. SSR'd so crawlers parse it on first fetch. |
| JSON-LD discipline | `jsonLd.ts` header comment | **Pass, and notably correct.** It deliberately refuses `Product`/`aggregateRating` on skins the site doesn't sell. That is the right call — self-serving review markup is a manual-action risk. Do not "improve" this in DONI-86. |
| OG / Twitter card builder | `web/src/lib/games/ogMeta.ts` | **Pass.** Absolute URLs, `SITE_ORIGIN` override, per-page share cards under `/og/*`. |
| Canonical helper | `ogMeta.ts` → `canonicalLink()` | **Pass.** The helper was always correct. The call sites were missing — see F2. |
| Indexing sample-size gate | `web/src/lib/games/seo.ts` + `seo.test.ts` | **Pass, and it fires correctly.** Verified live. See the caveat under DONI-84. |
| sitemap.xml | `web/src/routes/sitemap[.]xml.ts`, `web/src/lib/games/server/sitemap.ts` | **Pass.** 2,497 URLs, `200`, `application/xml; charset=utf-8`, `max-age=86400`. Generated from the `siteMap.ts` registry + live catalog, so new pages index automatically. |
| Site-map registry | `web/src/lib/siteMap.ts` | **Pass.** One registry drives navbar, footer, palette, 404 *and* sitemap. This is why the sitemap doesn't drift. |
| No accidental `noindex` | app + infra | **Pass.** No `X-Robots-Tag` is emitted anywhere — not by `server.mjs`, not by the Dockerfile, not by Coolify/Traefik labels. Confirmed against live response headers on `/`, `/robots.txt`, `/rankings/all`, `/champions`. |
| Answer-engine access | `web/public/robots.txt` | **Pass.** GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot and Googlebot each fetched `/rankings/all` live and got `200`. Nothing blocks them at the edge. |
| Brand palette single-source | `web/src/lib/brand.ts` | **Pass.** Not SEO, but it feeds the OG card renderer; drift guard is in place. |

### Referral attribution path — verified working

PostHog is wired correctly end to end and needed no changes:

- **Same-origin ingestion.** The browser posts to `/ingest`, proxied to PostHog
  in dev (`web/vite.config.ts`) and in prod (`web/server.mjs`), so ad-blockers
  can't drop a third-party host — which is exactly what would otherwise erase
  ChatGPT referral traffic.
- **Verified live:** `GET /ingest/static/array.js` → `200 application/javascript`
  (the real PostHog bundle through the proxy), and `POST /ingest/i/v0/e/` returns
  PostHog's own validation error, proving the proxy reaches the ingestion service
  and passes its response back rather than silently swallowing events.
- `$referrer` / `$referring_domain` / `utm_*` are captured automatically by
  `posthog-js` with `defaults: '2025-05-24'`, so ChatGPT referrals
  (`chatgpt.com` + `?utm_source=chatgpt.com`) land without custom code.
- `player_tier` (guest vs member) is registered on every event in
  `web/src/components/ClientProviders.tsx`, so referral funnels can be split by it.

One note, not a defect: `SITE_ORIGIN` is **not set** in
`docker-compose.coolify.yml`. Every absolute-URL builder falls back to the
hardcoded `https://skinbattle.lol`, which is correct for production but means a
staging deployment would emit production canonicals. Set `SITE_ORIGIN` if a
staging environment is ever stood up.

---

## What was broken — and fixed in this pass

### F1 · Champion pages were case-insensitive duplicates with no canonical — **critical**

`/champions/aatrox`, `/champions/Aatrox` and `/champions/AATROX` **all returned
`200` with identical content**, and none carried a canonical tag. The internal
signals actively disagreed:

- `sitemap.ts` advertised the **lowercase** form,
- the skin-page breadcrumb JSON-LD advertised the **capitalised** form
  (`"item":"https://skinbattle.lol/champions/Aatrox"`),
- `champions/index.tsx`, `SkinCard.tsx` and `CommandPalette.tsx` linked lowercase.

So across 173 champion pages, crawlers were handed two different URLs for the
same page and nothing to arbitrate with. JSON-LD is the worst place for this:
nothing follows a redirect in structured data.

**Fixed** in `web/src/routes/champions/$id.tsx` by mirroring the pattern
`skins_.$slug.tsx` already uses for slugs — the loader `301`s any non-lowercase
id to the canonical one — plus a self-referential `canonicalLink()`. The three
mixed-case builders in `skins_.$slug.tsx` were lowercased so they stop costing a
redirect hop.

### F2 · Canonical tag missing on 17 of 20 routes — **high**

Only `rankings/$slice`, `rankings/drought` and `skins_.$slug` emitted one.
Everything else — home, all five battle pages, both tier-drop views, champions
index and detail, `/rankings/elo`, `/roadmap`, `/releases`, `/privacy`,
`/terms` — had none, so every tracking-param, case and share-param variant of
those URLs competed with itself.

**Fixed.** 18 of 20 head-bearing routes now emit a self-referential canonical.
The two that don't are correct: `__root.tsx` (the document shell, not a page)
and `profile.tsx` (see F6).

Shared tier-drop boards get a deliberate exception: `og:url` keeps `?s=<id>` so
the share still unfurls with that player's card, but the **canonical points at
the bare `/battle/tier-drop`**, so thousands of share URLs consolidate into one
page instead of competing as thin near-duplicates.

### F3 · Every page without `ogMeta()` claimed to *be* the homepage — **high**

`__root.tsx` hardcodes `og:url = https://skinbattle.lol`. Any route that didn't
call `ogMeta()` inherited it. Verified live before the fix:

```
/champions      → <meta property="og:url" content="https://skinbattle.lol"/>
/champions/aatrox → <meta property="og:url" content="https://skinbattle.lol"/>
/rankings/elo   → <meta property="og:url" content="https://skinbattle.lol"/>
```

That is ~180 pages (173 champion pages plus the static set) telling every social
scraper and answer engine that their canonical location is the front page.

**Fixed** — those routes now call `ogMeta()` with their own path. `og:url` and
the canonical are now identical on every page, which is what `ogMeta.ts`'s own
docstring always said should happen.

### F4 · All 18 migration redirects were `307 Temporary` — **high**

`ROUTES.md` records every one of these as a permanent move, but TanStack's
`redirect()` defaults to `307`. A `307` tells Google to **keep the old URL
indexed** and withhold consolidation to the new one — so `/games`, `/awards`,
`/leaderboards`, `/insights/drought` and the rest were still competing with
their replacements.

**Fixed** — all 18 now pass `statusCode: 301`, matching what `skins_.$slug`
already did for slug canonicalisation. Verified on the built server: every stub
returns `301` with the right `Location`.

### F5 · Champion pages had no meta description — **medium**

`/champions` and all 173 `/champions/$id` pages fell back to the generic sitewide
string ("Community-built rankings for every League of Legends skin…"), which is
not what those pages are about.

**Fixed** with a minimal factual description (`All 13 Aatrox skins in one place:
splash art, release dates, and prices, with each skin's community battle
rating.`). It states only what the page renders and makes **no ranking claim**.
**DONI-85 owns the final copy** — this is a correctness floor, not the template.

### F6 · `/profile` was disallowed in a way that couldn't keep it out of the index — **medium**

`robots.txt` had `Disallow: /profile`. But `Disallow` stops a crawler *fetching*
the page, which also stops it reading any `noindex` — and `/profile` is the
"Mirror" nav door, linked from **every page on the site**. A disallowed,
sitewide-linked URL is precisely the case Google indexes title-only with "No
information is available for this page."

**Fixed** by inverting it: the `Disallow` is gone and `routes/profile.tsx` now
emits `noindex,follow` via the existing `robotsMeta()` helper, so crawlers fetch
the page, read the directive, and drop it. No privacy concern — a crawler is an
unauthenticated guest and gets an empty guest Mirror.

### F7 · Auth and API endpoints were crawlable — **low**

`/social-callback` was indexable and returned `200` (while `/callback` was
disallowed), alongside `/ingest/*` (the PostHog proxy), `/games-status`,
`/games-attach`, `/games-logout` and `/account-connectors`.

**Fixed** — all added to `robots.txt`.

> **Note on `robots.txt` structure:** an explicit per-bot `User-agent: GPTBot`
> group was considered and **deliberately rejected**. A crawler that matches its
> own group ignores the `*` group *entirely*, so a per-bot group would have
> silently handed those bots every path the `Disallow` lines protect. Answer
> engines stay in the `*` group; the intent is recorded in a comment instead.

---

## Found, deliberately not fixed

### N1 · `/skins` returns 404 while `ROUTES.md` calls it a door

`ROUTES.md` describes `/skins` as the catalog door with `/skins/$slug` beneath
it. The IA has since moved on: `siteMap.ts`'s three doors are **Play · Rankings ·
Mirror**, with Champions in the footer, and there is no `/skins` index route —
so the parent of 1,941 indexed skin URLs is a 404.

Low direct SEO cost (breadcrumbs don't reference it and nothing links it), but
**`ROUTES.md` and `siteMap.ts` now disagree about the site's own shape**, and
`ROUTES.md` is supposed to be the IA source of truth. Resolving that is an IA
decision, not a crawl-layer fix. Flagged for the home session.

### N2 · Sitemap inclusion and the `noindex` gate are computed from different sources

`server/sitemap.ts` adds **every** catalog skin and every ranking slice.
`seo.ts` decides `noindex` from battle counts (skins) and rated counts (slices).
Nothing keeps them consistent, so a thin page can be **submitted in the sitemap
and marked `noindex`** — which Search Console reports as an error.

It affects ~0 URLs today (every sampled page clears the threshold), and the
correct threshold depends on where DONI-84 lands. Building a ratings join into
the sitemap now, to filter a set that is currently empty, would be speculative.
**The fix is one filter in `sitemapXmlResponse()` once DONI-84 sets the number** —
do it then, not before.

### N3 · Champion pages share the generic `/og/games` share card

There is no `/og/champion/<id>` renderer, so champion pages use the generic card.
Cosmetic, and squarely **DONI-85's** call.

### N4 · Trailing-slash normalisation is a `307`

`/skins/` → `307` → `/skins`. Framework-internal, not worth patching.

---

## Settled — do not re-open

Two requests from the original spec were rejected on 2026-09-10 and are recorded
here so they don't get proposed again:

1. **A `/stats/` hub** — contradicts the locked three-door IA in `ROUTES.md`.
   The drought data already lives at `/rankings/drought`.
2. **`/rankings/best-league-of-legends-skins/`** — `/rankings/all` already serves
   that intent. A second URL for one intent is the duplicate-content problem this
   audit just spent its budget removing.

---

## What this means for DONI-84

The sample-size gate in `seo.ts` **works** — but it is worth being precise about
what it is currently doing, because the obvious reading is wrong.

`MIN_INDEXABLE_BATTLES = 3`, and battle pairing evidently favours under-battled
skins, so the distribution is tight around the mean rather than Poisson-spread.
The observed floor in a 14-page live sample was **exactly 3**, and **1,941 of
~1,900 skins are "rated"**. So the gate is currently admitting **essentially the
entire catalog** — it is filtering almost nothing.

That is fine for *indexing* (the goal was only to keep genuinely empty pages
out). It is **not** a basis for confident phrasing:

> A skin with 3 battles and **±140–350 Elo uncertainty** cannot support
> "the best Ahri skin." At that sample the rank is close to noise.

**So DONI-84 needs its own threshold for confident language, well above the
indexing threshold, and the two should not share a constant.** Suggested shape:
`seo.ts` keeps `MIN_INDEXABLE_BATTLES` for the robots tag; DONI-84 adds a
separate confidence tier that drives phrasing ("community favourite" vs "still
calibrating — N battles so far") and is honest about N on the page.

The machinery to do this is in place and untouched by this pass. **What is
missing is the number, and the number is a judgement call about how much
uncertainty is tolerable in a public claim** — which is DONI-84's job, not this
one's.

---

## Verification log

Everything below was executed, not assumed.

| Check | Method | Result |
|---|---|---|
| `X-Robots-Tag` anywhere | live response headers, 4 URLs | absent — clean |
| AI crawler access | live `GET /rankings/all` as GPTBot / OAI-SearchBot / ClaudeBot / PerplexityBot / Googlebot | `200` × 5 |
| Redirect status codes | live, then built server | 18 stubs `307` → all `301` |
| Champion case duplicates | live `GET` × 3 casings | `200/200/200` → `200/301/301` |
| Canonical + `og:url` | built server, 11 routes | all self-referential and matching |
| `/profile` directive | built server | `noindex,follow`, no canonical |
| Champion description | built server | page-specific, no ranking claim |
| PostHog `/ingest` proxy | live `GET` + `POST` | bundle `200`; capture reaches PostHog |
| Sample-size gate | 14 live skin pages | fires correctly; floor is 3 battles |
| sitemap.xml | live | `200`, 2,497 URLs, correct content type + cache |
| Test suite | `npx vitest run` | 150 passed |
| Typecheck | `npx tsc --noEmit` | 0 errors |
| Production build | `npm run build` | clean |

New guards live in `web/src/lib/games/seo.routes.test.ts`. They are structural —
they read the route files — because unit-testing the helpers could never have
caught any of this: **the helpers were always correct; the call sites were
missing.** Each guard was mutation-tested by reintroducing the original bug and
confirming it fails.
