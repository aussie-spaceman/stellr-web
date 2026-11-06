// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { importClosure, readRepoFile, runtimeImports } from './import-closure'

// proxy.ts runs on every request and Active CPU is the tightest Hobby meter, so
// the Postgres limiter must stay out of its bundle. It imports lib/rate-limit.ts
// directly, which is why the async API lives in a module of its own (S5 B4).

const ROOT = process.cwd()

describe('proxy.ts import closure', () => {
  const closure = importClosure('proxy.ts', readRepoFile)

  it('does walk the real graph', () => {
    expect(closure.has('lib/rate-limit.ts')).toBe(true)
    expect(closure.has('lib/csp.ts')).toBe(true)
  })

  it('excludes the rate limit store and the async API', () => {
    expect(closure.has('lib/rate-limit-store.ts')).toBe(false)
    expect(closure.has('lib/rate-limit-async.ts')).toBe(false)
  })

  it('leaves the sync limiter free of imports, and its exports as they were', () => {
    const src = readFileSync(path.join(ROOT, 'lib/rate-limit.ts'), 'utf8')
    expect(runtimeImports('lib/rate-limit.ts', src)).toEqual([])
    const sf = ts.createSourceFile('rate-limit.ts', src, ts.ScriptTarget.Latest, true)
    const exported = sf.statements
      .filter((s) => (ts.canHaveModifiers(s) ? ts.getModifiers(s) : undefined)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      .flatMap((s) =>
        ts.isVariableStatement(s)
          ? s.declarationList.declarations.map((d) => d.name.getText(sf))
          : ts.isFunctionDeclaration(s) && s.name
            ? [s.name.text]
            : [],
      )
    expect(exported.sort()).toEqual(['HOUR_MS', 'checkRateLimit', 'clientIp', 'rateLimitGuard'])
  })
})

describe('the closure walk', () => {
  const closureOf = (files: Record<string, string>) => importClosure('proxy.ts', (rel) => files[rel] ?? null)
  const store = { 'lib/rate-limit-store.ts': 'export const a = 1\n' }

  it('catches the store through another module', () => {
    const files = {
      ...store,
      'proxy.ts': "import { b } from '@/lib/b'\n",
      'lib/b.ts': "export { a as b } from './rate-limit-store'\n",
    }
    expect(closureOf(files).has('lib/rate-limit-store.ts')).toBe(true)
  })

  it('catches a dynamic import and a require', () => {
    const dynamic = { ...store, 'proxy.ts': "export const f = () => import('@/lib/rate-limit-store')\n" }
    const required = { ...store, 'proxy.ts': "export const f = () => require('./lib/rate-limit-store')\n" }
    expect(closureOf(dynamic).has('lib/rate-limit-store.ts')).toBe(true)
    expect(closureOf(required).has('lib/rate-limit-store.ts')).toBe(true)
  })

  it('ignores a type-only import, which is erased', () => {
    const files = { ...store, 'proxy.ts': "import type { A } from '@/lib/rate-limit-store'\nexport type B = A\n" }
    expect(closureOf(files).has('lib/rate-limit-store.ts')).toBe(false)
  })
})
