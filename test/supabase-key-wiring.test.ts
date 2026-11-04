// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'dotenv'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supabasePublicKey, supabaseSecretKey } from '@/lib/supabase-keys'

// S0 key migration: lib/supabase-keys.ts is tested on its own; these pin that
// everything else goes through it. A client made without supabaseFetch would
// send a publishable or secret key as a Bearer token, and a direct env read
// would skip the slot check. Since runbook step 11 (3 Nov 2026) the legacy
// anon/service_role variables are read nowhere, lib/supabase-keys.ts included.

const KEY_VARS = ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'] as const
const LEGACY_VARS = ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const

function envReaders(names: readonly string[], candidates: { path: string; text: string }[]): string[] {
  const alt = names.join('|')
  const direct = new RegExp(`process\\.env(?:\\.|\\[\\s*['"\`])(${alt})\\b`)
  const destructured = new RegExp(`\\{[^}]*\\b(${alt})\\b[^}]*\\}\\s*=\\s*process\\.env`)
  return candidates.filter((f) => direct.test(f.text) || destructured.test(f.text)).map((f) => f.path)
}

const ROOTS = ['app', 'components', 'lib', 'packages', 'scripts', 'e2e', 'proxy.ts']

function sourceFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path]
  return readdirSync(path).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return []
    const child = join(path, name)
    if (statSync(child).isDirectory()) return sourceFiles(child)
    return /\.(ts|tsx|mjs|js)$/.test(name) && !/\.(test|spec)\.|\.d\.ts$/.test(name) ? [child] : []
  })
}

// Playwright specs are code that runs against the dev database, so they count.
const files = ROOTS.flatMap(sourceFiles)
  .concat(sourceFiles('e2e').filter((f) => f.endsWith('.spec.ts')))
  .map((path) => ({ path, text: readFileSync(path, 'utf8') }))

/** The text of each `createClient(...)` call, parentheses balanced. */
function createClientCalls(text: string): string[] {
  const calls: string[] = []
  for (const match of text.matchAll(/\bcreateClient(?:<[^>(]*>)?\(/g)) {
    let depth = 0
    for (let i = match.index + match[0].length - 1; i < text.length; i++) {
      if (text[i] === '(') depth++
      else if (text[i] === ')' && --depth === 0) {
        calls.push(text.slice(match.index, i + 1))
        break
      }
    }
  }
  return calls
}

describe('Supabase key wiring', () => {
  it('gives every supabase-js client supabaseFetch (app, scripts, e2e fixtures and specs)', () => {
    const sites = files
      .filter((f) => f.text.includes("'@supabase/supabase-js'"))
      .flatMap((f) => createClientCalls(f.text).map((call) => ({ path: f.path, call })))
    // Not vacuous: lib, scripts and e2e all make clients.
    expect(sites.length).toBeGreaterThan(15)
    const missing = sites.filter((s) => !s.call.includes('supabaseFetch')).map((s) => `${s.path}: ${s.call.slice(0, 80)}`)
    expect(missing).toEqual([])
  })

  it('reads the key variables only in lib/supabase-keys.ts', () => {
    const keys = files.find((f) => f.path === join('lib', 'supabase-keys.ts'))
    // Not vacuous: the resolver itself matches.
    expect(envReaders(KEY_VARS, keys ? [keys] : [])).toEqual([join('lib', 'supabase-keys.ts')])
    expect(envReaders(KEY_VARS, files.filter((f) => f !== keys))).toEqual([])
  })

  it('reads the legacy anon/service_role variables nowhere (runbook step 11)', () => {
    expect(envReaders(LEGACY_VARS, files)).toEqual([])
  })
})

describe('.env.local.example', () => {
  afterEach(() => vi.unstubAllEnvs())
  const template = parse(readFileSync('.env.local.example', 'utf8'))

  it('names the new variables and not the legacy ones', () => {
    expect(Object.keys(template)).toEqual(expect.arrayContaining([...KEY_VARS]))
    const text = readFileSync('.env.local.example', 'utf8')
    for (const name of LEGACY_VARS) expect(text).not.toMatch(new RegExp(`^#?\\s*${name}=`, 'm'))
  })

  // A copied template is the starting .env.local. Its key slots are empty, so a
  // copy nobody filled in is unconfigured rather than holding a placeholder.
  it('leaves both key slots empty, so an unfilled copy is unconfigured', () => {
    for (const name of KEY_VARS) vi.stubEnv(name, template[name])
    expect(supabasePublicKey()).toBeUndefined()
    expect(supabaseSecretKey()).toBeUndefined()
  })
})
