// The answer block: one direct sentence plus its provenance, built from live
// ratings by deterministic template. No model runs at request time - the same
// data always renders the same words, which is the whole point. An answer
// engine quoting this page should be quoting something reproducible.
//
// Why this is not `seo.ts`: that file decides what to *index*, and its bar is
// deliberately at the floor (3 battles - "is there anything here at all?").
// This file decides what to *claim*, which is a much higher bar ("is the order
// real?"). Sharing one constant between the two would silently tie a phrasing
// promise to a crawl-budget decision. See /methodology, which documents both.

// ─── the confidence threshold ───────────────────────────────────────────────

// Mirrors START_UNCERTAINTY in server/ratings.ts. Duplicated rather than
// imported because ratings.ts pulls in node:sqlite and this module ships to
// the browser; answer.test.ts asserts the two stay equal.
export const FRESH_UNCERTAINTY = 350

// A ranking is quotable once its leader's band is at most this wide.
//
// Derivation, from the engine's own numbers - not a new statistical model.
// runRefit sets uncertainty = FRESH_UNCERTAINTY / sqrt(weighted battles), so
// the band *is* the sample size, already computed per skin. Two skins whose
// ±100 bands do not overlap sit at least ~200 Elo apart, and expectedScore()
// reads a 200-point gap as a 76% win rate - a preference a reader would
// actually recognise. At the ±270 band a 3-battle skin carries, the same test
// needs a ~540-point gap, which is wider than most of the rated field: the
// order there is close to noise, and saying "best" would be a claim the data
// cannot pay for.
export const MAX_CONFIDENT_UNCERTAINTY = 100

// Weighted battles needed to reach a given band, inverting the refit formula.
// "Weighted" because a signed-out vote counts half (GUEST_WEIGHT), so the raw
// battle count that gets you there is between 1x and 2x this.
export const weightedBattlesFor = (uncertainty: number): number =>
  Math.ceil((FRESH_UNCERTAINTY / uncertainty) ** 2)

export type AnswerConfidence = 'confident' | 'provisional' | 'empty'

// ─── inputs ─────────────────────────────────────────────────────────────────

export interface AnswerLeader {
  name: string
  rating: number
  uncertainty: number
  battles: number
}

export interface AnswerInput {
  // What the list covers, as a plural noun phrase: "Ahri skins",
  // "975 RP skins", "League of Legends skins". Rendered mid-sentence.
  scope: string
  // Highest-rated member with battle data, or null when none has any.
  leader: AnswerLeader | null
  // Members with battle data, and members in total.
  rated: number
  total: number
}

export interface AnswerBlock {
  confidence: AnswerConfidence
  // The direct answer. One sentence, always grammatical, never empty.
  answer: string
  // What the answer rests on. One or two sentences.
  basis: string
}

// ─── formatting ─────────────────────────────────────────────────────────────

// Locale pinned: this string is rendered on the server and hydrated on the
// client, so an ambient locale would produce a mismatch.
const num = (n: number): string =>
  Math.round(n).toLocaleString('en-US')

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${num(n)} ${n === 1 ? one : many}`

// Every interpolated value passes through here or num(). A skin whose catalog
// name went missing must degrade to a dull sentence, never to "undefined".
const text = (s: string | null | undefined, fallback: string): string => {
  const t = typeof s === 'string' ? s.trim() : ''
  return t.length > 0 ? t : fallback
}

const count = (n: number | null | undefined): number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0

// A rating can legitimately be any finite number; 0 is not a safe fallback for
// "missing", so an unusable rating drops the page to the provisional branch.
const usableRating = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n)

export const isConfident = (uncertainty: number | null | undefined): boolean =>
  usableRating(uncertainty) &&
  uncertainty > 0 &&
  uncertainty <= MAX_CONFIDENT_UNCERTAINTY

// ─── the block ──────────────────────────────────────────────────────────────

export function answerBlock(input: AnswerInput): AnswerBlock {
  const scope = text(input.scope, 'skins')
  const rated = count(input.rated)
  const total = Math.max(count(input.total), rated)
  const leader = input.leader

  // Empty: nothing in scope has ever been battled. Say so plainly - a page
  // that admits it has no answer is worth more than one that fakes a ranking.
  if (!leader || !usableRating(leader.rating) || rated < 1) {
    return {
      confidence: 'empty',
      answer: `No ${scope} have been through a head-to-head battle yet, so there is no community ranking for them.`,
      basis: `The catalog lists ${plural(total, 'skin')} in this group, none with battle data so far.`,
    }
  }

  const name = text(leader.name, 'The leader')
  const rating = num(leader.rating)
  const battles = count(leader.battles)
  const band = count(leader.uncertainty)
  const coverage = `${num(rated)} of ${plural(total, 'skin')} in this group ${
    rated === 1 ? 'has' : 'have'
  } battle data.`

  if (isConfident(leader.uncertainty)) {
    return {
      confidence: 'confident',
      answer: `${name} is the highest-rated of the ${scope}, at ${rating} Elo (±${num(band)}).`,
      basis: `That rests on ${plural(battles, 'head-to-head battle')} for ${name}, a band narrow enough to separate it from the field. ${coverage}`,
    }
  }

  // Provisional: the ordinary case at current volume, and written to read like
  // a measurement rather than an apology. The number is real; the ranking just
  // is not settled, and the page says which.
  const lead =
    rated === 1
      ? `${name} is the only one of the ${scope} with battle data so far, at ${rating} Elo`
      : `${name} currently rates highest of the ${scope}, at ${rating} Elo`
  return {
    confidence: 'provisional',
    answer: `${lead}, but at ±${num(band)} that placing is provisional.`,
    basis: `It rests on ${plural(battles, 'head-to-head battle')} so far. A placing here is settled once its band reaches ±${num(MAX_CONFIDENT_UNCERTAINTY)} Elo, which takes about ${plural(weightedBattlesFor(MAX_CONFIDENT_UNCERTAINTY), 'weighted battle')}. ${coverage}`,
  }
}
