/**
 * tracker.mjs — list every open close-out row.
 *
 *   npm run tracker
 *
 * Reads the frozen history in docs/handovers/TRACKER.md and one file per
 * session in docs/handovers/tracker/ (newest first). A row is open when its
 * Done cell is ☐ and no file lists its ID under a "## Closes" heading.
 *
 * Each session writes only its own file, so concurrent close-outs never touch
 * the same lines; this script is the combined view. It writes nothing.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'docs/handovers/tracker'
const LEGACY = 'docs/handovers/TRACKER.md'

const files = [
  ...readdirSync(DIR)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .sort()
    .reverse()
    .map((f) => join(DIR, f)),
  LEGACY,
]

const closed = new Set()
const sections = []

for (const file of files) {
  let section = null
  let inCloses = false
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const heading = line.match(/^(#{1,2})\s+(.*)/)
    if (heading) {
      inCloses = /^closes\b/i.test(heading[2])
      if (!inCloses && (heading[1] === '##' || file !== LEGACY)) {
        section = { file, title: heading[2], rows: [] }
        sections.push(section)
      }
      continue
    }
    if (inCloses) {
      const ref = line.match(/^\s*[-*]\s+`?([\w.-]+?)`?\s*:/)
      if (ref) closed.add(ref[1])
      continue
    }
    if (!section || !line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 5 || !cells[cells.length - 1].includes('☐')) continue
    section.rows.push({ id: cells[0].replace(/`/g, ''), item: cells[1], next: cells[cells.length - 2] })
  }
}

let open = 0
for (const s of sections) {
  const rows = s.rows.filter((r) => !closed.has(r.id))
  if (!rows.length) continue
  console.log(`\n${s.title}  (${s.file})`)
  for (const r of rows) {
    console.log(`  ${r.id.padEnd(8)} ${r.item}`)
    if (r.next && r.next !== '—') console.log(`  ${''.padEnd(8)} → ${r.next}`)
  }
  open += rows.length
}
console.log(`\n${open} open row(s); ${closed.size} closed by reference.`)
