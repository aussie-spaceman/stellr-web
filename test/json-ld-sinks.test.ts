// @vitest-environment node
import { readdirSync, readFileSync as readFile } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// S0 content safety: every JSON-LD block renders through components/seo/JsonLd,
// which escapes the body (lib/json-ld.ts). Twelve were written by hand, and
// nine of them used a bare JSON.stringify — several over Sanity content, which a
// "</script>" in any field turned into page script. This sweep fails on a new
// hand-written one, so the escaping cannot be bypassed by copying an old page.
//
// It looks for "ld+json" in any case and in any form — an attribute, a
// createElement prop, a constant — not just `type="application/ld+json"`, and
// pins every dangerouslySetInnerHTML, which a sink spelled some other way would
// still need.

const ROOTS = ['app', 'components', 'lib', 'packages']
const COMPONENT = 'components/seo/JsonLd.tsx'
const SERIALISER = 'lib/json-ld.ts'
// Walked from the repo root, not process.cwd(), so the sweep sees the same tree
// whichever directory vitest is started from.
const REPO = fileURLToPath(new URL('..', import.meta.url))
const readFileSync = (path: string, encoding: 'utf8') => readFile(join(REPO, path), encoding)

function sources(): string[] {
  return ROOTS.flatMap((root) =>
    (readdirSync(join(REPO, root), { recursive: true }) as string[])
      .map((p) => `${root}/${p.replace(/\\/g, '/')}`)
      .filter((p) => !p.includes('node_modules/'))
      .filter((p) => /\.(tsx?|jsx?|mjs)$/.test(p) && !/\.(test|stories)\.tsx?$/.test(p)),
  )
}

function count(re: RegExp, text: string): number {
  return text.match(re)?.length ?? 0
}

function filesMatching(files: string[], re: RegExp): string[] {
  return files.flatMap((f) => {
    const n = count(re, readFileSync(f, 'utf8'))
    return n > 0 ? [`${f} (${n})`] : []
  })
}

describe('JSON-LD sinks (static inventory)', () => {
  const files = sources()

  it('finds the source tree', () => {
    // Vacuously green if the walk found nothing.
    expect(files.length).toBeGreaterThan(500)
    expect(files).toContain(COMPONENT)
  })

  it('names ld+json only in <JsonLd> and its serialiser', () => {
    // The component's script element and its doc comment; the serialiser's comment.
    expect(filesMatching(files, /ld\+json/gi)).toEqual([`${COMPONENT} (2)`, `${SERIALISER} (1)`].sort())
  })

  it('has exactly one raw application/ld+json script, inside <JsonLd>', () => {
    expect(filesMatching(files, /type\s*[=:]\s*\{?\s*["'`]application\/ld\+json["'`]/gi)).toEqual([`${COMPONENT} (1)`])
  })

  it('sets inner HTML only in <JsonLd> and the consent-mode script', () => {
    // components/analytics/ConsentMode.tsx is a script built from constants, not
    // content (test/inline-scripts.test.ts lists it for the S1 CSP nonce).
    expect(filesMatching(files, /dangerouslySetInnerHTML/g)).toEqual(
      ['components/analytics/ConsentMode.tsx (1)', `${COMPONENT} (1)`].sort(),
    )
  })

  it('renders every former sink through <JsonLd>', () => {
    // The 12 hand-written blocks this replaced, plus the 4 pages that already
    // used the component, plus the Classroom Qualifier curriculum page's FAQ
    // (components/lp/CurriculumLandingPage.tsx, Nov 2026). Fewer means a page lost its structured data; more
    // means this count — and a reviewer — should know about the new one.
    const uses = files.reduce((n, f) => n + count(/<JsonLd\b/g, readFileSync(f, 'utf8')), 0)
    expect(uses).toBe(17)
  })
})
