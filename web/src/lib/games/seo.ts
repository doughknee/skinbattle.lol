// Indexing policy for the data pages. Pre-launch, most ranking slices and skin
// pages are near-empty: ~1,900 skins and dozens of slices, almost none with
// real battle data yet. Letting Google index thousands of thin, near-duplicate
// pages dilutes the whole site's authority and burns crawl budget. So thin
// pages carry `noindex,follow` (link equity still flows through them) and
// graduate to indexable once they hold real data.
//
// Thresholds are deliberately low - the goal is to keep *empty* pages out of
// the index, not to gate genuinely substantive early pages. The "Early
// Rankings - still calibrating" banner is a separate, UX-only signal: a page
// can be calibrating (thin sample) yet still substantive enough to index.

// A ranking slice needs at least this many rated skins to be worth indexing.
export const MIN_INDEXABLE_RATED = 8
// A skin page needs at least this many community battles to be worth indexing.
export const MIN_INDEXABLE_BATTLES = 3

export const sliceIsIndexable = (ratedCount: number): boolean =>
  ratedCount >= MIN_INDEXABLE_RATED

export const skinIsIndexable = (battles: number | null | undefined): boolean =>
  (battles ?? 0) >= MIN_INDEXABLE_BATTLES

// Robots meta for a page's head(). Empty when indexable - the absence of a
// robots tag means index,follow by default, so we only emit when suppressing.
export function robotsMeta(
  indexable: boolean,
): { name: string; content: string }[] {
  return indexable ? [] : [{ name: 'robots', content: 'noindex,follow' }]
}
