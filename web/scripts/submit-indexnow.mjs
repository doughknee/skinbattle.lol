// IndexNow sweep (GAMES_ROADMAP, the SEO/GEO answer-surface brief): tells the
// IndexNow participants - in practice Bing, which grounds Copilot - when a URL
// *enters* the sitemap. Google does not use IndexNow, so this is the
// answer-engine half of the brief, not the search half. The sitemap and the
// internal linking already carry discovery; this only shortens the lag.
//
//   node web/scripts/submit-indexnow.mjs
//
// THE TRIGGER IS A DAILY DIFF, NOT AN EVENT HOOK. The only input is the live
// /sitemap.xml: fetch it, compare against the last submitted snapshot, submit
// what is new. Nothing in the vote/battle/refit path calls this file, so
// ratings churn - which is constant - cannot fire a submission. A URL set
// change is rare and is exactly what IndexNow wants to hear about. Hooks on
// "skin crossed skinIsIndexable()" / "slice crossed sliceIsIndexable()" would
// need one hook per predicate per write path; the diff catches all of them
// with no hook at all, and cannot miss one that gets added later.
//
// Submitting FROM the sitemap (rather than from a second inventory query) is
// what makes it impossible for IndexNow to disagree with the robots tag:
// sitemapXmlResponse() already gates on the same predicates the page's robots
// meta does (DONI-84), so whatever it emits is by definition indexable.
//
// Additions only. A URL that LEAVES the sitemap is not submitted - that would
// be submitting a URL the sitemap excludes, which is the "Submitted URL marked
// noindex" error DONI-84 exists to prevent. Departures resolve themselves:
// the page still serves `noindex,follow`, and the next crawl drops it.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ORIGIN = process.env.SITE_ORIGIN || 'https://skinbattle.lol'
// Never committed and never written to disk by the app either - the web server
// answers /<key>.txt straight from this same env var (see web/server.mjs).
const KEY = process.env.INDEXNOW_KEY || ''
// Carried between runs by actions/cache, not by git. A lost snapshot is a
// seed, not a 2,365-URL blast (see below).
const SNAPSHOT = process.env.INDEXNOW_SNAPSHOT || '.indexnow-snapshot.txt'
// The shared endpoint fans out to every participating engine; posting to
// bing.com/indexnow directly would reach only one of them.
const ENDPOINT = 'https://api.indexnow.org/IndexNow'

const decodeXml = (s) =>
  s.replace(
    /&(amp|lt|gt|apos|quot);/g,
    (_, e) => ({ amp: '&', lt: '<', gt: '>', apos: "'", quot: '"' })[e],
  )

// The sitemap is ours and emits one <loc> per URL, so a regex is enough - and
// it keeps this script dependency-free, which is why it can run on a bare
// actions/setup-node with no install step.
export const parseSitemapUrls = (xml) =>
  [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)]
    .map((m) => decodeXml(m[1].trim()))
    .filter(Boolean)

// URLs present now that weren't present at the last submission.
export const newUrls = (previous, current) => {
  const seen = new Set(previous)
  return current.filter((u) => !seen.has(u))
}

const readSnapshot = () =>
  existsSync(SNAPSHOT)
    ? readFileSync(SNAPSHOT, 'utf8').split('\n').filter(Boolean)
    : null

const writeSnapshot = (urls) => writeFileSync(SNAPSHOT, urls.join('\n') + '\n')

// Exported so a harness can exercise the submit path against a stub endpoint
// without posting to the real service. Runs for real only when invoked as a
// script (see the bottom of the file).
export async function main() {
  if (!KEY) throw new Error('INDEXNOW_KEY is not set - nothing to submit with')

  const res = await fetch(`${ORIGIN}/sitemap.xml`)
  if (!res.ok) throw new Error(`sitemap fetch failed: ${res.status}`)
  const current = parseSitemapUrls(await res.text())
  // Same instinct as snapshot-facts.mjs refusing a mostly-empty dataset: a
  // broken sitemap must not overwrite a good snapshot, or the run after it
  // would read the whole site back as "new".
  if (current.length === 0) {
    throw new Error('sitemap parsed to zero URLs - snapshot left untouched')
  }

  const previous = readSnapshot()
  // First run, or the cache aged out. Seed and submit nothing: the sitemap is
  // already in robots.txt and Webmaster Tools, so a full blast would tell the
  // engines nothing they can't read there - and would look like spam.
  if (previous === null) {
    writeSnapshot(current)
    console.log(`seeded ${current.length} URLs - nothing submitted on a cold start`)
    return
  }

  const added = newUrls(previous, current)
  if (added.length === 0) {
    // Still re-write it: a URL that left should count as new if it returns.
    writeSnapshot(current)
    console.log(`no new URLs (${current.length} in the sitemap) - nothing to submit`)
    return
  }

  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    // No keyLocation: the file sits at the host root under its own key name,
    // which is where IndexNow looks by default.
    body: JSON.stringify({ host: new URL(ORIGIN).host, key: KEY, urlList: added }),
  })
  if (!r.ok) {
    // Snapshot deliberately NOT written - the next run retries these URLs.
    throw new Error(`IndexNow returned ${r.status} ${r.statusText}: ${await r.text()}`)
  }
  writeSnapshot(current)
  console.log(`submitted ${added.length} new URL(s) to IndexNow (${r.status}):`)
  for (const u of added) console.log(`  ${u}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main()
}
