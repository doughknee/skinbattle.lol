import { Link } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMap } from '@fortawesome/free-solid-svg-icons'
import { btnPrimarySm, btnSecondarySm } from '~/lib/ui'

// Designed 404, registered as the router's notFoundComponent so a bad URL
// looks intentional instead of a bare default message.
export default function NotFound() {
  return (
    <div className="container mx-auto flex flex-col items-center px-6 pt-36 pb-24 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-hextech-black/60 outline outline-gold5/60 -outline-offset-2">
        <FontAwesomeIcon icon={faMap} className="h-6 text-gold2" />
      </div>
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-gold2">
        404
      </p>
      <h1 className="mb-2 font-serif text-3xl md:text-4xl font-bold text-gold1">
        Lost in the jungle
      </h1>
      <p className="mb-8 max-w-md text-grey1">
        This page doesn't exist — it may have moved, or the link was mistyped.
        Ward up and head somewhere familiar.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link to="/" className={btnPrimarySm}>
          Back to Home
        </Link>
        <Link to="/champions" className={btnSecondarySm}>
          Browse Champions
        </Link>
      </div>
    </div>
  )
}
