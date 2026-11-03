// @vitest-environment node
import { execFile } from 'node:child_process'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// S0 key migration: scripts/verify-deletion-registry.mjs is the one database
// script run by plain node rather than tsx. It imports lib/supabase-keys.ts
// natively; this runs the real script against a local stand-in for PostgREST
// and reads the headers it sends, which also proves that native import works.
// Every key below is set explicitly, so a developer's .env.local (which the
// script loads only for variables that are unset) cannot change the outcome.

const b64url = (s: string) => Buffer.from(s).toString('base64url')
const fakeLegacyKey = (role: string) =>
  `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ iss: 'supabase', role }))}.TESTONLY`

let server: Server
let seen: { method?: string; headers: IncomingHttpHeaders }[]
let url: string

beforeEach(async () => {
  seen = []
  server = createServer((req, res) => {
    seen.push({ method: req.method, headers: req.headers })
    res.writeHead(200, { 'content-type': 'application/json', 'content-range': '*/0' })
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
})

function run(secretKey: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['scripts/verify-deletion-registry.mjs'],
      {
        env: { NODE_ENV: 'test', PATH: process.env.PATH, NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: secretKey },
        encoding: 'utf8',
        timeout: 30_000,
      },
      (error, stdout, stderr) => resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
    )
  })
}

describe('scripts/verify-deletion-registry.mjs', () => {
  it('sends a secret key on apikey only, never as a Bearer token', async () => {
    const { code, stdout } = await run('sb_secret_TESTONLY')
    expect(code).toBe(0)
    expect(stdout).toMatch(/\d+ ok, 0 missing/)
    expect(seen.length).toBeGreaterThan(10)
    for (const req of seen) {
      expect(req.headers.apikey).toBe('sb_secret_TESTONLY')
      expect(req.headers.authorization).toBeUndefined()
    }
  }, 40_000)

  it('sends a legacy service_role key on both headers, as before', async () => {
    const legacy = fakeLegacyKey('service_role')
    const { code } = await run(legacy)
    expect(code).toBe(0)
    expect(seen.length).toBeGreaterThan(10)
    for (const req of seen) {
      expect(req.headers.apikey).toBe(legacy)
      expect(req.headers.authorization).toBe(`Bearer ${legacy}`)
    }
  }, 40_000)

  it('refuses the publishable key in the secret slot before sending anything', async () => {
    const { code, stderr } = await run('sb_publishable_TESTONLY')
    expect(code).not.toBe(0)
    expect(stderr).toContain('SUPABASE_SECRET_KEY holds a Supabase publishable key')
    expect(stderr).not.toContain('TESTONLY')
    expect(seen).toEqual([])
  }, 40_000)

  it('refuses a legacy anon key in the secret slot before sending anything', async () => {
    const { code, stderr } = await run(fakeLegacyKey('anon'))
    expect(code).not.toBe(0)
    expect(stderr).toContain('SUPABASE_SECRET_KEY holds a Supabase legacy anon key')
    expect(seen).toEqual([])
  }, 40_000)
})
