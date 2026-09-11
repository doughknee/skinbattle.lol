# The participation loop

Design record for DONI-108. Companion to [`voter-funnel.md`](./voter-funnel.md),
which diagnosed where visitors fail to become voters, and to
[`seo-audit.md`](./seo-audit.md), whose layer this work leaves frozen.

The loop this closes:

```
visitor → ranking → battle → more battles → ranking payoff → share → referred visitor
```

Everything below was read out of the code on 2026-09-11 before anything was
changed. Numbers are not in this document: PostHog is write-only from a task
session (see the verification log in `voter-funnel.md`), so the dashboard is
specified here for a person with a personal API key to build.

---

## 1. What existed

| Surface | Found | Kept / changed |
|---|---|---|
| **Battle flow** (`web/src/routes/battle/index.tsx`) | `/battle` deals a pair + a preloaded next pair; champion mode (king-of-the-hill) by default, shuffle by toggle; undo; session history; the daily strip below. `validateSearch` accepted only `?refit=`. A comment in `quickbattle.ts` about a `?vs=` deep link described a parameter that no longer existed. | Kept whole. Two search params added (`champion`, `skin`, §3). |
| **Champion filtering** | None for head-to-head. Tier Drop had it (`?set=champion:X`). | Added as a pool restriction on the same matchmaker (§2). |
| **Rating model** (`server/ratings.ts`) | Glicko-lite live update per pick; Bradley-Terry MM refit over the full log (every 500 events or 6 h + 50); per-voter-per-skin influence cap of 6 weighted battles; guest votes at 0.5. | Untouched. |
| **Provisional / settled** (`lib/games/answer.ts`) | Leader band ≤ ±100 **and** ≥ 3 weighted distinct voters (guest = 0.5). One rule, two block builders, rendered through `<Verdict>`. | Untouched. Every new surface reads its state from this rule. |
| **Matchmaker** (`server/quickbattle.ts`) | Coverage-driven mix: placement share tracks the catalog's shortfall from 10 battles per skin; the rest splits informative (widest bands + an opponent within 150 Elo, widening) / dunk / marquee. Sides shuffled. Ratings never sent before the pick. | Untouched. The scoped session hands it a smaller pool (§2). |
| **Post-battle feedback** | Winner beat loser · #rank (↑N on a real climb) · decided by N battles; the located standing with named neighbours; a consensus callout from the pair's real vote log, gated at 5 votes before a percentage is printed. | Kept. In a scoped session the standing is the within-wardrobe one (§4). |
| **Champion page** (`routes/champions/$id.tsx`) | Verdict + "Rank the whole wardrobe in one pass" (Tier Drop, seeded) + "Battle head-to-head" (bare `/battle`). Generic OG card. | State-aware primary CTA into the scoped battle; Tier Drop kept as secondary; share control; the champion's own rankings card as `og:image` (§3, §6). |
| **Skin page** (`routes/skins_.$slug.tsx`) | "Battle this skin" → bare `/battle`, which could not battle that skin (voter-funnel F5). | "Help rank {skin}" → the scoped battle with that skin pinned into the first pair. |
| **Ranking slices** (`routes/rankings/$slice.tsx`) | "Battle to sharpen this list" → bare `/battle` (F6). | State-aware ask; champion slices scope; price/line/year slices get their exact Tier Drop board as a second action; share control. |
| **Mirror** (`server/mirror.ts`, `/profile`) | Read-only; `user_skin_ratings` written on every vote (`applyPersonalUpdate`), so "your tier list is taking shape" is literally true after the first pick. `noindex`. | Linked from the 5-battle milestone. Nothing indexable added. |
| **Daily games** | Result panels linked to bare `/battle`. | Splashdle / Chroma Vision link to the answer's champion; Price Point to the last skin's champion. |
| **Sharing** | Tier Drop: minted short links + downloadable image + Web Share. Dailies: result text to the clipboard. No ranking share anywhere; no attribution on any share link. | Ranking share on champion pages and slices (§6). |
| **PostHog** (`ClientProviders.tsx` + 15 call sites) | `battle_vote_submitted` with `session_picks`, `tier_submitted`, `skin_page_viewed`, `mirror_viewed`, `game_result_shared`, the daily events, sign-in/out, `guest_account_attached`. Super-properties `player_tier` / `is_authenticated`. `person_profiles: 'identified_only'`, so guests have no person profile and every funnel must be session-scoped. `$pageview` fires on route changes with `utm_*` autocaptured. `usePostHog()` is a no-op client without a token, so every capture is optional-chained. | Five events added, one enriched (§7). No renames. |
| **Auth / user state** | Guest cookie + localStorage backup; `stats.tier`. | Untouched. |
| **Mobile** | Cards stack below `md`; the arena never reflows for feedback (fixed-height bar). | The new banner sits above the arena and the milestone strip below it; neither moves the cards. |

---

## 2. Matchmaking integrity: the decision

**Question.** Would preferentially dealing close or uncertain matchups - or
restricting a session to one wardrobe - bias the ranking model?

**What the model is.** The canonical ratings are the Bradley-Terry maximum
likelihood fit (with a one-win-one-loss phantom prior) over every recorded
comparison. The likelihood is a product over compared pairs of
`p_i / (p_i + p_j)` for the observed winner. Which pairs were compared enters
only through *which terms appear*, never through their form.

**Why adaptive selection is safe here.** If the choice of the next pair depends
only on data already observed - past outcomes, current estimates, current
uncertainties - and never on the outcome about to be observed, the design
factor is a constant with respect to the parameters and drops out of the
likelihood. The maximum-likelihood estimate is the same estimate it would be
under any other outcome-independent design, and it stays consistent as long
as the comparison graph is connected. This is the ordinary adaptive-design
result, and it is why paired-comparison systems are allowed to matchmake at
all. It also happens that a comparison carries the most Fisher information
when the two sides are close (`p = 0.5`), so preferring close pairs is the
*efficient* design, not a biased one.

**What the site already did.** The matchmaker has sampled adaptively since
launch: the informative picker takes the widest bands and finds an opponent
within 150 Elo, placement targets under-sampled skins, dunk and marquee pace
the session. Nothing in this work changes that mix.

**What would bias it, and is guarded against.**

- Choosing a pair with knowledge of the vote about to be cast: impossible,
  the pair is signed and dealt before the pick.
- Showing ratings before the pick: deliberately never sent (`toBattleSkin`).
- One voter farming a skin: capped at 6 weighted battles per voter per skin
  in the refit (`BATTLE_VOTER_SKIN_CAP`), and the verdict needs 3 weighted
  distinct voters (`MIN_CONFIDENT_VOTERS`). A scoped session cannot settle a
  ranking alone, by construction.
- Position carrying signal: sides are shuffled on every deal.

**The one honest caveat.** The band stand-in the refit stores,
`350 / √(weighted battles)`, does not model the comparison graph. A wardrobe
compared mostly within itself gets tight *within-champion* bands while its
skins' placement against other champions rests on cross-champion comparisons
that a scoped session does not add. That is the right trade for the ranking
the session claims to settle - the champion page ranks the wardrobe against
itself - and the catalog-wide list keeps drawing its evidence from catalog-wide
play and from Tier Drop's cross-champion boards (line / year / price). The
scoped session is presented as "settling *Ahri's* ranking", never as moving
`/rankings/all`.

**Voter self-selection** (Ahri fans battle Ahri skins) is a population effect,
not a sampling effect. It already exists through Tier Drop champion boards, and
the voter floor plus the influence cap are exactly the guards that bound it.

**Decision.** The scoped session is a *pool restriction only*
(`scopePool` in `server/quickbattle.ts`): one champion's wardrobe, handed to
the same pickers, the same mix, the same cap and the same floor. No
"target the uncertain neighbours" picker was added: the informative picker
already prefers the wardrobe's widest bands, and a purpose-built closest-pair
targeter would concentrate evidence on one pair - worse coverage, no
statistical gain. Uncertainty is used for **routing and presentation**
(which champions the `/settle` hub lists, what the CTA says), which is the
option the brief named as the safe fallback, chosen here on the merits rather
than as a fallback.

---

## 3. The settle experience

**Route decision: `/battle?champion=<id>`, not `/settle/<champion>`.** There
is one battle engine and one arena, and the brief forbade duplicating either.
A search parameter keeps one page, one canonical URL (`/battle`, which the
crawl test pins to a path literal), one place where the juice lives, and it
lets the existing recovery paths (resync, broken-splash replacement, mode
toggle) keep working unchanged - each just passes the scope through. A scoped
page carries `noindex` so the 170 spellings never compete with `/battle`.
`?skin=<id>` pins that skin into the first pair (the dossier's promise). An
unresolvable scope deals from the whole catalog and comes back as
`scope: null`, so the page can never claim to be settling something it is not.

The component is keyed by scope: `/battle?champion=ahri → /battle` is a
same-route navigation, and the arena seeds itself from loader data once.

**Mode.** A scoped session opens in shuffle: evidence across a wardrobe is
best spread over fresh pairs, and shuffle has the next pair preloaded. The
toggle still works.

**`/settle`** is the hub: every champion whose ranking is provisional or
untouched, judged by `answer.ts`'s two bars from one aggregate voter query
(`server/settle.ts`, held to `skinVoters()` by a test), ordered head-count-away
first, then by band, then the untouched wardrobes. It is `noindex`, outside the
site map, and every row hands the visitor to the scoped battle. Its copy is the
model's own numbers - "leads at ±118; a placing settles at ±100",
"only 2 people have voted on it" - never a number of battles to go.

---

## 4. Payoff, progress, milestones

- **Standing.** In a scoped session the located standing is the winner's
  place inside the wardrobe - "#2 of 14 Ahri skins · just behind X · just
  ahead of Y" - computed over the post-update ratings the vote response was
  built from (`scopedStanding`).
- **Contribution.** The banner prints this user's lifetime head-to-head
  battles on the wardrobe (`stats.scopeBattles`, one indexed scan bounded by
  wardrobe size), so the count survives a trip to the ranking page and back.
- **Milestones** (`isMilestone`: 1, 3, 5, then every fifth): a strip below
  the feedback with "Keep battling" (scrolls the arena back into view) and
  "See {champion} rankings"; at 5+ also "Your Mirror", because the personal
  tier list is written on every vote. The strip stays until the next milestone
  replaces it, so nothing flickers below the arena.
- **"Updated rankings" is honest.** The live rating update is synchronous and
  the champion page reads the same `skin_ratings` rows, so the ranking a
  visitor lands on already reflects their picks. The periodic refit is the
  canonical recount, and `/methodology` says so.
- The banner and the strip never move the cards: the banner sits above the
  arena with the header, the strip below the feedback bar.

---

## 5. Copy rules (every ask, every surface)

| State | Button | Supporting line |
|---|---|---|
| provisional | Help settle {Champion}'s ranking | The top of this ranking is still provisional. Your battles add evidence to the community ranking. |
| settled | Battle {Champion} skins | Think the community got it wrong? Every battle still counts, and the ranking keeps listening. |
| empty | Battle {Champion} skins | No {Champion} skin has been through a battle yet. Yours would be the first. |

Skin page: "Help rank {Skin}". Catalog-wide slice: "Help shape the rankings".
Other slices: "Help shape this ranking" plus the slice's Tier Drop board.
`settle.test.ts` asserts no ask promises a number of votes.

---

## 6. Sharing and attribution

- `<ShareRanking>` on champion pages and every ranking slice, and the daily
  result panels, all go through one `shareOrCopy` (settle.ts): Web Share
  where the platform has a sheet (decided at click time - the buttons are
  server-rendered), the clipboard otherwise. The ranking payload is a hook a
  stranger can read ("Jhin's best skin, by community vote:" / "…isn't settled
  yet:"), the live top three with medal emoji, the leader's battle count, and
  one ask; a provisional ranking says so. The dailies keep their grid and gain
  a one-line hook. The link is never inside the text: the sheet carries it,
  and the clipboard copy gets it as the last line.
- The link is the **canonical page** with `utm_source=share` and
  `utm_medium=copy|native` - two parameters, because the link is the most
  visible part of a pasted share. "Native" is honest: the Web Share sheet
  never says which app took the link. No platform-specific buttons were added
  (brief minimum: copy + Web Share + fallback).
- The unfurl (`og:description`) on champion pages and slices is the verdict
  sentence plus the ask, not the search description - a share has to make
  someone click; a snippet has to stay stable.
- `<ShareReferral>` (root) records `share_referred_visit` on arrival and then
  removes every `utm_*` from the address bar (`history.replaceState`, one tick
  later), so nothing rides into the next `<Link>` or a re-share copied from the
  address bar. PostHog has already read the parameters at init (the provider
  mounts above it), so session entry attribution and `$initial_*` are intact.
  Canonical tags were already path-only (`canonicalLink` is pinned to literals
  by the crawl test).
- **OG cards.** Champion pages point `og:image` at the dynamic rankings card
  for their slice (`/og/rankings/champion-<id>`); dossiers keep
  `/og/skin/<id>`. Both were redesigned as shares rather than data readouts,
  and sized for the place they are actually seen: a chat client shows a
  1200-wide card at about 400, so each card is at most five lines, the two
  that matter at 60px or more, nothing under 28px, and the ask ("Vote now ·
  free · no account needed") lives in the footer. The rankings card: vivid #1
  splash, "COMMUNITY RANKING · SETTLED/PROVISIONAL", title, medal-order podium
  without Elo numbers, the verdict line with the leader's battle count. The
  skin card: "COMMUNITY RATING · …", the skin's name, "{Champion}'s #N skin ·
  #N of M overall", battles and rating. Long strings step down a size; cache
  keys are versioned (`og-rankings-v2-…`, `og-skin-v2-…`) so a redesign
  replaces yesterday's cards at once.

---

## 7. Events

Existing names were kept wherever an equivalent existed. Second and fifth
battle are **filters** on `battle_vote_submitted`, not new events.

| Funnel step | Event | Where | Properties that matter |
|---|---|---|---|
| ranking_landing | `ranking_viewed` (new; `skin_page_viewed` on dossiers, `$pageview` everywhere) | champion page, ranking slices, `/settle` | `page_type`, `champion`, `slice`, `ranking_state`, `rated`, `total`, `session_battles` |
| settle_cta_clicked | `settle_cta_clicked` (new) | champion page, dossier, slices, hub, daily result panels | `page_type`, `champion`, `skin_id`, `ranking_state`, `cta` ∈ `battle` \| `tier-drop` |
| battle_started | `battle_started` (new) | battle page mount | `champion`, `ranking_state`, `pinned_skin`, `battle_mode` |
| battle_completed | `battle_vote_submitted` (enriched) | every counted vote | `session_picks`, `scope_champion`, `ranking_state`, `scope_rank`, `winner_skin_id`, `loser_skin_id`, `battle_mode`, `player_tier` |
| second_battle_completed | `battle_vote_submitted` where `session_picks = 2` | | |
| five_battles_completed | `battle_vote_submitted` where `session_picks = 5` | | |
| ranking_viewed_after_battle | `ranking_viewed` where `session_battles > 0` (or the funnel's own step order) | | |
| ranking_shared | `ranking_shared` (new) | share control | `method` ∈ `copy` \| `native`, `page_type`, `champion`, `ranking_state` |
| share_referred_visit | `share_referred_visit` (new) | root, on arrival | `utm_medium`, `page_type`, `champion`, `path` |

Session-level acquisition properties come from PostHog itself
(`$entry_referring_domain`, `$entry_utm_source`, `$entry_pathname`); nothing is
normalised before capture (voter-funnel's "no utm normalisation" rule stands).
No PII is captured.

---

## 8. Dashboard: "Participation Growth"

**Live:** <https://us.posthog.com/project/468413/dashboard/2088118>
(PostHog project 468413, "SkinBattle.lol"). Built on 2026-09-11 by
`web/scripts/posthog-dashboard.mjs`, which is the dashboard's definition:
`PH_KEY=<personal api key> node scripts/posthog-dashboard.mjs 468413 apply`
finds-or-creates the dashboard and every insight by name, so re-running it
after editing a query updates the live tiles; `validate` runs every query
through `/query/` without writing; `verify` refreshes each tile. The key is
Brandon's personal PostHog key, scoped to that project; it is never committed
and never stored anywhere in this repo.

Every insight is session-scoped (unique sessions), because guests have no
person profile. Date range 30 days, weekly interval on the trends.

| # | Tile | Build |
|---|---|---|
| A | Landing → first battle | Funnel: `ranking_viewed` → `battle_vote_submitted` (`session_picks = 1`), unique sessions, breakdown `page_type`. |
| B | Battles per battling session | Trend, weekly: `battle_vote_submitted` total ÷ unique sessions (formula `A/B`). |
| B2 | Battles: scoped vs catalog-wide | Trend, weekly: `battle_vote_submitted` with a HogQL breakdown on whether `scope_champion` is set. |
| C | First → second battle | Funnel: `session_picks = 1` → `session_picks = 2`, unique sessions. |
| D | Reaching 5 battles | Funnel: `session_picks = 1` → `session_picks = 5`, unique sessions, same scoped/catalog-wide breakdown. |
| E | Ranking views after a battle | Trend, weekly: `ranking_viewed` where `session_battles > 0`, breakdown `page_type`. |
| E2 | Battle → ranking view | Funnel: `battle_vote_submitted` → `ranking_viewed`, unique sessions. |
| F | Ranking share rate | Funnel: `ranking_viewed` → `ranking_shared`, breakdown `method`. |
| G | Visitors from shares | Trend, weekly: `share_referred_visit`, breakdown `utm_medium`. |
| G2 | Share arrival → battle | Funnel: `share_referred_visit` → `battle_vote_submitted`, unique sessions. |
| H/I | Voter retention (D1 … D7) | Retention: first `battle_vote_submitted` returning to `battle_vote_submitted`, day granularity, 8 intervals; read day 1 and day 7. Caveat: guests are `distinct_id`s that rotate on cleared cookies and on sign-out, so this is a floor. |
| Acquisition | Sessions, battles and shares by channel | HogQL table over the last 30 days: sessions bucketed by entry referrer / `utm_source`, with sessions, sessions that battled, % battled, battles per session, shares. |

The channel buckets are the rules below and nothing more - an unknown
referrer stays "other":

```sql
multiIf(
  properties.$entry_utm_source = 'chatgpt.com' OR properties.$entry_referring_domain = 'chatgpt.com', 'ChatGPT',
  properties.$entry_referring_domain LIKE '%google.%', 'Google organic',
  properties.$entry_referring_domain LIKE '%bing.com', 'Bing organic',
  properties.$entry_referring_domain LIKE '%reddit.com', 'Reddit',
  properties.$entry_referring_domain LIKE '%discord%', 'Discord',
  properties.$entry_utm_source = 'share', 'Share',
  properties.$entry_referring_domain IN ('t.co', 'x.com', 'twitter.com', 'facebook.com', 'instagram.com'), 'social',
  properties.$entry_referring_domain = '$direct' OR properties.$entry_referring_domain = '', 'direct',
  'other')
```

(The live tile reads the same buckets off each session's first
`$referring_domain` / `utm_source` event properties; see the script.)

---

## 9. Not done, and why

- **`/settle/<champion>`**: no route. The scoped battle is the experience, and
  a second URL for it would only add a redirect hop or a second page.
- **A purpose-designed champion OG card**: the existing rankings card is reused
  with the verdict line; a dedicated layout is a future enhancement.
- **Platform share buttons** (X, Reddit, Discord): not added; copy + Web Share
  cover the brief's minimum, and `utm_medium` stays truthful.
- **`web/src/utils/posthog-server.ts`**: still dead (voter-funnel F8), left
  alone - deleting a dependency is its own change.
- **Tier Drop → scoped battle handoff** after a submission: the post-submit
  panel already offers "Rank another"; not added.
