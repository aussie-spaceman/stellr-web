// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'dotenv'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supabasePublicKey, supabaseSecretKey } from '@/lib/supabase-keys'

// S0 key migration: lib/supabase-keys.ts is tested on its own; these pin that
// everything else goes through it. A client made without supabaseFetch would
// send a publishable or secret key as a Bearer token, and a direct env read
// would skip the legacy fallback and the slot check.

const KEY_VARS = [
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const

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
    const names = KEY_VARS.join('|')
    const direct = new RegExp(`process\\.env(?:\\.|\\[\\s*['"\`])(${names})\\b`)
    const destructured = new RegExp(`\\{[^}]*\\b(${names})\\b[^}]*\\}\\s*=\\s*process\\.env`)
    const readers = files
      .filter((f) => f.path !== join('lib', 'supabase-keys.ts'))
      .filter((f) => direct.test(f.text) || destructured.test(f.text))
      .map((f) => f.path)
    expect(readers).toEqual([])
  })
})

describe('.env.local.example', () => {
  afterEach(() => vi.unstubAllEnvs())
  const template = parse(readFileSync('.env.local.example', 'utf8'))

  it('names the new variables', () => {
    expect(Object.keys(template)).toEqual(expect.arrayContaining(['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']))
  })

  // A copied template is the starting .env.local. A non-empty placeholder under
  // a new name would win over a real legacy key filled in below it, and every
  // call would send the placeholder.
  it('does not mask a legacy key pair filled in by a developer', () => {
    const b64url = (s: string) => Buffer.from(s).toString('base64url')
    const fakeLegacyKey = (role: string) =>
      `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ iss: 'supabase', role }))}.TESTONLY`
    for (const name of KEY_VARS) vi.stubEnv(name, template[name])
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', fakeLegacyKey('anon'))
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', fakeLegacyKey('service_role'))
    expect(supabasePublicKey()).toBe(fakeLegacyKey('anon'))
    expect(supabaseSecretKey()).toBe(fakeLegacyKey('service_role'))
  })
})
