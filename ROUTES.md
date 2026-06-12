# Route & IA Plan

The site map registry (`web/src/lib/siteMap.ts`) is the single source of truth
for navigation — navbar, footer, command palette, 404, and /sitemap.xml all
render from it. This document is the plan for what belongs in that registry and
why. Update both together.

## The model: three doors, three verbs

```
Battle      Do.    The loop itself + the daily challenges.
Skins       Find.  One catalog; every skin and champion page is a dossier.
Rankings    See.   Every verdict the community has produced.
```

Plus **You** (profile, behind the account button — not a nav door) and Home on
the logo. A first-time visitor learns three words, each a different kind of
action. No pair of doors competes for the same job.

Leaf content (champion pages, skin pages, ranking slices — hundreds of routes)
never appears in navigation. It exists for search, SEO, and link-sharing.
Route count is not a smell; door count is.

## Target tree

```
/                        Home — hero CTA drops straight into /battle
/battle                  Quick Battle PLAYS HERE (no landing page in the way),
                         with "Today's challenges" + leaderboards strip below
  /battle/splashdle      Daily: name the skin from a sliver of splash
  /battle/price-check    Daily: guess the RP
  /battle/chroma-vision  Daily: name the skin from its colors
  /battle/leaderboards   Streaks, fastest solves, battle volume
/skins                   The catalog door — "All Skins" lens (tab bar links
                         the two lenses; one nav door, two routes)
  /skins/$slug           Leaf: skin dossier (see display rules)
/champions               The catalog's "By Champion" lens (keeps its URL;
                         lives under the Skins door in every nav surface)
  /champions/$id         Leaf: champion dossier — wardrobe, lore, voting.
/rankings                Every verdict surface
  /rankings/$slice       Leaf: all | price-* | line-* | champion-* | year-*
  /rankings/drought      Days since each champion's last skin
  /rankings/awards       Community Awards — the star & ban superlatives
/profile                 YOU = the Mirror (PR 4): your tier list, hot takes,
                         wardrobe, completion. Votes & settings are quiet tabs.
                         Works for guests (guests battle too) → doubles as the
                         sign-up pitch: "this is your page — sign in to keep it."
```

Infra (unchanged): `/callback`, `/og/*`, `/games-status`, `/games-attach`,
`/sitemap.xml`.

## Why "Battle" absorbs the dailies

The brand is skinbattle.lol — Battle is the door, and with Quick Battle as the
door's own landing (not buried in a hub), labeling the dailies "today's
battles" is honest theming rather than a mislabel. The hook is maximal: the
nav's first item and the home CTA both drop you INTO the game. The daily
ritual stays one tap deep via the "Today" strip on /battle and via the Battle
dropdown.

Decision record: /battle doubling as the game itself is deliberate (time-to-fun
beats an overview page; the strip below the game and the Battle ▾ dropdown are
the overview). If it ever feels wrong, insert a hub at /battle and shift the
game down one level — a redirect, not a rebuild.

## Display rules — two currencies, one job each (PR 3)

The site has two rating systems: battle Elo and community votes
(10 stars + 10 bans per player; up/down voting is retired). They stop being
confusing when each surface picks one job:

- **Elo is the rank.** Anywhere skins are ordered (#N, rankings, sorts), it is
  battle-driven.
- **Stars/bans are the superlatives.** Scarce and emotional. Shown as badges
  (★ 214 · ⛔ 12), never as a competing rank. They power /rankings/awards.
- **Skin pages show everything** — the dossier: Elo ± uncertainty, rank, win%,
  battle count, stars, bans, price, facts, release.
- Champion pages surface Elo rank badges; net-vote framing is gone with
  up/down voting — star/ban counts remain as unranked sort options.

Later phase (gated on real player density + Go API work): Elo becomes the only
canonical rank everywhere; stars/bans remain engagement + superlative currency.

## Migration map (every old URL gets a redirect stub; no chains)

| Old                   | New                    |
|-----------------------|------------------------|
| /games                | /battle                |
| /games/quick-battle   | /battle                |
| /games/splashdle      | /battle/splashdle      |
| /games/price-check    | /battle/price-check    |
| /games/chroma-vision  | /battle/chroma-vision  |
| /games/leaderboards   | /battle/leaderboards   |
| /games/mirror         | /profile (the profile IS the Mirror) |
| /battle/mirror        | /profile (brief interim home during the move) |
| /leaderboards         | /battle/leaderboards (retargeted stub) |
| /awards               | /rankings/awards       |
| /insights/drought     | /rankings/drought (existing stub) |
| /champions (index)    | stays — it IS the "By champion" lens of the Skins door (PR 2; no redirect needed, both pages share the catalog tab bar) |
| /account, /user/votes | /profile (existing stubs) |

Champion detail pages keep their URLs (/champions/$id) — they're leaf content,
not a door. The catalog merge keeps the existing champion-grid UX intact as
the "By champion" lens (two views, one door — not a redesign).

## Navbar

**Battle · Skins · Rankings** (+ Champions until PR 2 lands) + search (Ctrl+K)
+ quota + account. Battle styled as the accent item — it's the brand verb.
Dropdowns stay registry-driven: Battle ▾ (dailies, leaderboards), Rankings ▾
(full ranking, slices, drought, awards). Account menu owns the profile/Mirror.

## Home page funnel

Hero: **Battle now** → /battle. Secondary: **See the rankings**.
Below: today's-challenges strip (streak continuity), then catalog teasers.
First 10 seconds = battling; first session = a daily + a ranking slice;
return visits = streaks, leaderboard spot, your Mirror sharpening.

## Delivery phases

1. **PR 1 — the IA itself**: registry, URL moves, redirect stubs (no chains),
   Battle-accented navbar, home hero → Battle.
2. **PR 2 — catalog merge**: /skins lenses, /champions index redirect, 3 doors.
3. **PR 3 — dossier display rules**: community badges on skin pages, Elo
   badges on champion pages.
4. **PR 4 — profile = the Mirror** (Phase A; public /u/<name> stays gated on
   real players).
