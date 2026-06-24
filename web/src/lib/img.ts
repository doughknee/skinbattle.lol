import type { SyntheticEvent } from 'react'

// Skin splash art comes from CommunityDragon as full-size (1280×720) JPEGs.
// For small renditions — list thumbnails, grid tiles — that's wildly
// oversized: a ~90KB splash painted into a 64px box. Route those through an
// image proxy that resizes + transcodes to WebP on the fly, which cuts 90%+ of
// the bytes (a w=160 thumbnail is ~1.5KB vs ~90KB).
//
// We deliberately do NOT proxy the big above-the-fold splashes (the battle
// hero, page heroes, the lightbox, the on-deck preload): the proxy's
// cold-transcode TTFB (~0.4–0.6s for a never-seen variant) is far slower than
// CommunityDragon's raw ~85ms, and the source is only 1280px wide so there's
// nothing to downscale for a full-bleed image anyway. Those load fastest
// straight from the CDN (warmed by the preconnect in __root.tsx).
//
// wsrv.nl is a free, Cloudflare-backed resizer. To move to Cloudflare Images
// or another proxy — or to turn proxying off entirely — change the two
// constants below; every call site flows through here.
const IMG_PROXY_ENABLED = true
const PROXY = 'https://wsrv.nl/'

// Proxy a CommunityDragon splash at a target pixel width. Size `width` to
// roughly 2× the rendered CSS width so it stays crisp on retina screens.
// WebP, not AVIF: wsrv's AVIF output 400s, and WebP is universally supported
// and already ~55% smaller than the source JPEG.
export function skinThumb(url: string, width: number, quality = 80): string {
  if (!IMG_PROXY_ENABLED || !url) return url
  return `${PROXY}?url=${encodeURIComponent(url)}&w=${width}&output=webp&q=${quality}`
}

// onError fallback: if the proxy is ever down or rate-limits, swap back to the
// raw CDN URL once so the image still renders. Pair with `data-raw={url}` on
// the <img>. The dataset flag guards against a fallback→error loop.
export function fallbackToRaw(e: SyntheticEvent<HTMLImageElement>): void {
  const img = e.currentTarget
  if (img.dataset.fellBack || !img.dataset.raw) return
  img.dataset.fellBack = '1'
  img.src = img.dataset.raw
}
