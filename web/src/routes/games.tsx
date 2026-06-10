import { createFileRoute, Link } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faDice, faArrowRight } from '@fortawesome/free-solid-svg-icons'

export const Route = createFileRoute('/games')({
  component: GamesPage,
})

function GamesPage() {
  return (
    <div className="container mx-auto px-6 pt-28 min-h-[80vh] flex flex-col items-center justify-center text-center">
      <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-hextech-black/40 outline outline-gold5/60 -outline-offset-2">
        <FontAwesomeIcon icon={faDice} className="h-10 text-gold2" />
      </div>
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
        Coming Soon
      </p>
      <h1 className="font-serif text-5xl md:text-6xl font-bold text-gold1 mb-4">
        SkinBattle Games
      </h1>
      <p className="max-w-xl text-lg text-grey1 mb-10">
        Community-driven challenges that test your skin knowledge — guess the
        splash, draft the best set, and climb the leaderboards. We're building
        it now.
      </p>
      <Link
        to="/champions"
        className="group inline-flex items-center justify-center gap-3 bg-hextech-black/40 border-2 border-transparent outline outline-icon/30 -outline-offset-2 hover:outline-icon transition duration-150 font-serif text-grey1 hover:text-gold1 text-lg font-bold px-8 py-4"
      >
        Vote on skins while you wait
        <FontAwesomeIcon
          icon={faArrowRight}
          className="h-4 transition-transform duration-150 group-hover:translate-x-1"
        />
      </Link>
    </div>
  )
}
