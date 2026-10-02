import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// SWC (Next's compiler) drops the LEADING space of a JSX text run that spans
// several lines AND contains an HTML entity (&rsquo;, &ldquo;, …), so
//   <strong>Minors.</strong> In this policy, a &ldquo;Minor&rdquo; is…
//                                            (wraps onto the next line)
// renders as "Minors.In this policy". Found 2 Oct 2026 on the legal pages, where
// a one-word edit moved an entity into the run and silently joined two words on
// production. Write the space as {' '} after the tag instead.

const RUN_AFTER_TAG = /(<\/[A-Za-z][\w.]*>|\/>) ([^<{}]*)/g
const ENTITY = /&[a-zA-Z]+;|&#\d+;/

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return []
    const p = join(dir, name)
    return statSync(p).isDirectory() ? tsxFiles(p) : p.endsWith('.tsx') && !p.endsWith('.test.tsx') ? [p] : []
  })
}

describe('JSX text runs that SWC would collapse', () => {
  it('none in app/, components/ or packages/', () => {
    const offenders: string[] = []
    for (const file of ['app', 'components', 'packages'].flatMap(tsxFiles)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(RUN_AFTER_TAG)) {
        if (m[2].includes('\n') && ENTITY.test(m[2])) {
          offenders.push(`${file}:${src.slice(0, m.index).split('\n').length}`)
        }
      }
    }
    expect(offenders, `Use {' '} after the closing tag at:\n${offenders.join('\n')}`).toEqual([])
  })
})
