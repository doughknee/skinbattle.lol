// schema.org JSON-LD builders for the data/authority pages. Pure data (no
// React) so they're usable from route loaders or handed straight to <JsonLd>.
//
// Discipline: only emit markup that is literally true of the page - an
// ItemList where there's an ordered list, breadcrumbs for the trail. No
// Product/aggregateRating on skins we don't sell: Google flags self-serving
// review markup, which is the opposite of the authority this is meant to build.
//
// Absolute URLs are required by crawlers; SITE_ORIGIN overrides per deployment
// (these run during SSR where env is available, and the fallback is canonical).

const ORIGIN =
  (typeof process !== 'undefined' && process.env.SITE_ORIGIN) ||
  'https://skinbattle.lol'

export const absUrl = (path: string) =>
  path.startsWith('http') ? path : `${ORIGIN}${path}`

// Site identity - emitted once from the root so every crawl resolves the brand
// to a single WebSite/Organization entity.
export function siteJsonLd(): object[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Skin Battle',
      alternateName: 'skinbattle.lol',
      url: `${ORIGIN}/`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Skin Battle',
      url: `${ORIGIN}/`,
      logo: `${ORIGIN}/icon-512.png`,
    },
  ]
}

// Breadcrumb trail - safe, high-value, renders the path in the SERP.
export function breadcrumbJsonLd(trail: { name: string; path: string }[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: absUrl(crumb.path),
    })),
  }
}

// An ordered ranking is literally an ItemList, so this is honest markup and the
// highest-leverage rich result for a data site. Caller pre-slices to a sane cap.
export function itemListJsonLd(opts: {
  name: string
  items: { name: string; path: string }[]
}): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: opts.name,
    numberOfItems: opts.items.length,
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    itemListElement: opts.items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      url: absUrl(it.path),
    })),
  }
}
