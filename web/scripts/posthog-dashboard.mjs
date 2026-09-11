// The "Participation Growth" PostHog dashboard, as code. This file IS the
// dashboard's definition (docs/participation-loop.md §8): every tile below is
// found-or-created by name, so editing a query here and re-running `apply`
// updates the live dashboard instead of duplicating it.
//
//   PH_KEY=<personal api key> node scripts/posthog-dashboard.mjs 468413 validate
//   PH_KEY=<personal api key> node scripts/posthog-dashboard.mjs 468413 apply
//   PH_KEY=<personal api key> node scripts/posthog-dashboard.mjs 468413 verify
//
// validate: run every query through /query/ (no writes) - do this after any
//           edit; the schema errors are only reported by PostHog.
// apply:    find-or-create the dashboard, then find-or-create/update each tile.
// verify:   list the dashboard's tiles and refresh each one.
//
// The key is a PostHog PERSONAL api key (phx_…), scoped to the SkinBattle.lol
// project (468413 on US cloud) - not the public project token the site ships.
// It is read from the environment and never committed; ask Brandon for it.
// Funnels aggregate by unique session because guests have no person profile
// (ClientProviders: person_profiles 'identified_only').
const HOST = 'https://us.posthog.com'
const KEY = process.env.PH_KEY
const [projectId, mode] = process.argv.slice(2)
if (!KEY || !projectId || !mode) {
  console.error('usage: PH_KEY=… node scripts/posthog-dashboard.mjs <projectId> validate|apply|verify')
  process.exit(2)
}

async function api(path, method = 'GET', body) {
  const res = await fetch(`${HOST}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text.slice(0, 300) }
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 600)}`)
  }
  return json
}

// ─── building blocks ────────────────────────────────────────────────────────

const DATE = { date_from: '-30d' }

const ev = (event, extra = {}) => ({
  kind: 'EventsNode',
  event,
  name: event,
  ...extra,
})

const prop = (key, value, operator = 'exact') => ({
  key,
  type: 'event',
  value,
  operator,
})

// Funnels aggregate by unique SESSION: guests have no person profile
// (person_profiles: identified_only), so person-level funnels would be blind.
const funnel = (steps, extra = {}) => ({
  kind: 'InsightVizNode',
  source: {
    kind: 'FunnelsQuery',
    dateRange: DATE,
    series: steps,
    funnelsFilter: {
      funnelVizType: 'steps',
      funnelOrderType: 'ordered',
      funnelWindowInterval: 1,
      funnelWindowIntervalUnit: 'day',
      funnelAggregateByHogQL: 'properties.$session_id',
    },
    ...extra,
  },
})

const trend = (series, extra = {}) => ({
  kind: 'InsightVizNode',
  source: {
    kind: 'TrendsQuery',
    dateRange: DATE,
    interval: 'week',
    series,
    ...extra,
  },
})

const breakdown = (key, type = 'event') => ({
  breakdownFilter: { breakdown: key, breakdown_type: type },
})

const CHANNEL_SQL = `
WITH sess AS (
  SELECT properties.$session_id                            AS sid,
         argMin(properties.$referring_domain, timestamp)   AS ref,
         argMin(properties.utm_source, timestamp)          AS utm,
         max(event = 'battle_vote_submitted')              AS voted,
         max(event = 'ranking_shared')                     AS shared,
         countIf(event = 'battle_vote_submitted')          AS battles
  FROM events
  WHERE timestamp > now() - INTERVAL 30 DAY
    AND isNotNull(properties.$session_id)
  GROUP BY sid
)
SELECT
  multiIf(
    utm = 'chatgpt.com' OR ref = 'chatgpt.com',                     'ChatGPT',
    ref LIKE '%google.%',                                           'Google organic',
    ref LIKE '%bing.com',                                           'Bing organic',
    ref LIKE '%reddit.com',                                         'Reddit',
    ref LIKE '%discord%',                                           'Discord',
    utm = 'share',                                                  'Share',
    ref IN ('t.co', 'x.com', 'twitter.com', 'facebook.com', 'instagram.com'), 'social',
    ref = '$direct' OR ref = '' OR isNull(ref),                     'direct',
                                                                    'other') AS channel,
  count()                                              AS sessions,
  countIf(voted)                                       AS battled,
  round(100 * countIf(voted) / count(), 1)             AS pct_battled,
  round(sum(battles) / count(), 2)                     AS battles_per_session,
  countIf(shared)                                      AS shared
FROM sess
GROUP BY channel
ORDER BY sessions DESC`.trim()

// ─── the insights (docs/participation-loop.md §8) ───────────────────────────

const INSIGHTS = [
  {
    name: 'A · Landing → first battle',
    description:
      'Sessions that saw a ranking (ranking_viewed) and then cast a first vote (battle_vote_submitted, session_picks = 1), by the page type they landed on. Unique sessions.',
    query: funnel(
      [ev('ranking_viewed'), ev('battle_vote_submitted', { properties: [prop('session_picks', ['1'])] })],
      breakdown('page_type'),
    ),
  },
  {
    name: 'B · Battles per battling session',
    description:
      'Total battle_vote_submitted divided by unique sessions that voted, weekly. Every vote counts; a session is one visit.',
    query: trend(
      [ev('battle_vote_submitted', { math: 'total' }), ev('battle_vote_submitted', { math: 'unique_session' })],
      { trendsFilter: { formula: 'A/B', display: 'ActionsLineGraph' } },
    ),
  },
  {
    name: 'B2 · Battles: scoped vs catalog-wide',
    description:
      'Weekly battle_vote_submitted split by whether the session was scoped to one champion (scope_champion set) or dealt from the whole catalog.',
    query: trend([ev('battle_vote_submitted', { math: 'total' })], {
      breakdownFilter: {
        breakdown: "if(isNotNull(properties.scope_champion), 'scoped', 'catalog-wide')",
        breakdown_type: 'hogql',
      },
    }),
  },
  {
    name: 'C · First → second battle',
    description: 'Sessions with a first vote (session_picks = 1) that cast a second (session_picks = 2). Unique sessions.',
    query: funnel([
      ev('battle_vote_submitted', { properties: [prop('session_picks', ['1'])] }),
      ev('battle_vote_submitted', { properties: [prop('session_picks', ['2'])] }),
    ]),
  },
  {
    name: 'D · Reaching 5 battles',
    description:
      'Sessions with a first vote that reached a fifth (session_picks = 5), split by scoped vs catalog-wide. Unique sessions.',
    query: funnel(
      [
        ev('battle_vote_submitted', { properties: [prop('session_picks', ['1'])] }),
        ev('battle_vote_submitted', { properties: [prop('session_picks', ['5'])] }),
      ],
      {
        breakdownFilter: {
          breakdown: "if(isNotNull(properties.scope_champion), 'scoped', 'catalog-wide')",
          breakdown_type: 'hogql',
        },
      },
    ),
  },
  {
    name: 'E · Ranking views after a battle',
    description:
      'Weekly ranking_viewed events whose session had already battled (session_battles > 0), by page type. The payoff step of the loop.',
    query: trend(
      [ev('ranking_viewed', { math: 'total', properties: [prop('session_battles', '0', 'gt')] })],
      breakdown('page_type'),
    ),
  },
  {
    name: 'E2 · Battle → ranking view',
    description: 'Sessions that voted and then viewed a ranking page. Unique sessions.',
    query: funnel([ev('battle_vote_submitted'), ev('ranking_viewed')]),
  },
  {
    name: 'F · Ranking share rate',
    description: 'Sessions that viewed a ranking and shared it (ranking_shared), by share method. Unique sessions.',
    query: funnel([ev('ranking_viewed'), ev('ranking_shared')], breakdown('method')),
  },
  {
    name: 'G · Visitors from shares',
    description: 'Weekly share_referred_visit arrivals by medium (copy = clipboard link, native = Web Share sheet).',
    query: trend([ev('share_referred_visit', { math: 'total' })], breakdown('utm_medium')),
  },
  {
    name: 'G2 · Share arrival → battle',
    description: 'Sessions that arrived through a share link and went on to vote. Unique sessions.',
    query: funnel([ev('share_referred_visit'), ev('battle_vote_submitted')]),
  },
  {
    name: 'H/I · Voter retention (D1 … D7)',
    description:
      'People who cast a first vote and voted again on day 1 … day 7. Guests are distinct_ids that rotate on cleared cookies and on sign-out, so this is a floor, not a measurement.',
    query: {
      kind: 'InsightVizNode',
      source: {
        kind: 'RetentionQuery',
        dateRange: { date_from: '-14d' },
        retentionFilter: {
          targetEntity: { id: 'battle_vote_submitted', type: 'events', name: 'battle_vote_submitted' },
          returningEntity: { id: 'battle_vote_submitted', type: 'events', name: 'battle_vote_submitted' },
          retentionType: 'retention_first_time',
          period: 'Day',
          totalIntervals: 8,
        },
      },
    },
  },
  {
    name: 'Acquisition · sessions, battles and shares by channel',
    description:
      'Last 30 days, sessions bucketed by entry referrer / utm_source: ChatGPT, Google organic, Bing organic, Reddit, Discord, Share, social, direct, other. Nothing is inferred beyond those rules.',
    query: { kind: 'DataTableNode', full: true, source: { kind: 'HogQLQuery', query: CHANNEL_SQL } },
  },
]

const DASHBOARD = {
  name: 'Participation Growth',
  description:
    'The participation loop (docs/participation-loop.md): landing → first battle → repeat battles → ranking payoff → share → referred visitor. Funnels aggregate by unique session because guests have no person profile.',
}

// ─── modes ──────────────────────────────────────────────────────────────────

const base = `/api/projects/${projectId}`

async function validate() {
  let ok = 0
  for (const ins of INSIGHTS) {
    const q = ins.query.kind === 'InsightVizNode' ? ins.query.source : ins.query
    try {
      const r = await api(`${base}/query/`, 'POST', { query: q })
      const rows = Array.isArray(r.results) ? r.results.length : r.results ? 1 : 0
      console.log(`ok   ${ins.name}  (results: ${rows})`)
      ok++
    } catch (e) {
      console.log(`FAIL ${ins.name}\n     ${e.message}`)
    }
  }
  console.log(`${ok}/${INSIGHTS.length} queries validated`)
  if (ok !== INSIGHTS.length) process.exit(1)
}

async function findDashboard() {
  const r = await api(`${base}/dashboards/?limit=100`)
  return (r.results || []).find((d) => d.name === DASHBOARD.name && !d.deleted) || null
}

async function findInsight(name) {
  const r = await api(`${base}/insights/?search=${encodeURIComponent(name)}&limit=50`)
  return (r.results || []).find((i) => i.name === name && !i.deleted) || null
}

async function apply() {
  let dash = await findDashboard()
  if (dash) {
    console.log(`dashboard exists: #${dash.id}`)
  } else {
    dash = await api(`${base}/dashboards/`, 'POST', {
      ...DASHBOARD,
      filters: { date_from: '-30d' },
    })
    console.log(`dashboard created: #${dash.id}`)
  }
  for (const ins of INSIGHTS) {
    const existing = await findInsight(ins.name)
    const body = {
      name: ins.name,
      description: ins.description,
      query: ins.query,
      saved: true,
    }
    if (existing) {
      const dashboards = new Set([...(existing.dashboards || []), dash.id])
      await api(`${base}/insights/${existing.id}/`, 'PATCH', { ...body, dashboards: [...dashboards] })
      console.log(`updated  ${ins.name}  (#${existing.id})`)
    } else {
      const created = await api(`${base}/insights/`, 'POST', { ...body, dashboards: [dash.id] })
      console.log(`created  ${ins.name}  (#${created.id})`)
    }
  }
  console.log(`\n${HOST}/project/${projectId}/dashboard/${dash.id}`)
}

async function verify() {
  const dash = await findDashboard()
  if (!dash) throw new Error('dashboard not found')
  const full = await api(`${base}/dashboards/${dash.id}/`)
  const tiles = (full.tiles || []).filter((t) => t.insight)
  console.log(`dashboard #${dash.id} "${full.name}": ${tiles.length} insight tiles`)
  for (const t of tiles) {
    try {
      const r = await api(`${base}/insights/${t.insight.id}/?refresh=blocking`)
      const res = r.result
      const n = Array.isArray(res) ? res.length : res ? 1 : 0
      console.log(`  ok   ${t.insight.name}  (series/rows: ${n})`)
    } catch (e) {
      console.log(`  FAIL ${t.insight.name}: ${e.message.slice(0, 200)}`)
    }
  }
  console.log(`\n${HOST}/project/${projectId}/dashboard/${dash.id}`)
}

const run = { validate, apply, verify }[mode]
if (!run) {
  console.error(`unknown mode ${mode}`)
  process.exit(2)
}
run().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
