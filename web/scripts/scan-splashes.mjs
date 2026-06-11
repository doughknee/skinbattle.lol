// Dev check: HEAD every catalog splash URL and report the ones that 404 —
// these are the skins that break Quick Battle cards mid-session.
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const db = new DatabaseSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '.data', 'games.db'),
)
const skins = db
  .prepare('SELECT id, name, splash_url AS url FROM catalog_skins')
  .all()
console.log('checking', skins.length, 'splashes…')

const bad = []
let done = 0
const CONCURRENCY = 64
async function worker(queue) {
  for (;;) {
    const s = queue.pop()
    if (!s) return
    try {
      const res = await fetch(s.url, { method: 'HEAD' })
      if (!res.ok) bad.push({ id: s.id, name: s.name, status: res.status })
    } catch (err) {
      bad.push({ id: s.id, name: s.name, status: String(err) })
    }
    if (++done % 250 === 0) console.log(done, 'checked…')
  }
}
const queue = [...skins]
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)))
console.log('broken:', bad.length)
for (const b of bad) console.log(b.status, b.id, b.name)
