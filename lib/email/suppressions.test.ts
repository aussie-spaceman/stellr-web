// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import {
  handleSuppressionEvent,
  lookupSuppressions,
  recordSuppression,
  suppressionBlocks,
  SUPPRESSION_REASONS,
} from './suppressions'

const schema = { email_suppressions: ['email', 'reason', 'source', 'created_at'] } as const

describe('suppressionBlocks (the policy)', () => {
  it('never blocks critical mail', () => {
    for (const reason of SUPPRESSION_REASONS) {
      expect(suppressionBlocks(reason, { kind: 'transactional', critical: true })).toBe(false)
      expect(suppressionBlocks(reason, { kind: 'marketing', critical: true })).toBe(false)
    }
  })

  it('blocks marketing for every reason', () => {
    for (const reason of SUPPRESSION_REASONS) {
      expect(suppressionBlocks(reason, { kind: 'marketing', critical: false })).toBe(true)
    }
  })

  it('blocks ordinary transactional mail except for an unsubscribe', () => {
    expect(suppressionBlocks('bounce', { kind: 'transactional', critical: false })).toBe(true)
    expect(suppressionBlocks('complaint', { kind: 'transactional', critical: false })).toBe(true)
    expect(suppressionBlocks('manual', { kind: 'transactional', critical: false })).toBe(true)
    expect(suppressionBlocks('unsubscribe', { kind: 'transactional', critical: false })).toBe(false)
  })
})

describe('recordSuppression / lookupSuppressions', () => {
  it('stores lower-cased, is idempotent, and finds addresses case-insensitively', async () => {
    const fake = fakeSupabase({}, { schema })
    await recordSuppression(fake.client, { email: ' Pat@Example.TEST ', reason: 'bounce', source: 'resend:email.bounced' })
    await recordSuppression(fake.client, { email: 'pat@example.test', reason: 'bounce', source: 'resend:email.bounced' })
    expect(fake.table('email_suppressions')).toHaveLength(1)
    expect(fake.table('email_suppressions')[0].email).toBe('pat@example.test')
    const found = await lookupSuppressions(fake.client, ['PAT@example.test', 'sam@example.test'])
    expect([...found]).toEqual([['pat@example.test', 'bounce']])
  })

  it('ignores something that is not an address', async () => {
    const fake = fakeSupabase({}, { schema })
    expect(await recordSuppression(fake.client, { email: 'not an address', reason: 'manual', source: 'admin' })).toBe(false)
    expect(fake.table('email_suppressions')).toHaveLength(0)
  })

  it('throws on a failed read so the caller decides', async () => {
    const fake = fakeSupabase({}, { failOn: (t) => (t === 'email_suppressions' ? 'boom' : null) })
    await expect(lookupSuppressions(fake.client, ['a@example.test'])).rejects.toThrow('boom')
  })
})

describe('handleSuppressionEvent', () => {
  it('records every recipient of a hard bounce and of a complaint', async () => {
    const fake = fakeSupabase({}, { schema })
    expect(await handleSuppressionEvent(fake.client, {
      type: 'email.bounced', data: { to: ['a@example.test', 'b@example.test'], bounce: { type: 'Permanent' } },
    })).toEqual({ suppressed: 2 })
    expect(await handleSuppressionEvent(fake.client, { type: 'email.complained', data: { to: ['c@example.test'] } }))
      .toEqual({ suppressed: 1 })
    const rows = fake.table('email_suppressions')
    expect(rows.map((r) => [r.email, r.reason, r.source])).toEqual([
      ['a@example.test', 'bounce', 'resend:email.bounced'],
      ['b@example.test', 'bounce', 'resend:email.bounced'],
      ['c@example.test', 'complaint', 'resend:email.complained'],
    ])
  })

  it('records an unclassified bounce (when unsure, suppress) but not a transient one', async () => {
    const fake = fakeSupabase({}, { schema })
    await handleSuppressionEvent(fake.client, { type: 'email.bounced', data: { to: ['full@example.test'], bounce: { type: 'Transient' } } })
    await handleSuppressionEvent(fake.client, { type: 'email.bounced', data: { to: ['odd@example.test'] } })
    expect(fake.table('email_suppressions').map((r) => r.email)).toEqual(['odd@example.test'])
  })

  it('ignores every other event', async () => {
    const fake = fakeSupabase({}, { schema })
    for (const type of ['email.sent', 'email.delivered', 'email.opened', 'email.delivery_delayed']) {
      expect(await handleSuppressionEvent(fake.client, { type, data: { to: ['a@example.test'] } })).toEqual({ suppressed: 0 })
    }
    expect(fake.table('email_suppressions')).toHaveLength(0)
  })
})
