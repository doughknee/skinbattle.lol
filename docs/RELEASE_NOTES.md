# Writing release notes

The `/releases` page is rendered from `web/src/lib/releases.ts`. That file is
curated by hand. Never generate it from git history: commit subjects are
written for engineers, release notes are written for players.

This guide is how to turn a batch of merged work into an entry people actually
enjoy reading.

## The golden rule

Lead with the most exciting user-facing change. Not the biggest diff, not the
hardest engineering, the thing a player would tell a friend about. If the entry
were a single push notification, the first highlight is what it would say.

## Voice

- Plain language. If a League player who has never written code would squint
  at a word, replace it.
- Benefits over implementation. Say what someone can do now, not how it works.
  "Your streaks survive sign-up" beats "guest records are merged via token
  attachment".
- Zero code, file, or library mentions. No function names, no "refactored",
  no "API", no "pipeline" unless you mean the kind oil flows through.
- Write like a human talking to another human. Excitement is allowed and
  encouraged. So are short sentences. Good luck. Have fun.
- No em dashes. Use a period, a comma, a colon, or parentheses instead.

A quick test for every bullet: would this sentence make sense, and sound
exciting, read out loud on a podcast about League skins?

| Engineer-speak (no) | Player-speak (yes) |
| --- | --- |
| Migrated facts snapshot from Meraki CDN to League Wiki SkinData module | New skins now show up here within days of a patch, not months |
| Implemented Logto guest-to-member attachment with lossless merge | Creating an account keeps everything you earned as a guest |
| Filtered phantom chroma variants at catalog sync | Cleared out phantom "skins" that were really chromas |

## Structure

Each entry has exactly two lists, and they do different jobs:

- `highlights`: the wins. One to five bullets, most exciting first. Each
  bullet is one or two sentences and stands alone (someone skimming reads only
  the first line of each). These render big and bright on the page.
- `fixes`: the housekeeping. Bug fixes, polish, small behavior corrections.
  One line each, plain words, no drama. These render collapsed and quiet, so
  group every small thing here instead of diluting the highlights.

If a change is genuinely both (a fix so painful it feels like a feature),
promote it to a highlight and write it as the relief it is.

## Cadence

- Add an entry whenever something ships that a player can feel: a new game, a
  new page, a visible behavior change.
- Quiet stretches of small fixes can batch up: collect them and ship one entry
  about weekly, with the best morsel promoted to a highlight.
- Date is the day the work went live (UTC), not the day you wrote the entry.
- Newest entry goes at the top of the array. Two entries on the same date is
  fine. Shipping twice in a day is a flex, not a problem.

## Template

This matches the `ReleaseEntry` type in `web/src/lib/releases.ts` exactly.
Copy it to the top of the `RELEASES` array and fill it in:

```ts
{
  date: '2026-06-12',
  title: 'One excited line that makes someone want to read on',
  highlights: [
    'The most exciting change, written as what you can do now.',
    'The next win. One or two sentences, skimmable, benefit first.',
  ],
  fixes: [
    'Small fix in one plain line.',
    'Another one. No jargon, no drama.',
  ],
},
```

## Pre-publish checklist

- [ ] First highlight is the single most exciting user-facing change
- [ ] No code, file, function, or library names anywhere
- [ ] Every bullet survives the read-it-out-loud test
- [ ] Small stuff lives in `fixes`, not `highlights`
- [ ] No em dashes
- [ ] Date is the UTC ship date, entry is at the top of the array
