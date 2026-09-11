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

// ─── the voter floor ────────────────────────────────────────────────────────

// Mirrors BATTLE_VOTER_SKIN_CAP in server/ratings.ts, duplicated for the same
// reason FRESH_UNCERTAINTY is; answer.test.ts asserts the two stay equal.
export const VOTER_SKIN_CAP = 6

// Distinct voters the leader needs before "is the highest-rated" is a claim
// about a community rather than about one person's afternoon.
//
// Derived from the two constants above, not chosen: the refit caps any ONE
// voter's weighted pull on a single skin at VOTER_SKIN_CAP, and a
// ±MAX_CONFIDENT_UNCERTAINTY band needs weightedBattlesFor() weighted battles
// to exist at all. Divide, round up, and you have the smallest number of
// people that band can honestly have come from. The band already implied this
// floor - nothing enforced it, because Tier Drop's per-skin cap is per
// submission with no ceiling across submissions, and the refit never asked
// how many people were in the room. So this is not a new bar so much as the
// identity half of the one already published.
export const MIN_CONFIDENT_VOTERS = Math.ceil(
  weightedBattlesFor(MAX_CONFIDENT_UNCERTAINTY) / VOTER_SKIN_CAP,
)

// What a signed-out cookie is worth as a *person*. Deliberately the same 0.5
// as GUEST_WEIGHT, and deliberately a separate constant: that one discounts a
// vote for trust, this one discounts an id for independence, and they only
// happen to agree. A guest id is not a person - one visitor clearing cookies
// becomes several, one shared laptop makes several visitors one - so counting
// guest ids at face value would let a determined afternoon manufacture a
// "community" verdict. Counting them at zero would be worse: almost nobody
// signs in, so members-only would mean this site never says anything about
// the votes it actually runs on. Half is the honest middle, and /methodology
// prints the weakness rather than burying it.
const GUEST_VOTER_WEIGHT = 0.5

export type AnswerConfidence = 'confident' | 'provisional' | 'empty'

// ─── inputs ─────────────────────────────────────────────────────────────────

// Heads behind a skin's battle record, split by trust tier. Two counts, never
// a list: no id, no per-person total and no voting history reaches this layer,
// so nothing here can leak into a page, a description or JSON-LD.
export interface AnswerVoters {
  members: number
  guests: number
}

export interface AnswerLeader {
  name: string
  rating: number
  uncertainty: number
  battles: number
  // Who is behind `battles`. A band is a sample size; this is a head count,
  // and a ranking needs both before it can say "community".
  voters: AnswerVoters
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

// People, at face value - the number a page is allowed to print.
const voterHeads = (v: AnswerVoters | null | undefined): number =>
  count(v?.members) + count(v?.guests)

// The same people, discounted for how much a cookie proves - the number that
// decides. Separate from voterHeads on purpose: the site should say how many
// visitors it heard from, and judge on how many of those it can vouch for.
export const hasEnoughVoters = (v: AnswerVoters | null | undefined): boolean =>
  count(v?.members) + GUEST_VOTER_WEIGHT * count(v?.guests) >=
  MIN_CONFIDENT_VOTERS

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

  // Two conditions, one verdict. The band asks whether the order is real; the
  // head count asks whose order it is. Thirteen battles from one person buy
  // exactly the same ±100 as thirteen from thirteen people, so a site selling
  // *community* rankings cannot let the band answer both questions alone.
  const heads = voterHeads(leader.voters)
  // Dropped entirely at zero rather than printed as "0 voters": a leader with
  // battles and no traceable voter is a data fault, not a sentence to write.
  const from = heads > 0 ? ` from ${plural(heads, 'voter')}` : ''

  if (isConfident(leader.uncertainty) && hasEnoughVoters(leader.voters)) {
    return {
      confidence: 'confident',
      answer: `${name} is the highest-rated of the ${scope}, at ${rating} Elo (±${num(band)}).`,
      basis: `That rests on ${plural(battles, 'head-to-head battle')} for ${name}${from}, a band narrow enough to separate it from the field and enough separate people to call it a community result. ${coverage}`,
    }
  }

  // Provisional: the ordinary case at current volume, and written to read like
  // a measurement rather than an apology. The number is real; the ranking just
  // is not settled, and the page says which of the two bars it missed. Same
  // word either way - one scale, one vocabulary, both explained on
  // /methodology - because a reader should never have to learn a second one.
  const lead =
    rated === 1
      ? `${name} is the only one of the ${scope} with battle data so far, at ${rating} Elo`
      : `${name} currently rates highest of the ${scope}, at ${rating} Elo`
  const settledRule = `A placing here is settled once its band reaches ±${num(MAX_CONFIDENT_UNCERTAINTY)} Elo, which takes about ${plural(weightedBattlesFor(MAX_CONFIDENT_UNCERTAINTY), 'weighted battle')}, and once ${plural(MIN_CONFIDENT_VOTERS, 'separate voter')} stand behind the leader, counting a signed-out visitor as half a person.`

  if (!isConfident(leader.uncertainty)) {
    return {
      confidence: 'provisional',
      answer: `${lead}, but at ±${num(band)} that placing is provisional.`,
      basis: `It rests on ${plural(battles, 'head-to-head battle')}${from} so far. ${settledRule} ${coverage}`,
    }
  }

  // The band is inside the bar and the ranking still is not settled: the
  // evidence is there, the crowd is not. Naming that plainly is the whole
  // point of the rule - a narrow band from two people is a strong measurement
  // of two people.
  return {
    confidence: 'provisional',
    answer: `${lead}, but too few people have voted on it for that placing to be settled.`,
    basis: `Its band is tight, at ±${num(band)} over ${plural(battles, 'head-to-head battle')}${from}, but a community ranking needs more than that. ${settledRule} ${coverage}`,
  }
}
