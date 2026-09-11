import { useEffect } from 'react'
import { usePostHog } from 'posthog-js/react'
import {
  championOfPath,
  pageTypeOf,
  parseShareReferral,
  stripUtm,
} from '~/lib/games/settle'

// Records a visit that arrived through one of our own share links
// (utm_source=share, see settle.ts shareUrl), then takes the campaign
// parameters off the address bar. Mounted once in __root, next to
// GuestAttachment.
//
// Attribution itself needs no code: PostHog reads utm_* off the URL when it
// initialises - the provider mounts above this component, so that has already
// happened by the time this effect runs - and stamps them on the session and
// the entry $pageview. The explicit event is what lets the funnel count
// referred visits and split them by medium; stripping the URL afterwards is
// what keeps the parameters out of the next <Link> and out of a re-share
// copied from the address bar, so first-touch stays the first touch.
//
// Module-level guard: the root remounts under React's dev double-invoke, and
// an arrival is one event however many times the effect runs.
let handled = false

export default function ShareReferral() {
  const posthog = usePostHog()
  useEffect(() => {
    if (handled) return
    const { pathname, search, hash } = window.location
    const ref = parseShareReferral(search)
    if (!ref) return
    handled = true
    posthog?.capture('share_referred_visit', {
      utm_medium: ref.medium,
      page_type: pageTypeOf(pathname),
      champion: championOfPath(pathname),
      path: pathname,
    })
    // Deferred a tick so nothing still reading the URL in this frame (the
    // initial $pageview included) sees it change underneath it. The router's
    // own history state rides along untouched.
    const t = setTimeout(() => {
      history.replaceState(history.state, '', `${pathname}${stripUtm(search)}${hash}`)
    }, 0)
    return () => clearTimeout(t)
  }, [posthog])
  return null
}
