# The voter funnel — where new voters fail to arrive

Companion to [`seo-audit.md`](./seo-audit.md). That audit made the site
answerable; this one asks why the answers are still provisional.

> ## Every number in this document is blank, on purpose
>
> **PostHog could not be queried from the session that wrote this.** Capture
> works — DONI-83 verified the ingestion path end to end and ChatGPT referrals
> are arriving — but querying needs a *personal* API key (`phx_…`) plus a
> project id, and production only carries the **public project token**, which is
> write-only. No `.env` file, no PostHog CLI, no PostHog MCP connector, no key
> in the shell. See the verification log at the bottom for exactly what was
> checked.
>
> So this is a **query sheet with honest blanks**, not an analysis with
> plausible numbers. Every event name, property name, path and threshold below
> was read out of the code and is cited with a `file:line`. Fill the blanks by
> running the queries in [The queries](#the-queries); nothing needs re-deriving.
>
> One section does *not* need PostHog: **[Q7](#q7--ground-truth--no-posthog-needed)**
> runs against `games.db` and answers "how many skins are one voter short of
> settled?" directly. Run that one first — it is the scoreboard this issue is
> actually about.

---

## The constraint that governs everything downstream

A placing is **settled** only when both bars clear
(`web/src/lib/games/answer.ts:150`):

| Bar | Value | Derivation |
|---|---|---|
| Band | ±100 Elo | `MAX_CONFIDENT_UNCERTAINTY` (`answer.ts:31`) |
| Distinct voters | **3.0 weighted** | `MIN_CONFIDENT_VOTERS = ceil(weightedBattlesFor(100) / VOTER_SKIN_CAP)` = `ceil(13 / 6)` = 3 (`answer.ts:56`) |

A signed-out visitor counts **0.5** (`GUEST_VOTER_WEIGHT`, `answer.ts:72`).
These are derived, not tuned — 350 ÷ 100, squared, over the 6-battle anti-farm
cap. **Nothing below proposes moving them.**

Two properties of the floor decide where to look:

1. **It is per-skin, counted over heads, not votes.**
   `skinVoters(db, skinId)` (`web/src/lib/games/server/ratings.ts:364`) counts
   `DISTINCT user_id` across `quick-battle/battle_voted` **UNION**
   `tier-list/tier_submitted` rows that name that skin. Battle *volume* on a
   skin and *voter count* on a skin are independent numbers, which is exactly
   why the global leader can hold 90 battles and 5 voters.
2. **A vote only helps the skins it names.** Quick Battle names two skins. A
   Tier Drop submission names *every skin on the board* — so one person ranking
   one champion's wardrobe becomes a distinct voter for all of them at once.

That second point is the whole shape of this problem, and it is why the ranked
proposals at the end are about **where a vote lands**, not about how many votes
there are.

---

## What is actually instrumented

Read from the code, not assumed. Every `posthog.capture()` call site in the
repo:

| Event | Call site | Properties |
|---|---|---|
| `battle_vote_submitted` | `web/src/routes/battle/index.tsx:1212` | `winner_skin_id`, `winner_skin_name`, `loser_skin_name`, `elo_delta`, `winner_rank`, `agreement_pct`, **`session_picks`**, `player_tier`, `battle_mode`, `streak` |
| `battle_reign_best` | `web/src/routes/battle/index.tsx:1314` | `streak` |
| `skin_page_viewed` | `web/src/routes/skins_.$slug.tsx:158` | `skin_id`, `skin_name`, `champion_id`, `champion_name`, `elo_rank`, `battles` |
| `mirror_viewed` | `web/src/routes/profile.tsx:145` | `skins_ranked`, `total_battles` |
| `guest_account_attached` | `web/src/components/GuestAttachment.tsx:66` | **`outcome`** ∈ `attached` \| `merged` \| `switched` \| `already` |
| `user_signed_in` | `web/src/routes/callback.tsx:55` | — |
| `user_signed_out` | `web/src/lib/useAuth.ts:165` | — |
| `game_result_shared` | `web/src/components/games/GuessKit.tsx:569` | daily-puzzle share |
| `chromavision_guess_submitted` / `chromavision_completed` | `web/src/routes/battle/chroma-vision.tsx:131,140` | daily puzzle |
| `price_check_guess_submitted` / `price_check_completed` / `price_check_result_shared` | `web/src/routes/battle/price-point.tsx:201,210,232` | daily puzzle |
| `splashdle_guess_submitted` / `splashdle_completed` | `web/src/routes/battle/splashdle.tsx:132,141` | daily puzzle |

**Super-properties on every event** — registered in
`web/src/components/ClientProviders.tsx:66`, so they are *event* properties and
survive the absence of a person profile (this matters, see below):

- `player_tier` — `'guest'` \| `'member'`
- `is_authenticated` — boolean

**Autocaptured** (no code): `$pageview`, `$pageleave`, `$autocapture`,
`$rageclick`, `$exception`, and `utm_*` / `$referrer` / `$referring_domain`.

Two properties carry more weight than their size suggests:

- **`session_picks`** — the running count of picks in this visit, so
  `session_picks = 1` is *the first vote of a session*. Exactly the boundary
  stage 3 of the funnel needs, already captured.
- **`guest_account_attached.outcome = 'merged'`** — a guest **who already had
  votes** signed in, and the refit re-weighted that whole history from 0.5 to
  1.0. This is the one event that directly moves the voter floor. `'attached'`
  is the same sign-in with no prior votes to fold.

### Two configuration facts that decide how every query must be written

`ClientProviders.tsx:41` passes `defaults: '2025-05-24'`. Both values below were
read out of the shipped bundle (`web/node_modules/posthog-js/dist/array.full.js`,
v1.386.6), not recalled:

1. **`capture_pageview: 'history_change'`** — client-side route changes *do*
   emit `$pageview`. Per-landing-page arrival is measurable, and
   `properties.$pathname` is the field to group on.
2. **`person_profiles: 'identified_only'`** — and `posthog.identify()` is called
   in exactly one place, `callback.tsx:45`, on sign-in. **Guests never get a
   person profile.**

Fact 2 is the methodological linchpin. Since almost nobody signs in, almost
every event on this site carries `$process_person_profile: false`, and so:

| Don't use | Use instead | Why |
|---|---|---|
| `person.properties.$initial_utm_source` | `properties.utm_source` on the entry `$pageview`, or `$entry_utm_source` on the session | Person properties are never written for guests |
| Funnels aggregated by person | Funnels aggregated by **unique sessions** (`properties.$session_id`) | Sessions are computed regardless of person profiles |
| Person-property breakdowns of guest cohorts | `properties.player_tier` (a `register()`ed **event** property) | Survives `identified_only` intact — this was a good call by whoever wrote it |

Every query below is session-scoped for this reason.

---

## The funnel, stage by stage

The four stages this issue asked for, and whether PostHog can answer them today.

| # | Stage | Answerable now? | Notes |
|---|---|---|---|
| 1 | Sessions arriving, by landing-page type | **Yes** | `$pageview` + `argMin($pathname)` per `$session_id` → [Q1](#q1--arrival--battle-surface--vote-by-landing-type) |
| 2 | Reaching a battle surface | **Partly** | Arrival at `/battle*` is visible. *Which* CTA drove it is not — no click event exists on any in-content CTA or on the navbar |
| 3 | Completing a first vote | **Quick Battle only** | `battle_vote_submitted` + `session_picks = 1`. **Tier Drop emits nothing at all** — see F1 |
| 4 | Returning | **Weakly, guests barely** | No person profiles; `distinct_id` is the only thread, and `posthog.reset()` at sign-out cuts it (F9) |

### The biggest drop, and what kind of problem it is

**Honest answer first: the biggest drop cannot be *named from measurement*
today, and the reason is finding F1.** One of the two arms of the voting loop —
Tier Drop, the arm with the highest voter-floor yield per action, and the
*primary* CTA on all 171 champion pages — emits no events whatsoever. Any funnel
drawn now would show that arm as a 100% drop-off and be wrong.

What *can* be named with confidence, because it is a property of the code rather
than of the traffic, is a **targeting** failure inside stage 3:

> A reader arrives on one of 1,943 skin dossiers from an answer engine, reads a
> verdict about **that** skin, and clicks the primary button that says **"Battle
> this skin"** (`web/src/routes/skins_.$slug.tsx:258`). `/battle` accepts only
> `?refit=` (`web/src/routes/battle/index.tsx:66`) — there is no way to seed a
> pair. They are dealt a pair from the whole catalog. Their vote becomes a
> distinct voter for two skins that are almost certainly not the one they came
> for.

This is a **CTA/navigation-and-targeting** problem, not loop friction and not
retention. It matters more here than it would on most sites because the floor is
per-skin: the site's entire acquisition channel lands on specific skin pages
with specific intent, and that intent is then discarded at the door. Pairing is
not uniform — `pickPlacement` samples the 50 least-battled skins
(`web/src/lib/games/server/quickbattle.ts:201`), so a random vote does serve
coverage — but coverage spread thinly across 1,943 skins is precisely what
produces "90 battles, 5 voters" on the pages people actually read.

**What would falsify this:** if [Q1](#q1--arrival--battle-surface--vote-by-landing-type)
shows skin-dossier sessions reaching `/battle` at a low rate (say under 5%), then
the drop is upstream of the targeting problem — it is the CTA itself, and F4/F6
matter more than F5. If they reach `/battle` well but
[Q2](#q2--first-vote-vs-repeat-votes) shows most never complete a first vote, the
drop is loop friction and none of the proposals below are the right fix. Run Q1
and Q2 before acting on the ranking.

---

## Findings

Ranked by what they cost to fix against what they unblock. Severity is about the
funnel, except F2, which is about honesty.

### F1 · Tier Drop is completely uninstrumented — **critical**

`web/src/routes/battle/tier-drop.tsx` contains **zero** `posthog.capture()`
calls (verified: 0 matches in 2,100 lines; same for `tiers.tsx`, `mirror.tsx`,
`battle/leaderboards.tsx`).

Why this is the top finding and not a nice-to-have:

- A Tier Drop submission adds the submitter as a distinct voter to **every skin
  on the board at once** — the SQL in `skinVoters` UNIONs
  `tier-list/tier_submitted` in on equal footing with battle votes
  (`ratings.ts:375-390`).
- It is the **primary** CTA on every champion page — *"Rank all N in one pass"*
  → `/battle/tier-drop?set=champion:X` (`web/src/routes/champions/$id.tsx:266`),
  with head-to-head demoted to secondary.
- So the single highest-yield action for the exact metric this issue is about is
  invisible to the funnel, while the lower-yield arm next to it is fully
  instrumented.

The fix is one `capture()` at the existing submit handler
(`tier-drop.tsx:968-994`), which already has everything needed in scope:

```ts
// in submit(), immediately after rememberGuestToken(res.guestToken)
posthog.capture('tier_submitted', {
  board_id: board.boardId,                 // e.g. 'champion:Aatrox'
  board_type: board.boardId.split(':')[0], // champion | line | year | price | rarity
  skins_placed: placedCount,
})
```

Not a second analytics system, not a duplicate, not a rename — it is the missing
one. Name it `tier_submitted` to match the `game_events.type` the server already
writes (`web/src/lib/games/server/db.ts:44`).

### F2 · The privacy policy states there is no third-party analytics, while PostHog runs — **critical (honesty, not funnel)**

`web/src/routes/privacy.tsx` says it twice, in the site's own voice:

- line 65: *"There are no ads, **no third-party analytics**, no tracking pixels…"*
- line 104: *"**No third-party analytics** or advertising scripts run on this site."*

PostHog is a third-party analytics service. It autocaptures pageviews, clicks,
rageclicks and exceptions, and on sign-in it is sent `email` and `username`
(`callback.tsx:45-49`). The same-origin `/ingest` proxy means a reader cannot
see the third party in their network tab either.

The file's own header comment, at `privacy.tsx:7`, is explicit about this:

> *"Keep this honest: if a future feature adds collection (analytics, comments),
> this page must change in the same PR."*

The PR that added PostHog did not change this page. On a site whose entire
differentiator is refusing to overstate what it knows, this is the one
inconsistency that undercuts the rest.

**Deliberately not fixed here.** The wording of a privacy representation is
Brandon's to write — what to disclose (the proxy? the email? retention?) is a
judgement call, not a mechanical edit. A starting point, honest and short:

> The site uses PostHog for product analytics, routed through
> `skinbattle.lol/ingest` so no third-party script talks to your browser
> directly. It records which pages are visited and which votes are cast, split
> only by signed-in versus signed-out. If you sign in, your email and username
> are sent to PostHog so sessions can be tied to your account. No ads, no
> advertising scripts, no cross-site tracking, nothing sold or shared.

If Brandon would rather not disclose the email, the alternative is to stop
sending it — see F7.

### F3 · The guest→member upgrade prompt is uninstrumented and below the arena — **high**

The whole guest-to-member path on the battle page is one static paragraph
rendered when `stats.tier === 'guest'` (`web/src/routes/battle/index.tsx:1809-1828`).
It is well written — it reframes half-weight as an upgrade rather than a penalty,
and the retroactive re-weighting it promises is real.

Two problems:

1. **It is not instrumented.** No event when it renders, none when the `sign in`
   button is clicked — `login()` is called bare (`index.tsx:1823`). So the most
   consequential conversion on the site, the one that turns a 0.5 into a 1.0, has
   a measurable *outcome* (`guest_account_attached.outcome = 'merged'`) but no
   measurable *funnel*. "Was the prompt seen and ignored, or never seen?" is
   unanswerable, and those two have opposite fixes.
2. **Placement.** It renders after the arena, `FeedbackBar`, `Standing` and
   `ConsensusCallout`, with `mt-10`. It never fires *at* a moment — not on the
   first vote, not at any milestone. A voter who votes once and leaves has most
   likely never scrolled to it.

This is the issue's question 4. The answer, from the code: signing in is
**neither required nor prompted** at the moment of first vote — it is
*mentioned*, statically, below the fold. Nothing here argues for a signup wall;
the honest question is whether the prompt should appear at a moment rather than
in a location, and that needs F3's instrumentation before it can be answered
rather than guessed.

### F4 · Six of the SEO surfaces have no in-content path into the loop — **high**

In-content `to="/battle*"` links per landing surface (NUL-safe count):

| Surface | Links | Verdict block? |
|---|---|---|
| `/` | 6 | — |
| `/champions/$id` (171 pages) | 2 | yes |
| `/rankings/$slice` | 1 | yes |
| `/skins/$slug` (1,943 pages) | 1 | yes |
| `/rankings/drought` | **0** | no |
| `/skins` (1,943 anchors) | **0** | no |
| `/champions` | **0** | no |
| `/rankings` | **0** | no |
| `/rankings/elo` | **0** | no |
| `/rankings/awards` | **0** | no |

The pattern is mechanical: **the CTA rides on `<Verdict>`**. The four pages that
render a verdict block pass Battle links in as its children; the six that don't
have no in-content route into voting at all.

Every page does carry the navbar's accented Battle link
(`web/src/components/Navbar.tsx:63`), so this is "no in-content CTA", not "no
path" — but `/rankings/drought` is the sharp case. It is a page whose entire
subject is skins nobody has voted on, and it offers the reader no way to vote on
one.

### F5 · "Battle this skin" cannot battle that skin — **high**

`web/src/routes/skins_.$slug.tsx:258` labels its primary CTA *"Battle this
skin"* and links to bare `/battle`. The route's `validateSearch` accepts only
`{ refit?: string }` (`web/src/routes/battle/index.tsx:66`) — no skin can be
seeded. The button's promise cannot be kept by its destination.

Compare the champion page, which does it right: *"Rank all N in one pass"* →
`/battle/tier-drop?set=champion:X`, seeded and honest
(`web/src/routes/champions/$id.tsx:266`).

So the largest surface (1,943 dossiers) has the unseeded CTA, and the smaller one
(171 champion pages) has the seeded one. That asymmetry is backwards relative to
where traffic lands.

### F6 · `/rankings/$slice` links to unseeded `/battle` while an exact seeded board already exists — **medium**

The two taxonomies are the same taxonomy with a different separator:

| Ranking slice (`server/rankings.ts:73-104`) | Tier Drop board (`server/tierlist.ts:127-160`) |
|---|---|
| `champion-<id>` | `champion:<id>` |
| `line-<kebab>` | `line:<kebab>` |
| `year-<YYYY>` | `year:<YYYY>` |
| `price-<rp>` | `price:<rp>` |

Every ranking slice has an exact Tier Drop board waiting for it, and
`/rankings/$slice` links to *"Battle to sharpen this list"* → bare `/battle`
(`web/src/routes/rankings/$slice.tsx:704`). One separator swap turns the site's
most on-topic CTA into the highest-yield one.

### F7 · `email` and `username` are sent to PostHog on sign-in — **medium**

`posthog.identify(claims.sub, { email: claims.email, username: claims.username, … })`
(`web/src/routes/callback.tsx:45`). Common practice, and PostHog supports it —
but nothing in this codebase reads those properties, and F2's privacy page
currently denies the whole arrangement. `claims.sub` alone identifies the user
for every funnel in this document. Dropping the two PII fields costs no analysis.

### F8 · `web/src/utils/posthog-server.ts` is dead code — **low**

`getPostHogClient()` is exported and imported by nothing (verified: the only
`posthog-node` reference outside `package.json` / `package-lock.json` is the
file's own import). All capture is client-side. Either delete the file and the
`posthog-node` dependency, or keep it deliberately for server-side events — but
note that F1's missing event does not need it.

### F9 · `posthog.reset()` at sign-out severs returning-voter continuity — **low**

`web/src/lib/useAuth.ts:166`. Correct for privacy on a shared browser, and it
sits right next to `clearGuestIdentity()`, which is deliberately thorough. But it
rotates the anonymous `distinct_id`, so one person who signs out becomes two in
any retention query. Worth knowing when reading [Q4](#q4--returning-voters); not
worth changing.

### F10 · Champion 404s land inside the acquisition channel and look like arrivals — **medium**

DONI-92 (`aee68ae`) fixed `/champions/miss-fortune` returning a 500 and made it a
clean 404, correctly. But its own commit message names the funnel consequence:
*"miss-fortune is the obvious spelling: external links, typed URLs and
AI-generated links all reach for it."*

`notFoundComponent` renders **in place at the requested URL**
(`web/src/routes/champions/$id.tsx:139`), and `capture_pageview: 'history_change'`
fires a `$pageview` for it like any other page. So:

- Every hyphenated champion link an answer engine invents becomes a
  `$pathname LIKE '/champions/%'` arrival in Q1, indistinguishable from a real
  champion page unless the hyphen is filtered out.
- Those sessions convert at **0% by construction** — the 404 page has no Battle
  CTA — and they drag down the champion-page row that carries the site's single
  highest-yield CTA.

Two consequences worth separating. For measurement, Q1 now buckets them apart.
For the funnel itself, a 404 inside the acquisition channel is a wasted arrival:
if Q1 shows this bucket is non-trivial, the cheap fix is a redirect from the
hyphenated spelling to the canonical slug (the casing path already 301s
single-hop), which turns a dead end into a champion page. That is a redirect, not
a voting-UI change, and it is upstream of every proposal below — but it belongs to
whoever owns `/champions` routing, not to this issue.

---

## The queries

Paste into **PostHog → SQL editor**. Written session-scoped for the
`identified_only` reason above. Fill the blanks in and keep them next to this
file so the next pass compares rather than re-derives.

Two caveats that apply to all of them:

- The CTE is named `sess`, not `sessions`, to avoid shadowing PostHog's own
  `sessions` table. If you prefer that table, `$entry_pathname` and
  `$entry_utm_source` replace the `argMin(...)` lines.
- If `toInt(...)` is rejected on a property, drop it — JSON numbers compare
  directly.

### Q1 · Arrival → battle surface → vote, by landing type

The core table this issue asked for. **Run this first.**

```sql
WITH sess AS (
  SELECT
    properties.$session_id                               AS sid,
    argMin(properties.$pathname, timestamp)              AS entry_path,
    argMin(properties.utm_source, timestamp)             AS entry_utm,
    max(properties.$pathname IN ('/battle', '/battle/')) AS saw_quick_battle,
    max(properties.$pathname LIKE '/battle%')            AS saw_any_battle,
    max(event = 'battle_vote_submitted')                 AS voted
  FROM events
  WHERE timestamp > now() - INTERVAL 30 DAY
    AND properties.$session_id IS NOT NULL
  GROUP BY sid
)
SELECT
  multiIf(
    entry_path = '/',                 'home',
    entry_path LIKE '/champions/%-%', 'champion 404 (see F10)',
    entry_path LIKE '/champions/%',   'champion page',
    entry_path = '/champions',        'champion index',
    entry_path LIKE '/skins/%',       'skin dossier',
    entry_path = '/skins',            'skin catalog',
    entry_path = '/rankings/drought', 'drought',
    entry_path LIKE '/rankings%',     'rankings',
    entry_path LIKE '/battle%',       'battle (direct)',
                                      'other')                      AS landing_type,
  count()                                                           AS sessions,
  countIf(saw_any_battle)                                           AS reached_battle,
  countIf(voted)                                                    AS voted,
  round(100 * countIf(saw_any_battle) / count(), 1)                 AS pct_reached,
  round(100 * countIf(voted) / nullIf(countIf(saw_any_battle), 0), 1) AS pct_voted_of_reached,
  countIf(entry_utm = 'chatgpt.com')                                AS from_chatgpt
FROM sess
GROUP BY landing_type
ORDER BY sessions DESC
```

| landing_type | sessions | reached_battle | voted | pct_reached | pct_voted_of_reached | from_chatgpt |
|---|---|---|---|---|---|---|
| | | | | | | |

**Read it like this.** A low `pct_reached` on skin dossiers points at F4/F6 — the
CTA. A healthy `pct_reached` with a low `pct_voted_of_reached` points at loop
friction instead, and the ranked proposals below are the wrong fix.

The `'/champions/%-%'` bucket separates 404 landings, which render in place at
the requested URL and so would otherwise inflate the champion-page row — see
F10. A hyphen in the last segment is a reliable 404 detector because canonical
slugs are lowercased Data Dragon ids, which are alphanumeric (`missfortune`,
`leesin`); confirm against `SELECT DISTINCT champion_id FROM catalog_skins` if
Riot ever ships a hyphenated id.

### Q2 · First vote vs repeat votes

Is the loop losing people before their first vote, or after it?

```sql
SELECT
  properties.player_tier                       AS tier,
  properties.battle_mode                       AS mode,
  countIf(toInt(properties.session_picks) = 1) AS first_votes,
  count()                                      AS all_votes,
  round(count() / nullIf(countIf(toInt(properties.session_picks) = 1), 0), 2)
                                               AS votes_per_starter,
  max(toInt(properties.session_picks))         AS deepest_session
FROM events
WHERE event = 'battle_vote_submitted'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY tier, mode
ORDER BY all_votes DESC
```

| tier | mode | first_votes | all_votes | votes_per_starter | deepest_session |
|---|---|---|---|---|---|
| | | | | | |

`votes_per_starter` near 1.0 means people vote once and stop — retention.
Comfortably above it means the loop holds and the problem is upstream.

### Q3 · The guest path at the moment of first vote

The issue's question 4, as far as current events can answer it.

```sql
SELECT
  properties.player_tier                 AS tier_at_first_vote,
  count()                                AS first_votes,
  count(DISTINCT properties.$session_id) AS sessions,
  count(DISTINCT distinct_id)            AS rough_people
FROM events
WHERE event = 'battle_vote_submitted'
  AND toInt(properties.session_picks) = 1
  AND timestamp > now() - INTERVAL 90 DAY
GROUP BY tier_at_first_vote
```

| tier_at_first_vote | first_votes | sessions | rough_people |
|---|---|---|---|
| | | | |

Then the conversion side of it:

```sql
SELECT
  properties.outcome AS outcome,  -- merged = a guest WITH votes converted
  count()            AS n
FROM events
WHERE event = 'guest_account_attached'
  AND timestamp > now() - INTERVAL 90 DAY
GROUP BY outcome
ORDER BY n DESC
```

| outcome | n | meaning |
|---|---|---|
| `merged` | | guest votes folded into a new account — **the floor moved** |
| `attached` | | signed in with no prior votes |
| `switched` | | device pointed at a different account |
| `already` | | no-op |

`merged` is the number that matters. Note what is **not** here: how many people
saw the upgrade prompt, and how many clicked it. That is F3.

### Q4 · Returning voters

```sql
WITH v AS (
  SELECT
    distinct_id,
    argMax(properties.player_tier, timestamp) AS tier,
    count(DISTINCT toDate(timestamp))         AS active_days,
    count()                                   AS votes
  FROM events
  WHERE event = 'battle_vote_submitted'
    AND timestamp > now() - INTERVAL 90 DAY
  GROUP BY distinct_id
)
SELECT
  tier,
  count()                                            AS voters,
  countIf(active_days > 1)                           AS returned_another_day,
  round(100 * countIf(active_days > 1) / count(), 1) AS pct_returned,
  round(avg(votes), 1)                               AS avg_votes
FROM v
GROUP BY tier
```

| tier | voters | returned_another_day | pct_returned | avg_votes |
|---|---|---|---|---|
| | | | | |

**Read this one with both hands.** `distinct_id` for a guest is PostHog's
anonymous id: it rotates when cookies are cleared and when `posthog.reset()`
fires at sign-out (F9). It therefore **over-counts distinct guests and
under-counts returns**. Treat it as a floor on retention, not a measurement, and
cross-check the `voters` column against Q7's ground truth.

### Q5 · The ChatGPT cohort, end to end

Does answer-engine traffic vote, or only read?

```sql
WITH sess AS (
  SELECT
    properties.$session_id                          AS sid,
    argMin(properties.utm_source, timestamp)        AS utm,
    argMin(properties.$referring_domain, timestamp) AS ref,
    argMin(properties.$pathname, timestamp)         AS entry_path,
    max(properties.$pathname LIKE '/battle%')       AS saw_battle,
    max(event = 'battle_vote_submitted')            AS voted,
    count()                                         AS events_in_session
  FROM events
  WHERE timestamp > now() - INTERVAL 90 DAY
    AND properties.$session_id IS NOT NULL
  GROUP BY sid
)
SELECT
  multiIf(utm = 'chatgpt.com' OR ref = 'chatgpt.com', 'chatgpt',
          ref = '$direct' OR ref = '',               'direct',
          ref)                          AS source,
  count()                               AS sessions,
  countIf(saw_battle)                   AS reached_battle,
  countIf(voted)                        AS voted,
  round(avg(events_in_session), 1)      AS avg_events,
  topK(5)(entry_path)                   AS top_entry_paths
FROM sess
GROUP BY source
ORDER BY sessions DESC
LIMIT 25
```

| source | sessions | reached_battle | voted | avg_events | top_entry_paths |
|---|---|---|---|---|---|
| | | | | | |

### Q6 · Which skin pages are read but never voted on

The join between the SEO work and the voter problem — pages earning attention
whose skins gain no voters.

```sql
SELECT
  properties.skin_name                   AS skin,
  properties.champion_name               AS champion,
  count()                                AS page_views,
  count(DISTINCT properties.$session_id) AS sessions,
  max(toInt(properties.battles))         AS battles_at_view,
  max(toInt(properties.elo_rank))        AS rank_at_view
FROM events
WHERE event = 'skin_page_viewed'
  AND timestamp > now() - INTERVAL 90 DAY
GROUP BY skin, champion
ORDER BY page_views DESC
LIMIT 50
```

| skin | champion | page_views | sessions | battles_at_view | rank_at_view |
|---|---|---|---|---|---|
| | | | | | |

High `page_views` with low `battles_at_view` is F5 in a table: demand arriving at
a skin, and no mechanism turning it into a voter for that skin.

### Q7 · Ground truth — no PostHog needed

Run against production `games.db` (`$GAMES_DATA_DIR/games.db`, default
`web/.data/games.db` — `web/src/lib/games/server/db.ts:19`). This reproduces
`skinVoters` (`ratings.ts:364`) for the whole catalog and answers the question
this issue is really asking: **how far from the floor is the catalog?**

```sql
-- Distance to the 3.0-weighted-voter floor, per rated skin.
-- Joins catalog_skins WHERE num != 0: rating rows outlive the skins they
-- describe, and counting over skin_ratings alone inflates every denominator.
WITH voters AS (
  SELECT v.skin_id,
         SUM(CASE WHEN u.logto_sub IS NOT NULL THEN 1 ELSE 0 END) AS members,
         SUM(CASE WHEN u.logto_sub IS NULL     THEN 1 ELSE 0 END) AS guests
  FROM (
    SELECT DISTINCT json_extract(e.payload, '$.winnerId') AS skin_id, e.user_id AS uid
      FROM game_events e
     WHERE e.game = 'quick-battle' AND e.type = 'battle_voted'
    UNION
    SELECT DISTINCT json_extract(e.payload, '$.loserId') AS skin_id, e.user_id AS uid
      FROM game_events e
     WHERE e.game = 'quick-battle' AND e.type = 'battle_voted'
    UNION
    SELECT DISTINCT placed.value AS skin_id, e.user_id AS uid
      FROM game_events e,
           json_each(json_extract(e.payload, '$.tiers')) AS tier,
           json_each(tier.value) AS placed
     WHERE e.game = 'tier-list' AND e.type = 'tier_submitted'
  ) v
  LEFT JOIN game_users u ON u.id = v.uid
  GROUP BY v.skin_id
)
SELECT
  cs.champion_name || ' — ' || cs.name                                    AS skin,
  r.battles,
  ROUND(r.uncertainty, 1)                                                 AS band,
  COALESCE(vt.members, 0)                                                 AS members,
  COALESCE(vt.guests, 0)                                                  AS guests,
  ROUND(COALESCE(vt.members,0) + 0.5 * COALESCE(vt.guests,0), 2)          AS weighted_voters,
  ROUND(3.0 - (COALESCE(vt.members,0) + 0.5 * COALESCE(vt.guests,0)), 2)  AS short_by,
  CASE WHEN r.uncertainty <= 100 THEN 'yes' ELSE 'no' END                 AS band_ok
FROM skin_ratings r
JOIN catalog_skins cs ON cs.id = r.skin_id AND cs.num != 0
LEFT JOIN voters vt   ON vt.skin_id = r.skin_id
ORDER BY short_by ASC, r.battles DESC
LIMIT 60;
```

And the one-line scoreboard:

```sql
-- ... same `voters` CTE as above ...
SELECT
  COUNT(*)                                                              AS rated_skins,
  SUM(CASE WHEN r.uncertainty <= 100 THEN 1 ELSE 0 END)                 AS band_ok,
  SUM(CASE WHEN COALESCE(vt.members,0) + 0.5*COALESCE(vt.guests,0) >= 3 THEN 1 ELSE 0 END)
                                                                        AS floor_ok,
  SUM(CASE WHEN r.uncertainty <= 100
            AND COALESCE(vt.members,0) + 0.5*COALESCE(vt.guests,0) >= 3
           THEN 1 ELSE 0 END)                                           AS settled
FROM skin_ratings r
JOIN catalog_skins cs ON cs.id = r.skin_id AND cs.num != 0
LEFT JOIN voters vt   ON vt.skin_id = r.skin_id;
```

| rated_skins | band_ok | floor_ok | settled |
|---|---|---|---|
| | | | |

Two notes on fidelity. This joins `game_users.logto_sub` rather than reading
`game_events.trust_tier`, deliberately: `trust_tier` is the tier *at vote time*,
while the join reflects the tier *now* — which is what makes the battle page's
retroactive-upgrade promise true, and what `skinVoters` itself does. And
`short_by` is the shortest list of what to fix: **the skins one guest away from
settled are the ones any of the proposals below would convert first.**

---

## Ranked proposals

Expected effect, cheapest first within a tier. **Nothing here moves a
threshold.** Everything marked *own issue* touches the voting path and is
Brandon's call, per DONI-96.

| # | Change | Cost | Expected effect | Route |
|---|---|---|---|---|
| **P1** | **Add `tier_submitted` to Tier Drop** (F1) | ~6 lines, one call site | Makes the highest-yield voter action visible. Without it every funnel here is wrong about the champion-page arm, and P3/P4 cannot be evaluated after shipping | Do it next, on its own; it is instrumentation, not UI |
| **P2** | **Correct the privacy policy** (F2) | copy edit | Removes a live misstatement to users; restores the property the rest of the site trades on | Brandon writes the wording — draft above |
| **P3** | **Point `/rankings/$slice` at its own Tier Drop board** (F6) | one separator swap on an existing link | Converts the most on-topic CTA on the ranking pages into the one action that adds a voter to *every* skin in that slice. Highest yield per line changed on the whole site | *Own issue* |
| **P4** | **Give skin dossiers the champion page's seeded CTA** (F5) | one `<Link>`; `championId` is already in loader state | 1,943 pages stop discarding arrival intent. A dossier reader ranking that champion's wardrobe becomes a distinct voter for the skin they came for *and* its siblings | *Own issue* — and relabel "Battle this skin" either way, since `/battle` cannot honour it |
| **P5** | **Instrument the guest upgrade prompt** (F3) | two `capture()` calls | Turns "never seen vs seen and ignored" from a guess into a number. Prerequisite for any decision about moving the prompt | Do with P1 |
| **P6** | **Put a Battle CTA on `/rankings/drought`** (F4) | one link, reusing the `<Verdict>` children pattern | The page about skins nobody has voted on currently offers no way to vote on one. Its seeded board is `year:<YYYY>` or the champion slice | *Own issue* |
| **P7** | **Drop `email` / `username` from `identify()`** (F7) | delete two properties | No analysis in this document needs them; shrinks what F2 has to disclose | *Own issue*, or fold into P2 |
| **P8** | **Delete `posthog-server.ts` + `posthog-node`** (F8) | deletion | One fewer dependency, one less dead export | Free; do it whenever |
| **P8b** | **Redirect hyphenated champion slugs to canonical** (F10) | one redirect, mirroring the existing casing 301 | Recovers arrivals the acquisition channel is already sending to a dead end with no CTA. Size it with Q1 first | *Own issue*, `/champions` routing |
| **P9** | Move the upgrade prompt to a moment rather than a place | real UI work | Unknown until P5 reports. **Do not do this before P5** | *Own issue*, blocked on P5 |

**If only one thing gets done: P1.** Not because it is the biggest lever, but
because P3, P4 and P6 all add voters through the Tier Drop arm, and shipping them
while that arm is unmeasured means never learning whether they worked.

### Explicitly not proposed

- **No signup wall** in front of voting. Guests voting is the feature; the floor
  already discounts them at 0.5 and `/methodology` publishes the weakness.
- **No threshold changes.** `MAX_CONFIDENT_UNCERTAINTY`, `VOTER_SKIN_CAP` and
  `MIN_CONFIDENT_VOTERS` stay where they are. Manufacturing settled-looking pages
  is the one change that would undo the last eight PRs.
- **No second analytics system**, no renamed events, no `utm_source`
  normalisation before capture.
- **No new pages.** More surfaces will not move this number; the site already
  proved that.

---

## Verification log

What was actually run, and what could not be.

**Confirmed by reading code or shipped artefacts:**

- Every `posthog.capture()` call site and its properties — grep across
  `web/src`, 15 call sites, all listed above.
- `person_profiles: 'identified_only'` and `capture_pageview: 'history_change'`
  — extracted from `web/node_modules/posthog-js/dist/array.full.js` (v1.386.6),
  the shipped bundle, rather than from memory of the docs.
- `posthog.identify()` called exactly once (`callback.tsx:45`);
  `posthog.reset()` exactly once (`useAuth.ts:166`); no `alias`, no
  `setPersonProperties`.
- Tier Drop, Tiers, Mirror and battle Leaderboards contain **0** capture calls.
- `web/src/utils/posthog-server.ts` imported by nothing.
- In-content `to="/battle*"` counts per surface, NUL-safe
  (`tr -d '\000' | grep -ao … | wc -l`).
- `/battle` `validateSearch` accepts only `refit`.
- Slice grammar (`server/rankings.ts:73-104`) and board grammar
  (`server/tierlist.ts:127-160`) share four kinds.
- `MIN_CONFIDENT_VOTERS = 3` recomputed from source: `FRESH_UNCERTAINTY` 350,
  `ceil((350/100)^2)` = 13, `ceil(13/6)` = 3.
- `skinVoters` counts Tier Drop submissions alongside battle votes
  (`ratings.ts:375-390`).
- Privacy policy text at `privacy.tsx:65` and `:104`.
- Champion 404s render in place via `notFoundComponent` (`champions/$id.tsx:139`,
  `notFound()` thrown at `:47`), so they emit a `$pageview` at the requested
  path — the basis for F10. Branch rebased onto `aee68ae` before this was
  written.

**Could not be run — PostHog unreachable:**

- No `.env`, `.env.local` or `web/.env` in the worktree or the main checkout.
- No `POSTHOG_*` variable in the session environment.
- No PostHog CLI on `PATH`; no `~/.posthog*` credential.
- No PostHog MCP connector available (searched; the analytics connectors present
  are Amplitude and Pendo, neither in use here).
- Production carries only `POSTHOG_PROJECT_TOKEN`
  (`docker-compose.coolify.yml:180`), a **public write-only** client token.
  Querying needs a personal API key (`phx_…`) plus the project id.

**Therefore every table in [The queries](#the-queries) is empty**, and no number
in this document is an estimate, an illustration, or a guess. Fill them by
running the SQL as written.
