// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// deep review ES-1: the signing session must be bound to the recipient whose
// form a tab is showing. A parent with two children's signing links open in
// two tabs shared one browser-wide cookie, so the second link overwrote the
// first and a submit/consent/decline from the first tab landed on the second
// child's consent form. These tests pin the binding: the cookie is scoped per
// recipient, the tab names the recipient it acts for, and a session minted for
// one recipient can never act for another.

const jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { value: jar.get(name)! } : undefined) }),
}))

import { actingSession, cookieName, signRef } from './http'
import { mintToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from './tokens'

const ENV_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'
const ENV_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01'
const REC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function makeDb(): FakeDb {
  const envelope = (id: string, ext: string) => ({
    id, envelope_id: ext, provider: 'native', status: 'sent', envelope_type: 'minor',
    member_id: null, participant_id: null, event_title: 'Colorado SDC', minor_name: 'A Child',
    signer_name: 'A Parent', template_id: null, prefill: {}, sent_at: null, completed_at: null,
    sealed_at: null, reused_from: null, credential_sharing_opt_out: false, archived_at: null, archive_attempts: 0,
  })
  const recipient = (id: string, env: string, name: string, email: string) => ({
    id, envelope_row: env, recipient_id: '1', role_name: 'Guardian', name, email,
    status: 'delivered', routing_order: 1, member_id: null, token_version: 1, failed_token_attempts: 0,
  })
  return fakeSupabase({
    agreements: [envelope(ENV_A, 'ext-a'), envelope(ENV_B, 'ext-b')],
    agreement_recipients: [recipient(REC_A, ENV_A, 'Pat A', 'a@home.test'), recipient(REC_B, ENV_B, 'Pat B', 'b@home.test')],
  })
}

function req(ref: string | null): Request {
  return new Request('https://www.stellreducation.org/api/sign/submit', {
    method: 'POST',
    headers: ref ? { 'x-sign-ref': ref } : {},
  })
}

const session = (rid: string) => mintToken(rid, 'session', 1, SESSION_TTL_SECONDS).token

beforeEach(() => {
  jar.clear()
  vi.stubEnv('ESIGN_TOKEN_SECRET', 's'.repeat(48))
})
afterEach(() => vi.unstubAllEnvs())

describe('signing session binding (ES-1)', () => {
  it('names a distinct cookie per recipient, and falls back only when the ref is unknown', () => {
    expect(cookieName(REC_A)).not.toBe(cookieName(REC_B))
    expect(cookieName(REC_A)).toMatch(/^stellr_sign_[0-9a-f]{32}$/)
    expect(cookieName(null)).toBe(SESSION_COOKIE)
    expect(cookieName('not-a-uuid')).toBe(SESSION_COOKIE)
  })

  it('reads only a valid recipient ref from the header', () => {
    expect(signRef(req(REC_A))).toBe(REC_A)
    expect(signRef(req(null))).toBeNull()
    expect(signRef(req('nope'))).toBeNull()
  })

  it('lets two tabs keep separate sessions that each resolve to their own recipient', async () => {
    const db = makeDb()
    jar.set(cookieName(REC_A), session(REC_A))
    jar.set(cookieName(REC_B), session(REC_B))

    expect((await actingSession(db.client, req(REC_A), 'act'))?.recipient.id).toBe(REC_A)
    expect((await actingSession(db.client, req(REC_B), 'act'))?.recipient.id).toBe(REC_B)
  })

  it('refuses a request from tab A when only child B’s session is in the browser', async () => {
    // The pre-fix world: one browser-wide cookie, now holding the session for
    // the link opened last (child B). Tab A (showing child A) acts.
    const db = makeDb()
    jar.set(SESSION_COOKIE, session(REC_B))
    expect(await actingSession(db.client, req(REC_A), 'act')).toBeNull()
  })

  it('refuses a session that resolves to a recipient other than the ref the tab named', async () => {
    // Defence in depth: even a B session found in A's scoped slot is rejected
    // because the resolved recipient is not the one the tab is acting for.
    const db = makeDb()
    jar.set(cookieName(REC_A), session(REC_B))
    expect(await actingSession(db.client, req(REC_A), 'act')).toBeNull()
  })
})
