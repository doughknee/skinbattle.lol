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
  /battle/tier-drop      Rank a champion's skins S–D in one pass
  /battle/splashdle      Daily: name the skin from a sliver of splash
  /battle/price-point    Daily: guess the RP
  /battle/chroma-vision  Daily: name the skin from its colors
  /battle/leaderboards   Streaks, fastest solves, battle volume
/skins                   The catalog door — "All Skins" lens (tab bar links
                         the two lenses; one nav door, two routes)
  /skins/$slug           Leaf: skin dossier (see display rules)
/champions               The catalog's "By Champion" lens (keeps its URL;
                         lives under the Skins door in every nav surface)
  /champions/$id         Leaf: champion dossier — answer block, ranked skins,
                         wardrobe, lore. Deliberately ungated: all 173 index
                         regardless of battle volume (DONI-85).
/rankings                Every verdict surface (redirects to /rankings/all;
                         slice discovery is the slice bar on the page itself)
  /rankings/$slice       Leaf: all | price-* | line-* | champion-* | year-*
  /rankings/drought      Days since each champion's last skin
/methodology             How the rating works + where each number comes from.
                         Not under /rankings: skin and champion pages cite it
                         too, so it is the site's provenance page, not a
                         rankings view. /rankings/elo 301s here (DONI-83).
/profile                 YOU = the Mirror (PR 4): your tier list, hot takes,
                         wardrobe, completion. Account is a quiet tab.
                         Works for guests (guests battle too) → doubles as the
                         sign-up pitch: "this is your page — sign in to keep it."
```

Infra (unchanged): `/callback`, `/og/*`, `/games-status`, `/games-attach`,
`/sitemap.xml`.

Participation routing (not doors, not leaf content, not indexed - see
`docs/participation-loop.md`):

```
/battle?champion=<id>    The same arena, dealt from one wardrobe: every
                         ranking surface's "Help settle …" lands here.
                         &skin=<id> pins that skin into the first pair.
                         Canonical stays /battle; the scoped page is noindex.
/settle                  Hub of champion rankings still provisional or
                         untouched, each linking into the scoped battle.
                         noindex, outside the site map registry on purpose.
```

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

## Display rules — one rating system

Battle Elo is the sole rating system. Catalog voting (stars, bans, and the
older up/down vote) has been removed entirely.

- **Elo is the rank.** Anywhere skins are ordered (#N, rankings, sorts), it is
  battle-driven.
- **Skin pages show the dossier** — Elo ± uncertainty, rank, win%, battle
  count, price, facts, release.
- Champion pages lead with the answer block (lib/games/answer.ts) over a ranked
  list of the rated skins, then the full wardrobe with Elo rank badges, sorted
  by release order or battle rating. The wardrobe excludes num 0 (the base
  look), the same set /skins and the ranking slices count.

## Migration map (every old URL gets a redirect stub; no chains)

| Old                   | New                    |
|-----------------------|------------------------|
| /games                | /battle                |
| /games/quick-battle   | /battle                |
| /games/splashdle      | /battle/splashdle      |
| /games/price-check    | /battle/price-point    |
| /games/chroma-vision  | /battle/chroma-vision  |
| /games/leaderboards   | /battle/leaderboards   |
| /games/mirror         | /profile (the profile IS the Mirror) |
| /battle/price-check   | /battle/price-point    |
| /battle/mirror        | /profile (brief interim home during the move) |
| /battle/tiers         | /battle/tier-drop (renamed after launch) |
| /rankings/elo         | /methodology (the explainer grew into the provenance page) |
| /leaderboards         | /battle/leaderboards (retargeted stub) |
| /awards               | /rankings/all (Awards retired with star/ban voting) |
| /rankings/awards      | /rankings/all (Awards retired with star/ban voting) |
| /insights/drought     | /rankings/drought (existing stub) |
| /champions (index)    | stays — it IS the "By champion" lens of the Skins door (PR 2; no redirect needed, both pages share the catalog tab bar) |
| /account, /user/votes | /profile (existing stubs) |

Champion detail pages keep their URLs (/champions/$id) — they're leaf content,
not a door. The catalog merge keeps the existing champion-grid UX intact as
the "By champion" lens (two views, one door — not a redesign).

## Navbar

**Battle · Skins · Rankings** + search (Ctrl+K) + account. Battle styled as the
accent item — it's the brand verb. Dropdowns stay registry-driven: Battle ▾
(dailies, tier drop), Skins ▾ (the two catalog lenses). Rankings is a plain
link — its slice bar does discovery in-page. The account button owns the
profile/Mirror; the footer carries it too, so a signed-out visitor (whose
account button says "Sign in") still has a way in.

## Home page funnel

Hero: **Battle now** → /battle. Secondary: **See the rankings**.
Below: today's-challenges strip (streak continuity), then catalog teasers.
First 10 seconds = battling; first session = a daily + a ranking slice;
return visits = streaks, leaderboard spot, your Mirror sharpening.

## Delivery phases

1. **PR 1 — the IA itself** ✅ shipped: registry, URL moves, redirect stubs (no
   chains), Battle-accented navbar, home hero → Battle.
2. **PR 2 — catalog merge** ✅ shipped (DONI-88): /skins "All Skins" lens,
   CatalogTabs joining it to /champions, three doors restored.
   **/champions does NOT redirect** — it is the second lens and keeps its URL.
   (An earlier draft of this line said "/champions index redirect", which
   contradicted the migration map two sections up. The map was right.)
3. **PR 3 — dossier display rules**: community badges on skin pages, Elo
   badges on champion pages.
4. **PR 4 — profile = the Mirror** (Phase A; public /u/<name> stays gated on
   real players).

## Drift log

The nav drifted from this document once already: it shipped as **Play ·
Rankings · Mirror** with Champions demoted to the footer and `/skins` never
built at all — so the sitemap advertised ~1,900 `/skins/$slug` URLs whose
parent 404'd. DONI-88 restored the three doors above. Two pieces of that drift
were **kept**, because they were real decisions this document simply never
recorded, not accidents:

- **/methodology** replacing `/rankings/elo` (DONI-83) — one rating explainer,
  cited from skin and champion pages, so it outgrew being a rankings view.
- **/battle/tier-drop** — a battle mode added after this plan was written.

Everything else was restored to the plan rather than the plan rewritten to
match the code. One thing is new: the `/rankings/all` nav entry is now labelled
**"Full ranking"**, because the catalog door took the name "All Skins" and two
identical labels in one footer send people to the wrong lens.
