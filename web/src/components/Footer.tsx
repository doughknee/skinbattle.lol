import { Link } from '@tanstack/react-router'
import { CrownMark, Wordmark } from './Brand'

export default function Footer() {
  return (
    <footer className="mt-24 border-t border-icon/20 bg-hextech-black/40">
      <div className="container mx-auto grid gap-10 px-6 py-12 md:grid-cols-3">
        <div>
          <p className="flex items-center gap-2.5">
            <CrownMark className="h-9 w-9" />
            <Wordmark className="text-lg" />
          </p>
          <p className="mt-3 max-w-xs text-sm text-grey1">
            Community-built rankings for every League of Legends skin. Upvote,
            star, and ban your way to the definitive list.
          </p>
        </div>

        <nav aria-label="Footer">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold2">
            Explore
          </p>
          <ul className="space-y-2 text-sm">
            <li>
              <Link
                to="/champions"
                className="text-grey1 hover:text-gold1 transition duration-150"
              >
                Champions
              </Link>
            </li>
            <li>
              <Link
                to="/skins"
                className="text-grey1 hover:text-gold1 transition duration-150"
              >
                Skins
              </Link>
            </li>
            <li>
              <Link
                to="/awards"
                className="text-grey1 hover:text-gold1 transition duration-150"
              >
                Awards
              </Link>
            </li>
            <li>
              <Link
                to="/profile"
                className="text-grey1 hover:text-gold1 transition duration-150"
              >
                My Profile
              </Link>
            </li>
          </ul>
        </nav>

        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold2">
            Legal
          </p>
          <p className="text-xs leading-relaxed text-grey1/80">
            skinbattle.lol isn't endorsed by Riot Games and doesn't reflect the
            views or opinions of Riot Games or anyone officially involved in
            producing or managing Riot Games properties. Riot Games and all
            associated properties are trademarks or registered trademarks of
            Riot Games, Inc. Splash art is the property of Riot Games.
          </p>
        </div>
      </div>
      <div className="border-t border-icon/10 py-4 text-center text-xs text-grey1/70">
        © {new Date().getFullYear()} skinbattle.lol
      </div>
    </footer>
  )
}
