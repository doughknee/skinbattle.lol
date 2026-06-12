// /sitemap.xml — generated from the site-map registry plus the live catalog,
// so new pages, champions, skins, and ranking slices index automatically.
// Static pages come from ~/lib/siteMap (the same registry the navbar, footer,
// and command palette render from); dynamic URLs come from the games catalog.

import { getDb } from './db'
import { allCatalogSkins, ensureCatalog } from './catalog'
import { rankingsIndex } from './rankings'
import { skinSlug } from '../slug'
import { indexablePaths } from '~/lib/siteMap'

const ORIGIN = process.env.SITE_ORIGIN || 'https://skinbattle.lol'

const escapeXml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;')

export async function sitemapXmlResponse(): Promise<Response> {
  const db = getDb()
  await ensureCatalog(db)
  const skins = allCatalogSkins(db)
  const index = await rankingsIndex()

  const paths = new Set<string>(indexablePaths())
  paths.add('/rankings/all')
  for (const group of [index.prices, index.lines, index.years, index.champions]) {
    for (const link of group) paths.add(`/rankings/${link.slice}`)
  }
  for (const championId of new Set(skins.map((s) => s.championId))) {
    paths.add(`/champions/${championId.toLowerCase()}`)
  }
  for (const s of skins) {
    paths.add(`/skins/${skinSlug(s.name, s.id)}`)
  }

  const urls = [...paths]
    .map((p) => `  <url><loc>${escapeXml(`${ORIGIN}${p}`)}</loc></url>`)
    .join('\n')
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // The catalog changes at most per patch — let CDNs hold it for a day.
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
