// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { SIGNED_BUCKET } from './archive'
import { expireUnsigned, purgeExpired, retainSignedRecords } from './retention'

const now = new Date('2026-10-02T12:00:00Z')

function envelopes() {
  return [
    { id: 'signed', participant_id: 'p1', member_id: 'm1', status: 'completed', restricted_at: null },
    { id: 'pending', participant_id: 'p1', member_id: 'm1', status: 'sent', restricted_at: null },
    { id: 'voided', participant_id: 'p1', member_id: 'm1', status: 'voided', restricted_at: null },
    { id: 'other', participant_id: 'p2', member_id: 'm2', status: 'completed', restricted_at: null },
  ]
}

describe('retainSignedRecords', () => {
  it('restricts a deleted participant’s signed agreement and removes the unsigned ones', async () => {
    const db = fakeSupabase({ docusign_envelopes: envelopes() })
    const result = await retainSignedRecords(db.client, { kind: 'participant', id: 'p1' }, now)

    expect(result).toEqual({ restricted: 1, removedUnsigned: 2 })
    const rows = db.table('docusign_envelopes')
    expect(rows.map((r) => r.id).sort()).toEqual(['other', 'signed'])
    expect(rows.find((r) => r.id === 'signed')?.restricted_at).toBe(now.toISOString())
    expect(rows.find((r) => r.id === 'other')?.restricted_at).toBeNull()
  })

  it('covers every participant of a deleted registration', async () => {
    const db = fakeSupabase({
      docusign_envelopes: envelopes(),
      participants: [
        { id: 'p1', registration_id: 'r1' },
        { id: 'p2', registration_id: 'r1' },
      ],
    })
    const result = await retainSignedRecords(db.client, { kind: 'registration', id: 'r1' }, now)
    expect(result).toEqual({ restricted: 2, removedUnsigned: 2 })
  })

  it('restricts a deleted member’s signed agreements but keeps their unsigned history', async () => {
    const db = fakeSupabase({ docusign_envelopes: envelopes() })
    const result = await retainSignedRecords(db.client, { kind: 'member', id: 'm1' }, now)
    expect(result).toEqual({ restricted: 1, removedUnsigned: 0 })
    expect(db.table('docusign_envelopes')).toHaveLength(4)
  })

  it('stops the delete when the database refuses, rather than losing signed records', async () => {
    const db = fakeSupabase(
      { docusign_envelopes: envelopes() },
      { failOn: (table, action) => (table === 'docusign_envelopes' && action === 'update' ? 'permission denied' : null) },
    )
    await expect(retainSignedRecords(db.client, { kind: 'participant', id: 'p1' }, now)).rejects.toThrow(/permission denied/)
  })
})

describe('purgeExpired', () => {
  const rows = () => [
    { id: 'old', retain_until: '2026-10-01T00:00:00Z', signed_pdf_path: 'docusign/2019/old/signed.pdf', certificate_path: 'docusign/2019/old/certificate.pdf' },
    { id: 'kept', retain_until: '2030-01-01T00:00:00Z', signed_pdf_path: 'docusign/2023/kept/signed.pdf', certificate_path: null },
    { id: 'unsigned', retain_until: null, signed_pdf_path: null, certificate_path: null },
  ]

  it('deletes records past their retention date, document and row, and nothing else', async () => {
    const db = fakeSupabase({ docusign_envelopes: rows() })
    const purgedTrails: unknown[] = []
    db.rpcs.esign_purge_audit = (args) => { purgedTrails.push(args.p_envelope); return 3 }
    db.objects.set(`${SIGNED_BUCKET}/docusign/2019/old/signed.pdf`, new Uint8Array([1]))
    db.objects.set(`${SIGNED_BUCKET}/docusign/2019/old/certificate.pdf`, new Uint8Array([2]))
    db.objects.set(`${SIGNED_BUCKET}/docusign/2023/kept/signed.pdf`, new Uint8Array([3]))

    const result = await purgeExpired(db.client, { limit: 50, now })
    expect(result).toEqual({ eligible: 1, purged: 1, failed: [] })
    expect(db.table('docusign_envelopes').map((r) => r.id).sort()).toEqual(['kept', 'unsigned'])
    expect([...db.objects.keys()]).toEqual([`${SIGNED_BUCKET}/docusign/2023/kept/signed.pdf`])
    expect(purgedTrails).toEqual(['old'])
  })

  it('reports and changes nothing on a dry run', async () => {
    const db = fakeSupabase({ docusign_envelopes: rows() })
    expect(await purgeExpired(db.client, { limit: 50, now, dryRun: true })).toEqual({ eligible: 1, purged: 0, failed: [] })
    expect(db.table('docusign_envelopes')).toHaveLength(3)
  })
})

describe('expireUnsigned', () => {
  const day = 86_400_000
  const ago = (d: number) => new Date(now.getTime() - d * day).toISOString()
  const ahead = (d: number) => new Date(now.getTime() + d * day).toISOString()

  function setup() {
    const env = (id: string, sentDaysAgo: number, status = 'sent') => ({
      id, provider: 'native', status, sent_at: ago(sentDaysAgo), prefill: { MinorDateOfBirth: '07-Jun-2014' },
    })
    const rcp = (id: string, envelope: string, status: string, expires: string | null, extra = {}) => ({
      id, envelope_row: envelope, status, token_version: 1, token_expires_at: expires, signature_image_path: null,
      signer_values: { GuardianPhone: '555' }, signature_text: null, signed_ip: null, signed_user_agent: null, ...extra,
    })
    const db = fakeSupabase({
      docusign_envelopes: [
        env('abandoned', 60),      // parent signed, student's link ran out
        env('reminded', 60),       // a reminder renewed the link last week
        env('recent', 10),         // too new to judge
        { ...env('docusign', 90), provider: 'docusign' },
        env('done', 90, 'completed'),
      ],
      docusign_envelope_recipients: [
        rcp('a-parent', 'abandoned', 'completed', null, { signature_text: 'Pat Lee', signed_ip: '203.0.113.9', signed_user_agent: 'UA' }),
        rcp('a-student', 'abandoned', 'sent', ago(2)),
        rcp('r-parent', 'reminded', 'sent', ahead(23)),
        rcp('n-parent', 'recent', 'sent', ago(1)),
        rcp('d-parent', 'docusign', 'sent', ago(30)),
        rcp('c-parent', 'done', 'completed', ago(30)),
      ],
      esign_audit_events: [
        { id: 1, envelope_row: 'abandoned', event: 'signed', detail: { signatureText: 'Pat Lee' }, ip: '203.0.113.9' },
        { id: 2, envelope_row: 'reminded', event: 'issued', detail: {} },
      ],
    })
    db.rpcs.esign_purge_audit = ({ p_envelope }) => {
      const before = db.table('esign_audit_events').length
      db.tables.esign_audit_events = db.table('esign_audit_events').filter((e) => e.envelope_row !== p_envelope)
      return before - db.table('esign_audit_events').length
    }
    db.rpcs.esign_append_audit = (args) => {
      db.table('esign_audit_events').push({ id: 99, envelope_row: args.p_envelope, event: args.p_event, detail: args.p_detail, ip: args.p_ip ?? null })
      return { id: 99 }
    }
    return db
  }

  it('voids a native agreement whose every outstanding link has run out, and deletes what signing collected', async () => {
    const db = setup()
    const result = await expireUnsigned(db.client, { limit: 10, now })
    expect(result).toEqual({ eligible: 1, expired: 1, failed: [] })

    const envs = Object.fromEntries(db.table('docusign_envelopes').map((e) => [e.id, e]))
    expect(envs.abandoned).toMatchObject({ status: 'voided', prefill: {} })
    expect(['reminded', 'recent', 'docusign', 'done'].map((id) => envs[id].status)).toEqual(['sent', 'sent', 'sent', 'completed'])

    // The parent's signature on a form that never completed goes too.
    const parent = db.table('docusign_envelope_recipients').find((r) => r.id === 'a-parent')!
    expect(parent).toMatchObject({ signature_text: null, signed_ip: null, signed_user_agent: null, signer_values: null, token_version: 2 })
    const student = db.table('docusign_envelope_recipients').find((r) => r.id === 'a-student')!
    expect(student.token_version).toBe(2) // the link is dead

    // The trail that repeated it is replaced by one event holding no personal data.
    const trail = db.table('esign_audit_events').filter((e) => e.envelope_row === 'abandoned')
    expect(trail).toEqual([expect.objectContaining({ event: 'voided', ip: null, detail: expect.objectContaining({ reason: 'expired' }) })])
    expect(db.table('esign_audit_events').some((e) => e.envelope_row === 'reminded')).toBe(true)
  })

  it('changes nothing on a dry run', async () => {
    const db = setup()
    expect(await expireUnsigned(db.client, { limit: 10, now, dryRun: true })).toEqual({ eligible: 1, expired: 0, failed: [] })
    expect(db.table('docusign_envelopes').find((e) => e.id === 'abandoned')?.status).toBe('sent')
  })
})
