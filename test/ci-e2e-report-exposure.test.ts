// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { revokeAllFixtureSessions, revokeRecordedSessions } from '../scripts/revoke-e2e-sessions'
import { FIXTURES } from '../e2e/fixtures/users'

// Artifacts on this public repo can be downloaded by any signed-in GitHub user,
// so the Playwright report must only ever go up with its sessions already dead.

describe('the e2e job publishes its report safely', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
  const job = ci.slice(ci.indexOf('\n  e2e:\n'))

  it('revokes sessions after the suite and before the upload, even when the suite fails', () => {
    const suite = job.indexOf('run: npx playwright test')
    const revoke = job.indexOf('run: npx tsx scripts/revoke-e2e-sessions.ts')
    const upload = job.indexOf('name: playwright-report')
    expect(suite).toBeGreaterThan(-1)
    expect(revoke).toBeGreaterThan(suite)
    expect(upload).toBeGreaterThan(revoke)
    expect(job.slice(suite, revoke)).toContain('always()')
  })

  it('uploads only on failure, and only when the revoke succeeded', () => {
    const upload = job.indexOf('name: playwright-report')
    const stepStart = job.lastIndexOf('- if:', upload)
    expect(job.slice(stepStart, upload)).toContain("failure() && steps.revoke-sessions.outcome == 'success'")
  })

  it('signs in without a password, and records the session whether or not sign-in finishes', () => {
    const signIn = readFileSync('e2e/fixtures/sign-in.ts', 'utf8')
    expect(signIn).not.toMatch(/signInParams|passwordVar|strategy: 'password'/)
    expect(signIn).toContain('emailAddress: fixture.email')
    expect(signIn.indexOf("page.on('response'")).toBeLessThan(signIn.indexOf('await clerk.signIn('))
    expect(signIn).toContain('recordCreatedSession(')
  })
})

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe.each([
  ['revokeRecordedSessions', (key: string | undefined, f: typeof fetch) => revokeRecordedSessions(key, 'sess_a\n', f)],
  ['revokeAllFixtureSessions', (key: string | undefined, f: typeof fetch) => revokeAllFixtureSessions(key, f)],
])('%s', (_name, run) => {
  it.each([undefined, '', 'sk_live_abc', 'pk_test_abc'])('refuses a non-development key: %s', async (key) => {
    const fetchImpl = vi.fn()
    await expect(run(key, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/sk_test_/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('revokeRecordedSessions', () => {
  it('ends only what the ledger lists, once each, leaving a signed-out session alone', async () => {
    const statuses: Record<string, string> = { sess_live: 'active', sess_signedout: 'ended' }
    const revoked: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const id = url.match(/sess_\w+/)![0]
      if (init?.method === 'POST') {
        revoked.push(id)
        return json({ id, status: 'revoked' })
      }
      return json({ id, status: statuses[id] })
    })

    const result = await revokeRecordedSessions(
      'sk_test_abc',
      'sess_live\nsess_signedout\nsess_live\n',
      fetchImpl as typeof fetch,
    )

    expect(revoked).toEqual(['sess_live'])
    expect(result).toEqual({ recorded: 2, revoked: 1 })
  })

  it('rejects a ledger line that is not a session id, before it reaches a URL', async () => {
    const fetchImpl = vi.fn()
    await expect(
      revokeRecordedSessions('sk_test_abc', '../users/user_1\n', fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/not a session id/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails loudly when Clerk rejects a call, naming no id', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }))
    await expect(
      revokeRecordedSessions('sk_test_abc', 'sess_secretish\n', fetchImpl as typeof fetch),
    ).rejects.toThrow('Clerk GET /sessions/sess_… returned 401')
  })
})

describe('revokeAllFixtureSessions', () => {
  it('ends every active session of every fixture, and tolerates an unprovisioned fixture', async () => {
    const remaining = ['sess_a', 'sess_b']
    const adminEmail = encodeURIComponent(FIXTURES.admin.email)

    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/users?')) return json(url.includes(adminEmail) ? [{ id: 'user_1' }] : [])
      if (url.includes('/sessions?')) return json(remaining.map((id) => ({ id })))
      if (url.endsWith('/revoke') && init?.method === 'POST') {
        remaining.splice(remaining.indexOf(url.split('/').at(-2)!), 1)
        return json({ status: 'revoked' })
      }
      throw new Error(`unexpected call: ${url}`)
    })

    const results = await revokeAllFixtureSessions('sk_test_abc', fetchImpl as typeof fetch)

    expect(remaining).toEqual([])
    expect(results.find((r) => r.role === 'admin')?.revoked).toBe(2)
    expect(results.filter((r) => r.role !== 'admin').every((r) => r.revoked === 0)).toBe(true)
  })
})
