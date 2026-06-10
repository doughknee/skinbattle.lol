import { Link } from '@tanstack/react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { btnPrimarySm, btnSecondarySm } from '~/lib/ui'

// Designed error state shared by route errorComponents, so a failed fetch
// looks intentional instead of a bare red string.
export default function ErrorState({
  title = 'Something went wrong',
  message,
  retry = true,
  back,
}: {
  title?: string
  message?: string
  retry?: boolean
  back?: { to: string; label: string }
}) {
  return (
    <div className="container mx-auto flex flex-col items-center px-6 pt-36 pb-24 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-hextech-black/60 outline outline-red-400/40 -outline-offset-2">
        <FontAwesomeIcon
          icon={faTriangleExclamation}
          className="h-6 text-red-300"
        />
      </div>
      <h1 className="mb-2 font-serif text-3xl font-bold text-gold1">{title}</h1>
      {message && <p className="mb-8 max-w-md text-grey1">{message}</p>}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {retry && (
          <button
            onClick={() => window.location.reload()}
            className={btnPrimarySm}
          >
            Try again
          </button>
        )}
        {back && (
          <Link to={back.to} className={btnSecondarySm}>
            {back.label}
          </Link>
        )}
      </div>
    </div>
  )
}
