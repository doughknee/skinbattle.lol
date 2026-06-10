import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'

// Global splash-art lightbox. Call openLightbox(...) from anywhere;
// <Lightbox /> (mounted once in the root) renders the overlay.

interface LightboxItem {
  url: string
  title: string
  subtitle?: string
}

const EVENT = 'sb:lightbox'

export function openLightbox(item: LightboxItem) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EVENT, { detail: item }))
}

export default function Lightbox() {
  const [item, setItem] = useState<LightboxItem | null>(null)

  useEffect(() => {
    const onOpen = (e: Event) => setItem((e as CustomEvent).detail)
    window.addEventListener(EVENT, onOpen)
    return () => window.removeEventListener(EVENT, onOpen)
  }, [])

  useEffect(() => {
    if (!item) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setItem(null)
    }
    document.addEventListener('keydown', onKeyDown)
    // Lock page scroll while the lightbox is open.
    const prevOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.documentElement.style.overflow = prevOverflow
    }
  }, [item])

  if (!item) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${item.title} splash art`}
      className="fixed inset-0 z-[95] flex flex-col items-center justify-center bg-hextech-black/90 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setItem(null)
      }}
    >
      <button
        onClick={() => setItem(null)}
        aria-label="Close"
        title="Close (Esc)"
        className="absolute right-4 top-4 flex h-10 w-10 cursor-pointer items-center justify-center bg-hextech-black/60 text-grey1 outline outline-icon/30 -outline-offset-1 hover:text-gold1 hover:outline-icon transition duration-150"
      >
        <FontAwesomeIcon icon={faXmark} className="h-5" />
      </button>
      <img
        src={item.url}
        alt={`${item.title} splash art`}
        className="max-h-[82vh] max-w-full object-contain shadow-2xl outline outline-gold5/60 -outline-offset-1"
      />
      <div className="mt-4 text-center">
        <p className="font-serif text-xl font-bold text-gold1">{item.title}</p>
        {item.subtitle && (
          <p className="text-sm italic text-grey1">{item.subtitle}</p>
        )}
      </div>
    </div>
  )
}
