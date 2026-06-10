import { useId } from 'react'

/**
 * The "Crown" mark — inline copy of assets/svg/crown-primary.svg so it ships
 * with the bundle (no extra request) and scales crisply at any size.
 * Brand rule: the crown only ever sits on dark navy / near-black.
 */
export function CrownMark({ className }: { className?: string }) {
  // Unique gradient id so the mark can render more than once per page.
  const id = useId()
  const cg = `crown-glow-${id}`
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 120"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={cg} cx="50%" cy="30%" r="55%">
          <stop offset="0%" stopColor="#0AC8B9" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0AC8B9" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="44" r="40" fill={`url(#${cg})`} />
      <path
        d="M24 82 L33 34 L48 60 L60 22 L72 60 L87 34 L96 82 Z"
        fill="#C8AA6E"
        stroke="#C8983C"
        strokeWidth="2"
        strokeLinejoin="miter"
      />
      <path d="M24 82 L33 34 L40 49 Z" fill="#F0E6D2" opacity="0.18" />
      <path d="M48 60 L60 22 L60 60 Z" fill="#F0E6D2" opacity="0.18" />
      <path d="M72 60 L87 34 L80 60 Z" fill="#F0E6D2" opacity="0.18" />
      <path d="M33 34 L48 60 L40 49 Z" fill="#785A28" opacity="0.42" />
      <path d="M60 22 L72 60 L60 60 Z" fill="#785A28" opacity="0.42" />
      <path d="M87 34 L96 82 L82 60 Z" fill="#785A28" opacity="0.42" />
      <path d="M33 34 L40 60" stroke="#C8983C" strokeWidth="1" opacity="0.55" fill="none" />
      <path d="M60 22 L60 60" stroke="#C8983C" strokeWidth="1" opacity="0.55" fill="none" />
      <path d="M87 34 L80 60" stroke="#C8983C" strokeWidth="1" opacity="0.55" fill="none" />
      <rect x="24" y="80" width="72" height="16" fill="#785A28" stroke="#C8983C" strokeWidth="1.5" />
      <rect x="24" y="80" width="72" height="4.5" fill="#C8AA6E" opacity="0.65" />
      <circle cx="60" cy="22" r="5.6" fill="#0AC8B9" stroke="#CDFAFA" strokeWidth="1" />
      <circle cx="33" cy="34" r="4.2" fill="#F0E6D2" />
      <circle cx="87" cy="34" r="4.2" fill="#F0E6D2" />
      <circle cx="40" cy="88" r="2.4" fill="#0AC8B9" />
      <circle cx="52" cy="88" r="2.4" fill="#F0E6D2" />
      <circle cx="60" cy="88" r="2.4" fill="#0AC8B9" />
      <circle cx="68" cy="88" r="2.4" fill="#F0E6D2" />
      <circle cx="80" cy="88" r="2.4" fill="#0AC8B9" />
    </svg>
  )
}

/**
 * Canonical wordmark — engraved caps `SKINBATTLE.LOL` in Cinzel, colored per
 * the brand guidelines (SKIN gold1 · BATTLE gold2 · .LOL muted gold).
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`font-serif font-bold tracking-wide ${className ?? ''}`}>
      <span className="text-gold1">SKIN</span>
      <span className="text-gold2">BATTLE</span>
      <span className="text-titleText">.LOL</span>
    </span>
  )
}
