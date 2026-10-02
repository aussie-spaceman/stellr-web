// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { SIGNED_BUCKET } from './archive'
import { purgeExpired, retainSignedRecords } from './retention'

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
