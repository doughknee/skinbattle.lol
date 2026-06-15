# Tier List — battle spec

A Battle-tab game where a player drags a coherent set of skins into S/A/B/C/D
tiers. One submission emits dozens of pairwise comparisons into the same rating
engine Quick Battle feeds, so it is the highest-throughput way to gather ranking
data — and the shareable artifact recruits new voters, which is the real
bottleneck (the rankings are sound; the voter base is 12 people).

This is a **battle**, not a daily game: it feeds `skin_ratings`, lives under the
Battle tab, and shares the Quick Battle rating engine (`ratings.ts`). It is one
game with three ways to populate a board.

## Product role

- **Throughput.** A 12-skin board implies ~35 pairwise comparisons. ~500 boards
  ≈ the ~28k comparisons needed for trustworthy rankings, versus 28,000 single
  1v1s. It is the depth engine.
- **Acquisition.** A finished tier list is a screenshot people share. Pure 1v1
  is not. This is the format that grows the voter base past the current ~12.
- **Connectivity.** Champion boards are within-champion (dense islands); line /
  year / price / rarity / theme boards are cross-champion, supplying the bridge
  edges a global ranking needs (see Connectivity).
- **Mirror (principle 2).** Each submission also updates the player's personal
  taste model, so one tier list richly seeds their mirror.

## Core loop

1. **Served a board** — a coherent set (a champion's skins by default), no choice
   required. Skins shown as splash tiles, **ratings hidden** (seeing the numbers
   would bias the placement — same rule as 1v1).
2. **Drag into tiers** — S/A/B/C/D, free-size. Any number per tier; a tier may be
   empty; skins may be left in an unplaced tray (no data for those, no penalty).
3. **Submit** → the implied comparisons update the ratings instantly (principle
   1: every action answers back).
4. **Compare** — the payoff: "you put Elementalist in S — 82% of players agree,"
   plus your hot takes. Not "solvable"; the social mirror is the reward.
5. **Rank another →** serves the next coverage-needed board, uncapped within a
   session. The daily board is the habit anchor, not a ceiling.

## Modes & board axes

One game, three ways a board gets populated:

| Surface | Who | Selection |
| --- | --- | --- |
| **Today's board** | everyone, default | one globally-chosen board per UTC day (shareable: "compare with friends today") |
| **Rank another →** | engaged users, same sitting | personalized, coverage-aware stream |
| **Make your own** | power users / sharers | player picks a *scope*, never arbitrary skins |

**Make-your-own axes** all reuse the `rankings.ts` slice resolver and
`factsFor()` — no new metadata needed for the first five:

| Axis | Board id | Membership source | Span |
| --- | --- | --- | --- |
| Champion | `champion:<id>` | `catalog_skins.champion_id` | within-champ (default) |
| Skin line | `line:<slug>` | `factsFor(id).sets` | cross-champ |
| Year | `year:<yyyy>` | `factsFor(id).release` prefix | cross-champ |
| Price tier | `price:<rp>` | `factsFor(id).cost` ∈ `PRICE_TIERS` | cross-champ |
| Rarity | `rarity:<kind>` | `factsFor(id).rarity` | cross-champ |
| Theme | `theme:<slug>` | curated tag list (new metadata) | cross-champ |
| Custom | `custom:<hash>` | explicit skin-id set | any |

Fun extras worth featuring later: **Ultimate skins** (small, iconic, cross-champ),
**Worlds/esports**, **Prestige**, **"skins you own"** (personalized; ownership is
a soft preference signal), **line rivalries** ("Star Guardian vs K/DA").

The non-champion axes double as connectivity bridges — picking them is good for
the graph, not just for fun.

## Board model & identity

A board is a **scope** plus the **resolved skin set** at serve time.

- **Board id** = the scope key (`champion:Lux`, `line:star-guardian`, …, or
  `custom:<hash>`). Stable, human-legible, used for per-user dedup.
- **Board hash** = `sha256(sortedSkinIds).slice(0, 12)`. Detects content drift:
  when Riot adds a Lux skin, `champion:Lux`'s hash changes, so the board is
  materially new and re-serveable even to players who did the old one.
- **Membership** = `allCatalogSkins(db).filter(resolver.match)` — the existing
  rankings `match` functions, refactored into a shared `resolveScope(db, id)` used
  by both rankings and tier lists.

### Size policy

- **Target 6–15 skins.** Most champions land here naturally.
- **< 4 skins** → too thin to be fun or informative; skip the scope (or, for tiny
  champions, fold into a related themed board).
- **> 15 skins** → served boards cap at **12**, choosing the 12 that most need
  data (highest inflated-uncertainty members), so a served board always targets
  coverage. Make-your-own may show the full set.

## Board selection

Two selectors, both built on the same coverage signal that drives the v1.2.1
matchmaker (`coverageDeficit` / inflated `uncertainty`).

### Today's board (global, daily)

- Chosen **once per UTC day, same for everyone**, and frozen — reuse the
  `daily_puzzles` table (`game='tier-list'`, `puzzle_date`, `payload={boardId}`),
  exactly like Splashdle's daily freeze.
- Picked from coverage-need candidates, **balanced against appeal** so the daily
  isn't always an obscure champion: `score = meanMemberUncertainty × popularity^α`.
  Date-seeded RNG over the top candidates for variety.
- Global + frozen is what makes "here's my take on today's set" shareable and
  comparable across friends.

### Rank another (personalized stream)

`pickBoard(db, user)`:

1. **Candidates**: all champion boards + a rotating slice of themed boards (for
   connectivity).
2. **Score** by coverage need: `mean(inflateUncertainty(member))`, lightly
   popularity-weighted.
3. **Exclude completed-by-this-user** boards *unless stale* (see Dedup).
4. **Exclude session-recent** boards (the last N shown this sitting — mirrors the
   1v1 "last 16" exclusion).
5. **Weighted-random** pick from the top-K (freshness over greedy).

### Duplicate handling

The reframe: **cross-user duplicates are the goal** (50 people ranking Lux = 50
opinions on Lux). We only avoid boring the *same* user with a repeat.

A completed board is recorded by its `(boardId, boardHash)` (derived from the
user's `tier_submitted` events — indexed, no extra table needed). Re-serve a board
the user already did only when **stale**:

- **Contents changed** — current `boardHash` ≠ the hash they submitted (new skin
  in the set). Their old list is now incomplete.
- **Cooldown elapsed** — e.g. 30 days.
- **Confidence decayed** — the set's mean uncertainty has re-inflated past a
  threshold (the v1.2.1 Glicko time-decay literally signals "this data went stale,
  re-ask"). Same mechanism that resurfaces skins in the 1v1 matchmaker resurfaces
  *boards* here.

Coverage-aware selection makes dupes rare for free: once you rank Lux, she's
better-sampled, so the selector moves on.

## Tiering UX

- 5 tiers **S A B C D**, color-coded, free-size, drag-and-drop, with an unplaced
  tray. Partial submission allowed.
- **Ratings hidden** until after submit.
- Mobile: tap-to-place fallback (tap skin → tap tier) since drag is fiddly on
  touch.
- Submit enabled at ≥ a minimum placed count (e.g. ≥4) so a near-empty board
  doesn't count.

## Data model

### Event (source of truth — principle 8)

One append-only `game_events` row per submission. New `type: 'tier_submitted'`
added to the `GameEvent` union in `db.ts`.

```jsonc
// payload
{
  "boardId":   "champion:Lux",
  "boardHash": "ab12cd34ef56",
  "boardType": "champion",            // champion|line|year|price|rarity|theme|custom
  "tiers": { "S": ["99007"], "A": ["99001","99018"], "B": [...], "C": [...], "D": [] },
  "placed":  10,
  "total":   13,
  "pairs":   35                       // implied cross-tier comparisons (analytics)
}
```

`game='tier-list'`, `questionAsked='which-tier'`, plus `assetVersion` and
`trustTier` as today. The full ordering is captured, so every derived number is
rebuildable by a refit — and a future Plackett-Luce refit can use the richer
signal without a backfill.

### Derived state

No new tables required for MVP:

- **Completions / dedup**: query `tier_submitted` events by `(user_id,
  json_extract(payload,'$.boardId'))` — add an index mirroring the existing
  `idx_game_events_battle_pair`.
- **Daily board**: reuse `daily_puzzles`.
- **Nonce single-use**: reuse `battle_nonces`.

## Rating integration

### Decomposition

On submit, expand the placed skins into implied comparisons: **every skin in a
higher tier beats every skin in a lower tier**; same-tier pairs are **ties**
(skipped in MVP — they carry the least signal but are logged for later). For
tiers with sizes `n_S … n_D`, the comparison count is
`P = Σ_{i above j} n_i · n_j`.

### Correlation down-weight (the honesty knob)

P comparisons from one rater in one sitting are **not** P independent
observations. Each implied comparison carries

```
weight = trust × downweight
trust      = MEMBER_WEIGHT (1.0) | GUEST_WEIGHT (0.5)     // existing
downweight = min(1, EFFECTIVE_CAP / P)                    // EFFECTIVE_CAP ≈ 8
```

so one list injects at most ~`EFFECTIVE_CAP` effective comparisons no matter how
big the board. This keeps `uncertainty` truthful: losing to four skins in your
list is not the same as losing four independent battles. `EFFECTIVE_CAP` is the
single tunable; start at 8 and calibrate against real data.

### Live update (instant feedback)

A batched, order-free "round" Elo update — `applyTierListUpdate(db, tiers, trust)`
— run in the same transaction as the event append (like `applyLiveUpdate`):

```
for each placed skin i:
  opp   = placed skins in a different tier
  S_i   = #opp in a LOWER tier            // wins (ties excluded)
  E_i   = Σ_opp expectedScore(r_i, r_opp) // expected
  Δ_i   = kFor(inflate(u_i)) × downweight × (S_i − E_i)
apply Δ_i; decay each placed skin's uncertainty by (downweight × #opp);
set last_battle_at = now   // ties into v1.2.1 time-decay
```

Batched (not sequential) so placement order carries no bias. Also apply the same
decomposition, unweighted, to `user_skin_ratings` — the personal mirror.

### Refit

Extend `runRefit` to also read `tier_submitted` events, explode each into its
cross-tier pairs, and fold them into the existing `wins` / `games` / `pairs` maps
with the per-submission `downweight`. Bradley-Terry then treats tier-list and 1v1
data uniformly. No model change.

### Battles vs comparisons (coverage interaction)

Keep two notions distinct:

- **`battles`** (display + the coverage/placement signal) increments **+1 per
  appearance** — a skin placed in a tier list counts as one appearance, not P.
  This makes tier-list participation satisfy the v1.2.1 coverage-driven matchmaker
  (a skin ranked in a list no longer reads as zero-battle), correctly relieving
  1v1 placement pressure.
- **BT `games` / `wins`** use the down-weighted comparison counts — that's what
  actually moves the rating.

## Community-compare payoff

The post-submit screen (principle 1, the reward that replaces "solvable"):

- **Per skin**: your tier vs the **community tier**, and "X% of players placed it
  in <your tier>."
- **Community tier (MVP)**: bucket the board's skins by global rating into S–D
  quintiles *within the board* — always available, even before tier-list data
  accrues. **Later**: the modal tier from actual `tier_submitted` history for that
  skin on that board.
- **Hot takes**: the skins where you deviate most from consensus, called out
  ("nobody else put Star Guardian in C").
- Each placed skin shows its rating delta from this submission.

## Share

`/og/tierlist/<boardId>.<boardHash>` (and a per-submission variant) → a satori
card rendering the tiers with splash tiles, via the existing `og.ts`
satori→Resvg→PNG pipeline and daily PNG cache. `ogMeta()` points `og:image` at it.
The share link opens the compare view.

## Fairness & integrity

- **Signed board token** (HMAC, exactly like `signPair`/`verifyPairToken`): serving
  a board mints a token over `{boardId, boardHash, skinIds, iat, nonce}`. On submit,
  the tiers may contain **only** skins from the dealt board — blocks forged boards
  injecting arbitrary comparisons. Make-your-own boards are signed at "start."
- **Single-use nonce** (reuse `battle_nonces`): a board submission counts once.
- **Rate limits** (own caps, fewer than 1v1 since each is bigger): e.g. guest
  20/day, member 50/day, plus a per-minute cap — same inline pattern as
  `enforceRateLimit`.
- **Ratings hidden during ranking** (anti-bias).

## Connectivity

Champion boards build dense *within-champion* knowledge but no cross-champion
edges. Guarantee bridges by: (1) keeping themed (line/year/price/rarity) boards in
the served rotation, (2) the 1v1 marquee/dunk cross-champion pairs, and (3)
brackets (the planned battle #2). Track the comparison graph's connected-component
count as a health metric; if champion islands form, raise themed-board frequency.

## Rollout

- **Phase 1 (MVP)** — champion boards only (today's board + rank-another +
  make-your-own champion). Decomposition → existing refit with down-weight; live
  update + personal mirror; signed token + nonce + rate limit; compare via rating
  quintiles; share image. Needs only `catalog_skins` + `ratings.ts`.
- **Phase 2** — line / year / price / rarity axes (refactor `resolveSlice` into a
  shared `resolveScope`); themed daily rotation for connectivity; real
  tier-distribution community compare; "make your own" axis picker.
- **Phase 3** — Plackett-Luce refit (native ties + full orderings), theme curation,
  "skins you own," richer share cards.

## Open decisions

1. **`EFFECTIVE_CAP`** down-weight (start 8) — tune against real submissions.
2. **Served board size cap** (12?) and small-champion (<4 skin) handling.
3. **Daily submission caps** (20/50?).
4. **Five tiers (S–D) vs six (S–F)** — MVP: five.
5. **Community-tier source** at launch — rating quintiles (proposed) vs waiting for
   placement history.
6. **Re-serve cooldown** length — fixed 30 days, purely decay-driven, or both.
7. **Do same-tier ties ever inform?** MVP no; revisit with Plackett-Luce.

## Metrics

- **Distinct voters/week** — the north star (acquisition).
- Submissions/day; effective comparisons/submission.
- **Coverage lift** — skins crossing the 10-battle floor attributable to tier lists.
- Connectivity — comparison-graph component count.
- Share rate; daily-board return rate.
