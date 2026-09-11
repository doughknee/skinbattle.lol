import type { ReactNode } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFlaskVial, faRankingStar } from '@fortawesome/free-solid-svg-icons'
import type { AnswerBlock, AnswerConfidence } from '~/lib/games/answer'

// The verdict panel: the site's standing answer to "which skin is best here",
// shared by every surface that has an answerBlock (champion pages, ranking
// slices). One component so the two never drift apart in register - a reader
// who lands on /champions/ahri and then /rankings/all should recognise the
// same voice making the same kind of claim.
//
// Provisional is not the exception, it is the ordinary state at a global
// scope: the confident band is ±100 Elo, and a #1 across the whole catalog has
// far more near neighbours to separate itself from than a #1 inside one
// champion's wardrobe. So it gets the SAME panel, the same prominence and the
// same weight as a settled ranking - only the accent changes. A verdict that
// reads as a measurement earns more trust than a fabricated #1, and the CTAs
// the caller passes as children are how a page stops being provisional.
const TONE: Record<
  AnswerConfidence,
  { label: string; wrap: string; accent: string; bar: string }
> = {
  confident: {
    label: 'Settled',
    wrap: 'bg-gold5/20 outline-gold2/50',
    accent: 'text-gold2',
    bar: 'bg-gold2/80',
  },
  provisional: {
    label: 'Provisional',
    wrap: 'bg-blue5/30 outline-blue3/50',
    accent: 'text-blue1',
    bar: 'bg-blue2/80',
  },
  empty: {
    label: 'No battles yet',
    wrap: 'bg-hextech-black/40 outline-icon/25',
    accent: 'text-grey1',
    bar: 'bg-icon/40',
  },
}

export default function Verdict({
  answer,
  rated,
  total,
  children,
}: {
  answer: AnswerBlock
  // Skins with battle data, and skins catalogued. Two different numbers, and
  // the panel shows both rather than letting either stand in for the other.
  rated: number
  total: number
  children?: ReactNode
}) {
  const tone = TONE[answer.confidence]
  const pct = Math.min(100, Math.round((100 * rated) / Math.max(1, total)))

  return (
    <section
      aria-labelledby="verdict-heading"
      className={`animate-fade-up p-6 outline -outline-offset-2 md:p-8 ${tone.wrap}`}
    >
      <h2
        id="verdict-heading"
        className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.25em] text-gold2"
      >
        <FontAwesomeIcon
          icon={answer.confidence === 'confident' ? faRankingStar : faFlaskVial}
          className="h-3.5 shrink-0"
        />
        Community verdict
        <span className={`font-normal tracking-widest ${tone.accent}`}>
          · {tone.label}
        </span>
      </h2>

      {/* Body face, not font-serif/font-bold: globals.css routes bold body text
          into Cinzel, which is all-caps display type - fine for a heading, a
          wall to read as a two-line sentence. Size and colour carry the weight. */}
      <p className="mt-4 text-xl leading-relaxed text-gold1 md:text-2xl">
        {answer.answer}
      </p>
      <p className="mt-3 max-w-2xl text-grey1">{answer.basis}</p>

      {/* Coverage as a measured quantity, same idiom as the ranking slices. */}
      <div className="mt-5 max-w-sm">
        <div
          className="h-1 w-full bg-hextech-black/60"
          title={`${rated} of ${total} rated`}
        >
          <div className={`h-full ${tone.bar}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 text-xs uppercase tracking-widest text-grey1">
          {rated.toLocaleString('en-US')} of {total.toLocaleString('en-US')}{' '}
          rated
        </p>
      </div>

      {children && (
        <div className="mt-6 flex flex-wrap items-center gap-3">{children}</div>
      )}
    </section>
  )
}
