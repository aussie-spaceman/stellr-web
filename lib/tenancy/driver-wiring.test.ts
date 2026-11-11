// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importClosure, importClosureOf, readRepoFile, runtimeImports } from '../../test/import-closure'

// Where the tenant database driver may and may not be reached (S5 C11).
//
// lib/tenancy/driver.ts holds the Postgres client and reads
// TENANT_DATABASE_URL, a server-only secret. It must stay out of proxy.ts's
// bundle (runs on every request; Active CPU is the tightest Hobby meter) and
// out of anything a browser loads. Only lib/tenancy/db.ts loads it, with a
// dynamic import, once TENANT_DB_ENABLED is on.

const DB = 'lib/tenancy/db.ts'
const DRIVER = 'lib/tenancy/driver.ts'
const PG = /^postgres(\/|$)/

const SKIP = new Set(['node_modules', '.next', '.git', 'coverage', 'storybook-static', 'dist', 'out', '.vercel', 'playwright-report', 'test-results', '.stryker-tmp', 'reports', '.claude'])

function repoFiles(): { path: string; src: string }[] {
  const out: { path: string; src: string }[] = []
  const walk = (p: string) => {
    const st = statSync(p)
    if (st.isDirectory()) {
      if (SKIP.has(p.split('/').pop() as string)) return
      for (const f of readdirSync(p)) walk(p === '.' ? f : join(p, f))
    } else if (/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(p)) out.push({ path: p, src: readFileSync(p, 'utf8') })
  }
  walk('.')
  return out
}

const files = repoFiles()
/** Source with block and line comments removed (a mention in a comment is not a read). */
const withoutComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const isClient =(src: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(src)

describe('the tenant database driver stays server-side and off by default', () => {
  it('walks the real repo', () => {
    expect(files.length).toBeGreaterThan(500)
    expect(files.some((f) => f.path === DRIVER)).toBe(true)
  })

  it("is not in proxy.ts's import closure, dynamic imports included", { timeout: 30_000 }, () => {
    const closure = importClosure('proxy.ts', readRepoFile)
    expect(closure.has('lib/rate-limit.ts')).toBe(true)
    expect(closure.has(DB)).toBe(false)
    expect(closure.has(DRIVER)).toBe(false)
    const pgImporters = [...closure].filter((f) => runtimeImports(f, readRepoFile(f) ?? '').some((s) => PG.test(s)))
    expect(pgImporters).toEqual([])
  })

  it("is not reachable from any 'use client' module", { timeout: 30_000 }, () => {
    const clients = files.filter((f) => !/\.(test|spec)\./.test(f.path) && isClient(f.src)).map((f) => f.path)
    expect(clients.length).toBeGreaterThan(20)
    const closure = importClosureOf(clients, readRepoFile)
    expect(closure.has(DB)).toBe(false)
    expect(closure.has(DRIVER)).toBe(false)
    const pgImporters = [...closure].filter((f) => runtimeImports(f, readRepoFile(f) ?? '').some((s) => PG.test(s)))
    expect(pgImporters).toEqual([])
  })

  // Parsing every file's imports is slow on CI's runner. A file cannot import a
  // module without naming it in its source, so only files that mention the name
  // are parsed. The assertions below are unchanged.
  it('the postgres package is imported only by the driver and its CI integration test', { timeout: 30_000 }, () => {
    const importers = files
      .filter((f) => f.src.includes('postgres') && runtimeImports(f.path, f.src).some((s) => PG.test(s)))
      .map((f) => f.path)
    // The two-tenant kit (C12) is CI-only like the integration test: its owner connection for fixtures.
    // driver-tls.test.ts runs real postgres.js against a local TLS stand-in to exercise the certificate check.
    expect(importers.sort()).toEqual([
      'lib/tenancy/driver-tls.test.ts',
      DRIVER,
      'test/integration/tenant-db.int.test.ts',
      'test/integration/two-tenant/kit.ts',
    ])
  })

  it('the driver is loaded only by lib/tenancy/db.ts, and only with a dynamic import', { timeout: 30_000 }, () => {
    const importers = files
      .filter((f) => f.path !== DRIVER && f.src.includes('driver') && runtimeImports(f.path, f.src).some((s) => /(?:^|\/)tenancy\/driver$|^\.\/driver$/.test(s)))
      .map((f) => f.path)
    // The kit (C12) imports it only to close the pools after a run.
    expect(importers.sort()).toEqual([
      DB,
      'lib/tenancy/driver-tls.test.ts',
      'lib/tenancy/driver.test.ts',
      'test/integration/tenant-db.int.test.ts',
      'test/integration/two-tenant/kit.ts',
    ])
    const db = readFileSync(DB, 'utf8')
    expect(runtimeImports(DB, db, { staticOnly: true })).not.toContain('./driver')
    expect(db).toMatch(/await import\('\.\/driver'\)/)
  })

  it('the driver is server-only and takes nothing at run time from db.ts', () => {
    const src = readFileSync(DRIVER, 'utf8')
    expect(runtimeImports(DRIVER, src)[0]).toBe('server-only')
    expect(runtimeImports(DRIVER, src)).not.toContain('./db')
    expect(src).toMatch(/prepare: false/)
  })

  it('TENANT_DATABASE_URL is read by the driver alone, and never as a public variable', () => {
    const readers = files
      .filter((f) => !/\.(test|spec)\.|^test\//.test(f.path) && /TENANT_DATABASE_URL/.test(withoutComments(f.src)))
      .map((f) => f.path)
    expect(readers).toEqual([DRIVER])
    const everywhere = [...files.filter((f) => f.path !== 'lib/tenancy/driver-wiring.test.ts').map((f) => f.src),readFileSync('.env.local.example', 'utf8'), readFileSync('.github/workflows/ci.yml', 'utf8')]
    expect(everywhere.filter((s) => /NEXT_PUBLIC_TENANT_DATABASE/.test(s))).toEqual([])
  })

  // The root CA for verify-full (owner decision, 10 Nov 2026). Cheap substring
  // first; only files naming it have their comments stripped.
  it('TENANT_DATABASE_CA_CERT is read by the driver alone, never as a public variable, and never logged there', () => {
    const readers = files
      .filter((f) => !/\.(test|spec)\.|^test\//.test(f.path) && f.src.includes('TENANT_DATABASE_CA_CERT') && /TENANT_DATABASE_CA_CERT/.test(withoutComments(f.src)))
      .map((f) => f.path)
    expect(readers).toEqual([DRIVER])
    const driver = withoutComments(readFileSync(DRIVER, 'utf8'))
    expect(driver).not.toMatch(/\bconsole\.|\blogger\b|\bcaptureException\b/)
    const everywhere = [...files.filter((f) => f.path !== 'lib/tenancy/driver-wiring.test.ts').map((f) => f.src), readFileSync('.env.local.example', 'utf8'), readFileSync('.github/workflows/ci.yml', 'utf8')]
    expect(everywhere.filter((s) => s.includes('NEXT_PUBLIC_TENANT_DATABASE_CA'))).toEqual([])
  })
})
