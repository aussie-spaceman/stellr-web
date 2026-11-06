import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Each next/link in view on a public page sends prefetch requests, and each
// request runs proxy.ts on Vercel's metered CPU, so one homepage view cost 16
// proxy runs (5 Nov 2026). Everything a public page renders links through
// components/ui/SiteLink, which turns that off. This walks the import graph from
// the public pages and the root layout, so a new page or component can't bring
// prefetching back unnoticed.

const ROOT = process.cwd()
const SITE_LINK = 'components/ui/SiteLink.tsx'
const IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const isSource = (path: string) => /\.tsx?$/.test(path) && !/\.(test|stories)\.tsx?$/.test(path)

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(ROOT, spec.slice(2)) : spec.startsWith('.') ? join(dirname(from), spec) : null
  if (!base) return null
  const found = [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')].find(existsSync)
  return found ?? null
}

function publicGraph(): string[] {
  const seen = new Set<string>()
  const queue = [...walk(join(ROOT, 'app/(public)')).filter(isSource), join(ROOT, 'app/layout.tsx')]
  while (queue.length) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const target = resolveImport(file, spec)
      if (target && isSource(target)) queue.push(target)
    }
  }
  return [...seen].map((file) => relative(ROOT, file))
}

describe('public site links', () => {
  it('reaches the shared layout and the no-prefetch link', () => {
    const graph = publicGraph()
    expect(graph).toContain('components/layout/Navbar.tsx')
    expect(graph).toContain('components/layout/SiteFooter.tsx')
    expect(graph).toContain(SITE_LINK)
  })

  it('uses SiteLink rather than next/link everywhere a public page reaches', () => {
    const offenders = publicGraph().filter(
      (file) => file !== SITE_LINK && readFileSync(join(ROOT, file), 'utf8').includes("from 'next/link'"),
    )
    expect(offenders).toEqual([])
  })

  it('always turns prefetching off', () => {
    expect(readFileSync(join(ROOT, SITE_LINK), 'utf8')).toContain('<NextLink {...props} prefetch={false} />')
  })
})
