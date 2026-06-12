// Open Graph / Twitter meta for the games surfaces (client-safe — used in
// route head() options). Every stable URL points at its purpose-built share
// card under /og/<card> so links unfurl with a real image instead of nothing.
//
// Absolute URLs are required by scrapers; SITE_ORIGIN overrides for other
// deployments (head() runs on the server during SSR, where env is available,
// and the canonical constant is correct for SPA navigations too).

const ORIGIN =
  (typeof process !== 'undefined' && process.env.SITE_ORIGIN) ||
  'https://skinbattle.lol'

export function ogMeta(opts: {
  title: string
  description: string
  card: 'games' | 'splashdle' | 'quick-battle' | 'mirror'
  path: string
}): Record<string, string>[] {
  const image = `${ORIGIN}/og/${opts.card}`
  return [
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: 'Skin Battle' },
    { property: 'og:title', content: opts.title },
    { property: 'og:description', content: opts.description },
    { property: 'og:url', content: `${ORIGIN}${opts.path}` },
    { property: 'og:image', content: image },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: opts.title },
    { name: 'twitter:description', content: opts.description },
    { name: 'twitter:image', content: image },
  ]
}
