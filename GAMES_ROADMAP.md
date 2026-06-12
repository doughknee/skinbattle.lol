# SkinBattle Games Roadmap

Covers the games roadmap, the rating system architecture, and the design
principles everything must satisfy. Implementation is underway — see
"Status" below for what's shipped vs. planned.

The retention thesis: voting alone is a "finish once" activity. People come back
daily for (1) a shared daily challenge with a streak, (2) time-limited events that
expire, and (3) a persistent identity worth investing in. Games are sequenced by
**data dependency** — the earliest games need zero community data and exist to
*generate* it.

## Status (updated 2026-06-11)

**Shipped to production** (PR #10 — the Phase 0 vertical slice + Splashdle):

- ✅ **Daily seed system** — deterministic from UTC date, frozen per-day in
  `daily_puzzles`, resets midnight UTC.
- ✅ **Guest sessions** — server-side anonymous users (httpOnly cookie +
  localStorage backup). Hardened beyond the original scope: **reads never
  write** — pageviews mint nothing; the user record, result row, and cookie
  are all created by the first actual play (crawler hygiene). Account merge
  is schema-ready (`logto_sub`, `merged_into`) but Logto attachment is not
  yet wired.
- ✅ **Streak tracking** — per-user per-game, `best_streak` +
  `freeze_tokens` in the schema; freeze *redemption* deferred. Semantics:
  consecutive UTC days with a win.
- ✅ **Raw event storage** — append-only `game_events` with
  `question_asked`, `asset_version`, and `trust_tier` on every row.
- ✅ **Shareable results** — emoji-grid share text (spoiler-free). OG
  share-card images NOT yet built.
- ✅ **Splashdle** (Phase 1 flagship) — live at `/games/splashdle`.
  Server-side crops (the answer never reaches the client mid-game), 6
  guesses across the full ~1,964-skin catalog, champion-match hint (🟨),
  fixed six-slot board. Data Dragon gotcha: championFull.json lists ~6,800
  chroma variants as skins with no splash art — filtered at catalog sync.
- ✅ **Daily Hub** — `/games` today-checklist with slots for upcoming games.
- ✅ **Quick Battle + the rating model** (2026-06-11) — live at
  `/games/quick-battle`. The endless swipe loop (stacked on mobile, next
  pair preloaded so picks have zero wait), with the full two-layer rating
  system: every pick appends a raw `battle_voted` event
  (`question_asked='which-do-you-like-more'`) AND applies a cheap live
  Glicko-lite update (start 1500 ± 350, K 16–64 by uncertainty, floor ± 60)
  to the global `skin_ratings` and the user's `user_skin_ratings` — the
  mirror's data source. Periodic Bradley-Terry MM refit recomputes canonical
  ratings from the whole event log (auto after votes + manual
  `?refit=` trigger), re-weighting by CURRENT trust tier so guest → member
  conversion upgrades history retroactively. Matchmaker mixes informative /
  placement / dunk / marquee pairs (principle 6). Every pick answers back
  with the winner's delta + new rank, or agreement % once a matchup has ≥ 5
  votes (principle 1). Guest votes at 0.5 weight; 40/min + 500/day guest
  rate limits (60/min + 1500/day members); pairs are HMAC-signed single-use
  tokens so only matchmaker-dealt pairs can be voted, once each.
- ✅ **The Mirror** (2026-06-11) — live at `/games/mirror`, the read surface
  over Quick Battle's data (principle 2). Personal tier list auto-built from
  battle history (fixed floors on the personal Elo scale: S ≥ 1590,
  A ≥ 1520, B ≥ 1480, C ≥ 1410, D below — one battle already moves a skin
  out of B; S/D are earned over ~4-5 consistent results), contrarian takes
  (≥ 2 personal + ≥ 8 community battles on the same skin, gap ≥ 50, both
  directions), champion-level taste profile (skin-line profiling needs the
  Meraki facts dataset — later session), wardrobe completion overall +
  per-champion (principle 4). Strictly read-only — viewing never mints a
  user; empty state previews what the mirror becomes with a first-battle
  CTA; guests with ≥ 20 battles get the passive "keep your tier list"
  sign-in nudge (principle 9). Hub card + Quick Battle links close the loop.
- ✅ **OG share cards, games surfaces** (2026-06-11) — `/og/<card>` serves
  server-rendered 1200×630 PNGs (satori + resvg, committed OFL fonts, daily
  disk cache) for `/games`, Splashdle (today's level-0 crop — spoiler-free
  by definition), Quick Battle (live #1 skin splash + community battle
  count), and the Mirror (tier-letter strip). All four pages carry
  `og:`/`twitter:` meta pointing at their card. Per-entity stable URLs
  (`/skins/<slug>`, `/u/<name>`, ranking slices) still pending — they need
  their pages to exist first.
- ✅ **Static facts dataset + Price Check + skin-line taste** (2026-06-12) —
  `scripts/snapshot-facts.mjs` snapshots Meraki (cost/rarity/availability/
  sets/release) into committed `data/skin-facts.json` (1,797 skins; never
  fetched at runtime; re-run on patch cadence). **Price Check** live at
  `/games/price-check`: five seeded skins a day on distinct champions,
  guess each RP tier (520–3250 buttons), win = 3+ exact, 🟩/🟨(one tier
  off)/🟥 share grid, legacy fun-facts, streaks, hub checklist slot, OG
  card. The Mirror's taste profile now mixes **skin lines** ("you
  over-index on Coven") with champions, competing on |delta|; Meraki's
  catch-all "Legacy" set is excluded. 📌 Correction to the note below:
  Meraki `release` was populated on all 1,797 skins in this snapshot —
  **the Drought Index is unblocked**.
- ◻ Leaderboards, feedback surface beyond Quick Battle (rank deltas on skin
  pages), patch ingestion pipeline (beyond 12-hourly catalog re-sync),
  per-entity stable URLs, Drought Index — **not started**.

**Architecture note**: game state currently lives in the TanStack Start SSR
layer (server functions + SQLite at `web/.data/games.db` — persisted via the
`gamesdata` volume in `docker-compose.coolify.yml`), not the Go API; the
schema mirrors Postgres for a mechanical port. Rationale + migration path:
CONTRACT.md "Games framework".

**UX rules locked in from playtesting** (apply to every future game): no
skeletons — route loaders give an SSR-complete first paint; fixed layout
heights so nothing reflows mid-play; entrance animations only for things
that happen after first paint; one-shot animations cleared by timer, not
animationend; every interaction answers back before the round-trip
completes (pending states).

**Next session**: the Skin Drought Index (`/insights/drought`) — per-skin
release dates are in the committed facts dataset now, so "days since last
skin" per champion is pure derived data. Citable from day one.

## Landscape & differentiation

Checked 2026-06-11. There is no dedicated skin-opinion platform — the moat is real:

- **TierMaker** hosts community LoL skin tier lists, but it's a generic drag-and-drop
  tool: ranking 900+ images by hand is homework, lists fragment across dozens of
  duplicate templates, and there's no rating model, no per-skin pages, no identity.
  Our swipe-based instrument is the answer to exactly that friction.
- **LoLdle** owns daily League trivia (5 modes: Classic, Quote, Ability, Emoji,
  Splash) and proved the format's ceiling — it became an official licensed mobile
  app. Two lessons: (1) their Splash mode guesses *champions* from base splashes —
  Splashdle must be guess-the-**skin**, played across the full 1,600-skin catalog,
  to be a different game, not a clone; (2) their five-modes-one-page structure
  works — people clear all dailies in a row (see Daily Hub, Phase 1).
- **The moat**: LoLdle is trivia (facts), TierMaker is static lists. Nobody owns
  *opinions as data* — a live, queryable community ranking. Trivia games are our
  doorway; the opinion dataset is the thing nobody can copy.

---

## Design principles (satisfaction-first)

The product's north star is user satisfaction. Every feature decision gets tested
against these, in priority order:

1. **Every click answers you back.** No interaction ever resolves silently. Within
   a second of any vote: the number moves, the rank shifts, or you learn where you
   stand ("62% agree with you"). A vote into a void is the least satisfying
   interaction on the internet — we never ship one.
2. **The mirror is the killer feature.** The site's deepest satisfaction is showing
   users a structured reflection of their own taste they couldn't articulate
   themselves: an auto-built personal tier list, "your most contrarian takes,"
   "you over-index on Coven." Every battle sharpens *your* profile, not just the
   global ranking. Protect this above all other features.
3. **Scarce choices stay sacred.** 3 stars and 3 bans among ~1,600 skins is an
   agonizing choice, and the agony is the fun — decisions feel meaningful in
   proportion to what they cost. Never loosen the scarcity. Ritualize changes
   ("you're dethroning Elementalist Lux?").
4. **Completion is always visible.** League players are collectors. Per-champion
   wardrobe completion ("rated 82/170 champions") satisfies the collector itch and
   organically pushes users into the unexposed corners of the catalog — the
   data-sparsity fix wearing a progress bar.
5. **Gut feel over homework.** Game interactions are snap judgments with zero
   deliberation cost. Anything that makes a user stop and analyze is friction.
6. **Pacing beats efficiency.** A statistically optimal matchmaker serves nothing
   but agonizing 50/50s — exhausting. Mix in easy dunks (free dopamine; confirms
   the system "gets it") and marquee title fights. Sacrifice statistical
   efficiency for feel; the data still comes.
7. **Streaks reward showing up; they don't punish absence.** Broken streaks are
   churn moments. Offer freeze tokens; surface "best streak" alongside "current."
8. **Raw events are the source of truth; ratings are derived.** Store every match
   result and vote forever, including *which question was asked*. Models can
   always be recomputed better later — but only from data we kept.
9. **No gate before the fun.** Every daily game is playable in ten seconds with no
   account — guest progress accrues server-side under an anonymous ID and attaches
   losslessly on sign-up (see "Scoped: guest-first play"). The sign-up ask comes
   only after value exists ("create an account to keep your tier list"). And the
   swipe loop is thumb-first: share links open on phones, so the mobile
   experience IS the first impression for most new users.

---

## The rating system

### Two jobs, two layers

Every interaction serves one of two purposes, and the architecture keeps them
distinct:

- **Expression layer** (the engagement job): up/down, stars, bans, your personal
  tier list. This is the user's *identity* — their takes, their profile.
- **Measurement layer** (the informational job): pairwise battles feeding a
  rating model. This is the *instrument* that produces the trustworthy community
  ranking.

The same click can serve both: every Quick Battle vote updates the global rating
**and the user's personal rating**. The user thinks they're building their tier
list; we're building the dataset. Perfectly aligned incentives.

### Why pairwise is the measurement backbone

Absolute voting has four structural flaws no volume fixes: no calibration across
users, exposure bias toward popular champions, sparsity across ~1,600 skins, and
zero resolution among the top skins (thirty 90%-upvoted skins can't be ordered).
Pairwise comparison fixes all four: self-calibrating, exposure controlled by the
matchmaker, information-dense (each result propagates through the comparison
graph), and infinite resolution at the top.

### Role of each mechanic (nothing deleted — recast)

| Mechanic | Role |
|---|---|
| Up/down | Lightweight personal mark + weak prior in the model. Lowest-friction interaction for casual visitors. **Decision: counts stay publicly visible** — they're alive and responsive early; the Elo ranking takes over as the headline number once dense. |
| Star ×3 / Ban ×3 | Strongest preference signal we have (choosing 3 of 1,600 is costly = informative). Profile centerpiece ("signature skins"). Scarcity is permanent. |
| Pairwise battle | Measurement backbone. Feeds global rating + personal rating simultaneously. |

### Model decisions (design-level)

- **Battle question: single axis at launch.** "Which do you like more?" — pure
  gut feel (principle 5). The schema records which question was asked, so themed
  lenses (best splash / best in-game / etc.) can be added later as occasional
  variety days without poisoning the dataset. Lenses are never the default.
- **Elo UX, Bradley-Terry truth.** Skins are static, so Bradley-Terry (or
  TrueSkill, with uncertainty) is the statistically right fit. Practical split:
  a cheap live Elo-style update for instant feedback ("+12, now #34") and a
  periodic full refit from raw match history for the canonical ranking.
- **Uncertainty is a feature.** Every skin carries rating ± confidence and battle
  count ("1480 ± 90 · 23 battles"). Low-confidence skins get a "needs more votes"
  flag — sparse data becomes a visible community quest, not an embarrassment.
- **Matchmaking is editorial power.** Mostly informative pairs (close rating,
  high uncertainty — which are also the fun, hard choices), seeded with placement
  matches for new/under-sampled skins, paced with easy dunks and occasional
  marquee matchups (principle 6). The same machinery later picks Hot Takes
  (most divisive pairs) and seeds Skin Cup brackets — one system, three features.
- **New skins** enter with provisional ratings, a "new" badge, and boosted
  placement-match frequency. Their first-month rating trajectory is content.
- **Art updates re-open ratings.** When Riot ships an ASU or new splash for an
  existing skin, old votes describe art that no longer exists. Policy: tag every
  match with an asset-version epoch; on visual update, widen the skin's
  uncertainty and boost its placement frequency rather than hard-resetting.
  ("Riot updated this skin — does it still hold up?" is itself content.)

---

## Cold-start strategy

We don't have dense vote data yet. Three tactics:

1. **Zero-data games first.** Daily puzzles built on static Riot/Data Dragon
   assets (splashes, names, RP prices, release dates) need no community votes and
   drive the traffic that produces votes.
2. **Pairwise comparison is the data engine.** Quick Battle's swipe loop generates
   ranking data as a side effect of fun — people will play 50 rounds where they'd
   cast 5 browsing votes. Skin Cup brackets are the same trick at event scale.
3. **Gate phases by metrics, not dates.** Thresholds double as public community
   milestones ("100k battles fought — Community Mode unlocked").

Until data is dense, rankings display as "Early Rankings — still calibrating"
with battle counts visible: thin data framed as a call to action.

---

## Phase 0 — Foundations

Shared infrastructure every game reuses. Build once; each later game becomes a
1–2 week project.

- **Daily seed system** — same puzzle for everyone, resets at midnight UTC,
  deterministic from date.
- **Guest sessions + account merge** — principle 9. Server-side anonymous
  sessions; sign-up attaches credentials to the existing record. Fully scoped
  below ("Scoped: guest-first play").
- **Streak tracking** — per-user, per-game; freeze tokens and "best streak" from
  day one (principle 7).
- **Shareable results** — emoji-grid / score-card share text, plus **auto-generated
  OG share-card images**: every skin, ranking slice, tier list, and daily result
  gets a stable URL that unfurls beautifully on Discord/Twitter/Reddit. Citability
  (the whole Insights strategy) requires permanent link targets — this is
  infrastructure, not polish.
- **Leaderboards** — daily / weekly / all-time, per game.
- **Match & rating storage** — raw pairwise results (with question-asked,
  asset-version, and voter-trust-tier fields), global ratings, **per-user
  personal ratings**, uncertainty.
- **Feedback surface** — the "answers you back" layer (principle 1): rank deltas,
  agreement percentages, completion counters. Cross-cutting, so it's
  infrastructure, not per-game polish.
- **Patch ingestion pipeline** — League ships skins every ~2 weeks. New-skin
  ingestion (Data Dragon/CDragon sync → placement matches → "new this patch"
  surface) must be automatic, or the site silently goes stale and trust dies.
- **Static skin facts dataset** — RP price, rarity, availability, skin line,
  chroma count. ✅ Feasibility confirmed (2026-06-11): Data Dragon has no
  price/rarity; CommunityDragon has rarity but 801/2,087 skins are `kNoRarity`
  (all budget tiers), so rarity → price doesn't work alone. **Source: Meraki
  Analytics CDN** (`cdn.merakianalytics.com/riot/lol/resources/latest/en-US/
  champions/<Champ>.json`) — has explicit per-skin `cost` in RP, `rarity`, and
  `availability` (Available vs Legacy — exclude/mark legacy skins in Price
  Check). Community-maintained, so snapshot it into our own committed dataset
  via a periodic pull script; never depend on it at runtime. ⚠ `releaseDate`
  was null in sampling — release-year games need a separate source (wiki or
  skin-ID ordering as a rough proxy) before being promised.

### Scoped: guest-first play

The architectural decision: **server-side anonymous sessions**, not
localStorage-only progress. Guest battles must feed the global rating (anonymous
first-timers from shared links are the biggest traffic segment — losing their
swipes wastes the data engine) and anti-abuse needs server visibility. So:

- First visit mints a guest ID (cookie + localStorage backup). A guest is a real
  user record without credentials attached. Battles, streaks, daily results, and
  the personal tier list all accrue server-side from swipe one.
- **Sign-up is attachment, not migration**: Logto sign-up links credentials to
  the existing guest record. Edge case — signing in to an *existing* account
  with guest progress on the device: merge by union of battles (recompute
  personal rating from the union), keep the better streak. Lossless or it's a
  churn landmine.
- **Permission split** (falls out of the principles): anything that's *playing*
  is guest-open — all dailies, Quick Battle, viewing rankings, own tier list.
  Anything *scarce, public, or social* needs an account:
  - Stars/bans — scarcity is meaningless if clearing cookies grants 3 fresh
    stars; this is also the obvious abuse vector.
  - Named leaderboard placement (guests can see boards, not occupy them).
  - Daily Draft submissions & comments — moderation needs accountability.
- **Trust weighting**: guest battles count toward global ratings at reduced
  weight and tighter rate limits; weight upgrades retroactively when the guest
  converts (raw events are kept forever, so the refit just re-weights).
- **Conversion prompts fire when value exists, never before play** (principle 9):
  end of first daily ("save your streak"), ~20 battles ("your tier list is
  taking shape — keep it"), and the moment a guest taps a star — the highest-
  intent moment on the site, because they're already committed to a specific skin.
- Honest pitch when localStorage is the only tether: "your progress lives on
  this device until you create an account."

### Scoped: patch-cadence pipeline

Runs unattended; staleness is how fan sites die. Daily check (patches land
~biweekly but hotfixes vary):

1. **Detect** — poll Data Dragon's versions endpoint for a new patch.
2. **Diff** — new champion/skin IDs vs. our catalog; changed splash assets
   (hash/URL change) trigger an asset-version epoch bump → uncertainty widening
   per the ASU policy.
3. **Ingest** — new skins: assets, names, IDs, skin-line tags; re-snapshot the
   Meraki facts dataset and diff prices/availability (legacy-vaulting changes
   Price Check's pool).
4. **Activate** — new skins enter the placement-match queue with the "new"
   badge and boosted matchmaking frequency.
5. **Announce** — "New this patch" surface on the site; later, the Discord bot
   posts the drop (Phase 2). New-skin hype days are the site's natural traffic
   spikes — the pipeline is what lets us catch them while they're hot.
6. **Alert** — pipeline failure or anomalous diff (e.g., mass skin removals,
   six weeks with zero new skins) pings us instead of silently rotting. New
   ingests land in a lightweight review queue: auto-live, human-glanced.

Scope guard: live-patch skins only (Data Dragon = live). Meraki's "Upcoming"
availability flag is the future hook for Release Day Predictions, not Phase 0.

### Scoped: stable URLs & share cards

Citability is a product surface. Two rules: every entity has a permanent URL,
and every URL unfurls into a purpose-built OG image — a citation that unfurls
badly is a citation lost.

| Page | URL shape | OG card shows |
|---|---|---|
| Skin | `/skins/<slug>` | Splash, rating ± confidence, rank, battle count |
| Champion wardrobe | `/champions/<id>` | Skin grid, best/worst, completion stats |
| Ranking slice | `/rankings/<slice>` (per line, price tier, year…) | Top 3 podium + slice title |
| Matchup result | `/battles/<a>-vs-<b>` | Both splashes, win % split |
| Personal tier list | `/u/<name>` | Tier strip + signature (starred) skins |
| Daily result | `/daily/<game>/<date>` | Emoji grid + streak (no spoilers pre-completion) |
| Insight pages | `/insights/<slug>` | Headline stat (e.g., drought leader + days) |

- Cards are server-generated images from templates per page type, cached, and
  regenerated when underlying ratings shift materially.
- Slugs derive from names with skin ID as the immutable key — names can change
  (Riot renames skins occasionally); IDs redirect, links never die.
- Daily-result cards must not spoil the answer for people who haven't played —
  the share grid is the teaser, never the solution.

## Phase 1 — Zero-data launch

Goal: prove the daily loop, seed the rating table, make the mirror real.

**The Daily Hub**: all daily games live on one page with a unified "today"
checklist (☑ 3/4 complete) and one combined share grid. LoLdle proved players
clear every mode in a row when they're adjacent — separate pages would throw
that compounding away. The hub is the homepage habit loop.

| Game | Loop | Data needed |
|---|---|---|
| **Splashdle** (flagship) | Tight crop of a **skin** splash, zooms out per wrong guess, 6 guesses, streak + share grid. Guess-the-skin across all ~1,600 — deliberately NOT LoLdle's guess-the-champion | Splash art only |
| **Quick Battle** | Two skins, pick one, next pair — endless swipe; every pick updates global + personal ratings | Splash art only |
| **Price Check** | Guess the RP tier (520/750/975/1350/1820/…); legacy skins surfaced as a fun fact ("not even buyable anymore") | Static price data |
| **Chroma Vision** (rotation/hard mode) | Name the skin from its color palette or silhouette | Splash art only |

**The mirror ships in Phase 1, not later** — it's nearly free once Quick Battle
exists and it's likely the strongest early retention hook:

- Auto-built **personal tier list** from battle history
- **"Your most contrarian takes"** — biggest gaps vs. the community (shareable)
- **Taste profile** — skin lines you over/under-index on
- **Wardrobe completion** per champion (principle 4)

**Skin Drought Index** (Insights, zero-data): auto-computed "days since last
skin" per champion from static data. Skin-drought discourse is a permanent
Reddit genre — this page is citable from day one and costs nothing.

Identity layer: streaks + completion live from day one.

## Phase 2 — Community-scale games

Unlock when: median ≥ ~10 battles per skin AND daily actives make community
voting feel populated.

- **Skin Cup** — monthly 64-skin bracket seeded from Quick Battle ratings ("the
  community's top 64") so the data visibly matters. One matchup round per day.
  Bracket-prediction layer: lock picks before round 1, score as results land —
  public vindication ("called it") is the satisfaction engine here.
- **Hot Takes** — daily divisive matchup auto-picked from pairs the model says are
  closest to 50/50, with discussion thread. Manufactured drama from real data.
- **Wishlist Battles** — "which champion deserves the next skin more?" — the same
  pairwise engine pointed at a new question, producing a community-ranked skin
  wishlist alongside the Drought Index. Deeply citable ("the most skin-starved
  champions, ranked by 50k players") and a standing community cause. Near-free:
  the machinery already exists.
- **Daily Draft** — themed prompt ("best beach-episode lineup", "max drip on a
  3000 RP budget"); assemble a 5-skin lineup; community votes; winner featured on
  the homepage next day. Gate on DAU (lineup voting must feel alive) **and on
  moderation tooling** — see Guardrails.
- **Compatibility scores** — compare tier lists with a friend; the social mirror.
  Every recruited friend is also new measurement data.
- **Discord presence** — server + bot that posts the daily puzzle drop, Hot Take
  of the day, and Cup results. The LoL audience lives on Discord; this is the
  re-engagement channel that doesn't depend on users remembering to visit.

Identity layer: badges (streaks, cup results, prediction accuracy).

## Phase 3 — Data-rich endgame

Unlock when: rankings are stable enough that predictions and comparisons feel fair.

- **Higher or Lower — Community Mode** — "which does the community rate higher?"
  (Can ship earlier in *objective* mode — which costs more RP / which is older —
  community mode is the milestone unlock.)
- **Release Day Predictions** — predict where a new skin line settles after 2
  weeks. Ties the site to the live game's news cadence; forecaster leaderboard.
- **Ranked divisions** — Iron → Challenger from weekly game performance, seasonal
  resets. (Seasons reset *competitive* standings only — personal tier lists,
  stars, and completion never reset; identity is permanent, competition is
  seasonal.)
- **Season Awards** — the season finale. Categories (Best Splash, Biggest Cash
  Grab, Most Improved Wardrobe…), a live-voted ceremony week, then archive the
  season's rankings and reset. Annual traffic spike + creator-friendly format.

## Insights track (parallel to the games track)

The informational half of the mission — what makes the site *citable*. Every
Reddit argument that links "skinbattle has it #4" is free distribution. Grows
with data density:

1. **Drought Index** (day one): objective, zero community data — see Phase 1.
2. **Sliced rankings** (early): best per champion, per skin line, per price tier,
   per year. "Best 975 RP skins" is a purchasing guide nobody does well.
3. **Value index** (mid): rating relative to price — "most overpriced Legendaries"
   writes its own Reddit thread.
4. **Time series** (mid): snapshot ratings forever; new-skin trajectories,
   "skins that aged well," and sentiment on new monetization tiers
   (Exalted/gacha approval tracking — topical and citable every time Riot ships
   one).
5. **State of Skins** (late): annual data-journalism report from voter-segment
   splits (do mains rate their champ's skins differently? owners vs non-owners?).

Every insight page needs a stable URL + OG share card (Phase 0 infra) — a
citation that unfurls badly is a citation lost.

---

## Guardrails & operations

Constraints to design within from day one — cheaper now than retrofitted.

- **Riot IP & legal.** Plan: submit the site to Riot for approval (developer
  portal product registration is the formal channel). Until/unless granted, we
  design within the fan-content policy ("Legal Jibber Jabber") as if it's
  permanent: non-commercial — no paywalls, no crowdfunding, no premium tiers;
  passive ads only; site-wide "not endorsed by Riot Games" disclaimer. Designing
  to these constraints costs nothing now and is exactly what makes the approval
  submission credible (LoLdle's path: get big within the rules, then get
  licensed).
- **Data integrity / anti-abuse.** The moment rankings matter, they'll be
  attacked: champion-main Discords brigading their skins, bots, spite-voting,
  random clickers farming streaks. Design-level mitigations: rate-limit battles
  per session; occasionally re-serve a pair to the same user as a consistency
  probe (random clickers contradict themselves); weight votes by account
  consistency in the periodic refit; keep raw data forever (principle 8) so any
  attack can be retroactively filtered. Display trust comes first: a ranking
  known to be gameable is worthless as an instrument.
- **UGC moderation.** Daily Draft lineups and Hot Takes threads are user content
  in a community that loves edgy names. Report buttons, a word filter, and a
  removal workflow are launch prerequisites for those features — not fast-follows.
- **Patch-cadence operations.** Every ~2 weeks: new skins auto-ingested, facts
  dataset re-snapshotted and diffed, new skins entering placement. This must run
  unattended; staleness is the most common way fan sites die.

---

## Sequencing summary

```
Phase 0  Framework: daily seed, guest sessions + merge, streaks,
         share + OG cards + stable URLs, leaderboards, match/rating
         storage (global + personal), feedback surface, patch
         ingestion, static facts dataset
Phase 1  Daily Hub: Splashdle · Quick Battle · Price Check · Chroma
         Vision + the mirror (tier list, contrarian takes, taste
         profile, completion) + Drought Index
   ▼     (threshold: ~10 battles/skin median + healthy DAU)
Phase 2  Skin Cup · Hot Takes · Wishlist Battles · Daily Draft ·
         compatibility · badges · Discord bot
   ▼     (threshold: stable rankings)
Phase 3  Higher/Lower community mode · Release Predictions ·
         ranked divisions · Season Awards
Always   Insights track: drought index → sliced rankings → value
         index → time series → State of Skins
Always   Guardrails: legal constraints · anti-abuse · moderation ·
         patch ops
```

The flywheel: daily puzzles bring people in → Quick Battle turns visits into
ranking data *and* personal tier lists → the mirror brings people back → data
powers Skin Cup / Hot Takes / Insights → events and citations bring new people
in → identity (streaks, ranks, completion, signature skins) makes leaving
costly → Season Awards resets the loop each year.
