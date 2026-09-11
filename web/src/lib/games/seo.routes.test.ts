// Structural guard for the crawl layer.
//
// The bug this exists to prevent: canonicalLink() and ogMeta() are two
// separate calls a route has to remember to pair, and nothing enforced it. So
// 17 of 20 head()-bearing routes shipped with no canonical at all, and every
// route that skipped ogMeta silently inherited the ROOT's hardcoded
// `og:url = https://skinbattle.lol` - meaning ~170 champion pages each told
// crawlers they *were* the homepage. Unit-testing the helpers can't catch
// that: the helpers were always correct, the call sites were missing.
//
// So this reads the route files themselves. Crude, but it fails on exactly the
// regression that happened, which is the only thing a test owes anyone.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROUTES = join(import.meta.dirname, '../../routes')

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return routeFiles(p)
    return /\.tsx$/.test(e.name) ? [p] : []
  })
}

const rel = (p: string) => p.slice(p.indexOf('routes')).replace(/\\/g, '/')

// A route is a real, crawlable page if it renders a head() and isn't a
// redirect stub, the root document, or a page that always says noindex
// (/profile renders the visitor's own board - there is nothing to canonicalise
// because there is nothing to index).
function indexableRoutes(): { name: string; src: string }[] {
  return routeFiles(ROUTES)
    .map((path) => ({ name: rel(path), src: readFileSync(path, 'utf8') }))
    .filter(({ name, src }) => {
      if (name.endsWith('__root.tsx')) return false
      if (!src.includes('head:')) return false
      if (src.includes('...robotsMeta(false)')) return false
      return true
    })
}

describe('every indexable route declares its own canonical URL', () => {
  const routes = indexableRoutes()

  it('finds the route files at all (guards against a silent empty sweep)', () => {
    expect(routes.length).toBeGreaterThan(15)
  })

  it('emits canonicalLink()', () => {
    // Without one, duplicates of the same page (case variants, tracking
    // params, share params) compete with each other in the index.
    const missing = routes
      .filter((r) => !r.src.includes('canonicalLink('))
      .map((r) => r.name)
    expect(missing).toEqual([])
  })

  it('sets its own og:url via ogMeta()', () => {
    // A route that skips ogMeta keeps the ROOT's hardcoded
    // `og:url = https://skinbattle.lol` and tells crawlers it IS the homepage
    // - the exact mismatch that shipped on all ~170 /champions/$id pages.
    const missing = routes
      .filter((r) => !r.src.includes('ogMeta('))
      .map((r) => r.name)
    expect(missing).toEqual([])
  })
})

describe('champion URLs are lowercase everywhere', () => {
  // /champions/$id 301s any other casing to lowercase, so a link that builds
  // the capitalised form still resolves - but it costs a redirect hop and, in
  // JSON-LD (where nothing follows redirects), advertises a URL that is not
  // the canonical one. Every builder lowercases.
  it('builds no mixed-case champion URL', () => {
    const offenders = routeFiles(ROUTES)
      .map((path) => ({ name: rel(path), src: readFileSync(path, 'utf8') }))
      .flatMap(({ name, src }) =>
        // `params={{ id: X }}` and `/champions/${X}` where X isn't lowercased.
        [
          ...src.matchAll(/params=\{\{ id: ([^}]+?) \}\}/g),
          ...src.matchAll(/\/champions\/\$\{([^}]+?)\}/g),
        ]
          .map((m) => m[1].trim())
          .filter((expr) => !expr.includes('toLowerCase()'))
          // String literals and ids already normalised upstream are fine.
          .filter((expr) => !/^'[a-z0-9-]*'$/.test(expr))
          .filter((expr) => expr !== 'canonicalId')
          .map((expr) => `${name}: ${expr}`),
      )
    expect(offenders).toEqual([])
  })
})

describe('migration redirects are permanent', () => {
  // Every redirect in ROUTES.md's migration map is a permanent move, but
  // TanStack's redirect() defaults to 307 (temporary) - which tells Google to
  // KEEP the old URL indexed and withhold consolidation to the new one. All
  // 18 stubs shipped that way. This is the guard; one of them was still 307
  // after a hand-written sweep missed it.
  it('every redirect stub sets statusCode: 301', () => {
    const temporary = routeFiles(ROUTES)
      .map((path) => ({ name: rel(path), src: readFileSync(path, 'utf8') }))
      .filter(({ src }) => src.includes('throw redirect('))
      .filter(({ src }) => !src.includes('statusCode: 301'))
      .map((r) => r.name)
    expect(temporary).toEqual([])
  })
})

describe('an unresolvable dynamic id is a 404, not a 500', () => {
  // /champions/miss-fortune used to 500. The API answers an unknown champion
  // with a clean 404, but api.champion THROWS on any non-2xx, and a throw that
  // escapes a loader renders errorComponent with a 500 - which tells a crawler
  // the server is broken and can suppress crawling of the whole /champions
  // directory, while a 404 is forgotten cleanly.
  //
  // Every other dynamic route reaches its data through a server fn that returns
  // null on a miss, so `if (!x) throw notFound()` covers them. Only a loader
  // calling the raw api client has to catch, so only that shape can regress -
  // including a future route that copies /champions/$id without the catch.
  it('every loader resolving a param through api.* can reach notFound()', () => {
    const missing = routeFiles(ROUTES)
      .map((path) => ({ name: rel(path), src: readFileSync(path, 'utf8') }))
      .filter(({ src }) => /\bapi\.\w+\(params\./.test(src))
      .filter(({ src }) => !/\bnotFound\(\)/.test(src))
      .map((r) => r.name)
    expect(missing).toEqual([])
  })
})

describe('the sitemap and the robots tag agree', () => {
  // Two sources decided this independently: server/sitemap.ts added every
  // catalog skin and every ranking slice, while seo.ts decided noindex from
  // battle counts. They agreed only because nothing fell below the bar - the
  // moment a threshold moves, the gap becomes "Submitted URL marked noindex"
  // in Search Console. The fix is that the sitemap calls the same predicates,
  // so this guards against a future `paths.add` that skips them.
  const src = readFileSync(
    join(import.meta.dirname, 'server/sitemap.ts'),
    'utf8',
  )

  it('gates generated skin and slice URLs on seo.ts predicates', () => {
    expect(src).toContain("from '../seo'")
    expect(src).toMatch(/if \(skinIsIndexable\([^)]*\)\)/)
    expect(src).toMatch(/if \(sliceIsIndexable\([^)]*\)\)/)
  })

  it('adds no generated URL outside a gate', () => {
    // Every paths.add() of an interpolated URL must sit on, or directly
    // under, a line carrying its …IsIndexable(…) gate.
    const lines = src.split('\n')
    const ungated = lines
      .map((line, i) => ({ line, prev: lines[i - 1] ?? '' }))
      .filter(({ line }) => /^\s*paths\.add\(`[^`]*\$\{/.test(line))
      .filter(
        ({ line, prev }) =>
          !/(skin|slice)IsIndexable\(/.test(line) &&
          !/(skin|slice)IsIndexable\(/.test(prev),
      )
      .map(({ line }) => /`([^`]+)`/.exec(line)?.[1] ?? line.trim())
    // Champion pages are the one deliberate exception: they carry a full
    // wardrobe regardless of battle volume and seo.ts has no predicate for
    // them. If that changes, gate them too rather than deleting this line.
    expect(ungated).toEqual(['/champions/${championId.toLowerCase()}'])
  })
})

describe('robots.txt', () => {
  const robots = readFileSync(
    join(import.meta.dirname, '../../../public/robots.txt'),
    'utf8',
  )

  it('declares the sitemap', () => {
    expect(robots).toContain('Sitemap: https://skinbattle.lol/sitemap.xml')
  })

  it('blocks auth and API endpoints', () => {
    for (const p of ['/callback', '/social-callback', '/ingest/']) {
      expect(robots).toContain(`Disallow: ${p}`)
    }
  })

  it('does NOT disallow /profile, which relies on a noindex tag instead', () => {
    // A disallowed URL is never fetched, so its noindex is never read - and it
    // can still be indexed title-only from the sitewide "Mirror" link.
    expect(robots).not.toMatch(/^Disallow: \/profile\s*$/m)
  })

  it('keeps answer engines in the "*" group, with no per-bot group', () => {
    // A crawler matching its own group ignores "*" completely, so a GPTBot
    // group would hand it every path the "*" Disallows protect.
    const groups = robots
      .split('\n')
      .filter((l) => /^User-agent:/i.test(l.trim()))
      .map((l) => l.split(':')[1].trim())
    expect(groups).toEqual(['*'])
  })
})
