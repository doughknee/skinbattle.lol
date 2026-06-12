import { useEffect, useState } from 'react'

// Minimal event-based toast system. Call toast('Star 2/3 used') from
// anywhere; <Toaster /> (mounted once in the root) renders the stack.

export type ToastType = 'info' | 'success' | 'error'

// Optional extras: a toast can be a link (opens in a new tab) and can ask
// for more reading time than the default.
interface ToastOptions {
  href?: string
  durationMs?: number
}

interface Toast extends ToastOptions {
  id: number
  message: string
  type: ToastType
}

const TOAST_EVENT = 'sb:toast'
const TOAST_DURATION_MS = 3000

export function toast(
  message: string,
  type: ToastType = 'info',
  options: ToastOptions = {},
) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(TOAST_EVENT, { detail: { message, type, ...options } }),
  )
}

let nextId = 1

export default function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent).detail as Omit<Toast, 'id'>
      const id = nextId++
      setToasts((prev) => [...prev.slice(-3), { id, ...detail }])
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, detail.durationMs ?? TOAST_DURATION_MS)
    }
    window.addEventListener(TOAST_EVENT, onToast)
    return () => window.removeEventListener(TOAST_EVENT, onToast)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div
      aria-live="polite"
      className="fixed bottom-6 left-1/2 z-[100] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => {
        const look = `w-fit max-w-full bg-hextech-black/95 px-4 py-2.5 text-sm font-semibold shadow-lg outline -outline-offset-1 backdrop-blur ${
          t.type === 'error'
            ? 'text-danger outline-danger-border/60'
            : 'text-gold1 outline-gold2/60'
        }`
        return t.href ? (
          <a
            key={t.id}
            role="status"
            href={t.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`${look} pointer-events-auto cursor-pointer transition duration-150 hover:outline-gold2`}
          >
            {t.message} <span aria-hidden>→</span>
          </a>
        ) : (
          <div key={t.id} role="status" className={look}>
            {t.message}
          </div>
        )
      })}
    </div>
  )
}
