// @vitest-environment node
//
// The IDOR harness run against fixture handlers whose guards are known
// (test/idor/fixtures/handlers.ts). Intact, every fixture refuses a tenant-A
// participant naming a tenant-B honeytoken. scripts/idor-canary.mjs copies the
// fixtures, deletes one guard line, points IDOR_FIXTURE_DIR at the copy and
// expects this file to FAIL: proof the suites can fail.
import './mocks'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { HONEYTOKENS, scanForHoneytokens } from '@/lib/testing/honeytokens'
import { installNetworkGuard, runIdorCase, type CaseResult } from './harness'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.idor.invalid'
process.env.SUPABASE_SECRET_KEY = 'sb_secret_idorharness'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_idorharness'

installNetworkGuard()

const dir = process.env.IDOR_FIXTURE_DIR ? path.resolve(process.env.IDOR_FIXTURE_DIR) : path.resolve(__dirname, 'fixtures')
const input = { segments: ['id'], query: [], body: [], urlPattern: '/api/fixture/[id]' }

const CASES: [name: string, method: string][] = [
  ['ownerFiltered', 'GET'],
  ['ownerChecked', 'GET'],
  ['adminGuarded', 'GET'],
  ['tenantFiltered', 'GET'],
  ['scopedWrite', 'PATCH'],
]

function explain(r: CaseResult) {
  return [
    `${r.method} → ${r.status} ${r.outcome}`,
    ...r.leaks.map((l) => `leaked ${l.value}`),
    ...r.writes.map((w) => `honey write ${w.table}: ${w.detail}`),
    r.error ?? '',
  ].join('\n')
}

describe(`IDOR fixtures (${process.env.IDOR_FIXTURE_DIR ? 'canary copy' : 'intact'})`, () => {
  for (const [name, method] of CASES) {
    it(`${name} refuses a tenant-B honeytoken id`, async () => {
      const mod = (await import(path.join(dir, 'handlers.ts'))) as { FIXTURES: Record<string, Record<string, unknown>> }
      const r = await runIdorCase(mod.FIXTURES[name], input, method, 'participant', name)
      expect(r.outcome, explain(r)).not.toBe('leak')
      expect(r.outcome, explain(r)).not.toBe('honey_write')
      expect(r.outcome, explain(r)).not.toBe('error')
    })
  }

  it('the scanner itself sees a planted honeytoken (it is not blind)', () => {
    expect(scanForHoneytokens({ email: HONEYTOKENS.email })).toHaveLength(1)
    expect(scanForHoneytokens({ id: HONEYTOKENS.id }, { sent: [HONEYTOKENS.id] })).toHaveLength(0)
  })
})
