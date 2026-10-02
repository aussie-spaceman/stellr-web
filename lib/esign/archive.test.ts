// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

const { fetchSignedDocument } = vi.hoisted(() => ({ fetchSignedDocument: vi.fn() }))
vi.mock('@/lib/esign/operations', () => ({ fetchSignedDocument }))

import {
  SIGNED_BUCKET,
  archiveEnvelope,
  archivePending,
  loadSignedRecord,
  putImmutable,
  sha256Hex,
  type StoredRecordRow,
} from './archive'

const pdf = new TextEncoder().encode('%PDF-1.7 signed').buffer
const cert = new TextEncoder().encode('%PDF-1.7 certificate').buffer

const completed = (over: Partial<StoredRecordRow> = {}): StoredRecordRow => ({
  id: 'row-1',
  envelope_id: 'env-1',
  provider: 'docusign',
  status: 'completed',
  reused_from: null,
  completed_at: '2026-09-20T10:00:00Z',
  archived_at: null,
  archive_attempts: 0,
  envelope_type: 'minor',
  minor_name: 'José Álvarez',
  signer_name: 'Ana Álvarez',
  ...over,
})

beforeEach(() => {
  fetchSignedDocument.mockReset()
  fetchSignedDocument.mockResolvedValue({ pdf, certificate: cert })
})

describe('archiveEnvelope', () => {
  it('stores the signed PDF and certificate, and records path, hash and retention', async () => {
    const db = fakeSupabase({ docusign_envelopes: [completed()] })
    const outcome = await archiveEnvelope(db.client, completed())

    expect(outcome).toEqual({ kind: 'archived', path: 'docusign/2026/row-1/signed.pdf', sha256: sha256Hex(pdf) })
    expect(db.objects.has(`${SIGNED_BUCKET}/docusign/2026/row-1/signed.pdf`)).toBe(true)
    expect(db.objects.has(`${SIGNED_BUCKET}/docusign/2026/row-1/certificate.pdf`)).toBe(true)

    const row = db.table('docusign_envelopes')[0]
    expect(row.signed_pdf_sha256).toBe(sha256Hex(pdf))
    expect(row.certificate_path).toBe('docusign/2026/row-1/certificate.pdf')
    expect(row.archived_at).toBeTruthy()
    expect(row.retain_until).toBe('2033-09-20T10:00:00.000Z')
  })

  it('keeps names out of object paths', async () => {
    const db = fakeSupabase({ docusign_envelopes: [completed()] })
    await archiveEnvelope(db.client, completed())
    for (const key of db.objects.keys()) expect(key).not.toMatch(/jos|alvarez|ana/i)
  })

  it('skips what has no document of its own, or is already stored', async () => {
    const db = fakeSupabase()
    expect(await archiveEnvelope(db.client, completed({ status: 'sent' }))).toEqual({ kind: 'skipped', reason: 'not_completed' })
    expect(await archiveEnvelope(db.client, completed({ reused_from: 'row-0' }))).toEqual({ kind: 'skipped', reason: 'coverage_row' })
    expect(await archiveEnvelope(db.client, completed({ archived_at: '2026-09-21T00:00:00Z' }))).toEqual({ kind: 'skipped', reason: 'already_archived' })
    expect(await archiveEnvelope(db.client, completed({ provider: 'native' }))).toEqual({ kind: 'skipped', reason: 'native' })
    expect(fetchSignedDocument).not.toHaveBeenCalled()
  })

  it('counts a failure on the row and does not throw', async () => {
    fetchSignedDocument.mockRejectedValue(new Error('DocuSign document fetch failed: ENVELOPE_DOES_NOT_EXIST'))
    const db = fakeSupabase({ docusign_envelopes: [completed({ archive_attempts: 2 })] })

    const outcome = await archiveEnvelope(db.client, completed({ archive_attempts: 2 }))
    expect(outcome.kind).toBe('failed')
    const row = db.table('docusign_envelopes')[0]
    expect(row.archive_attempts).toBe(3)
    expect(row.archive_error).toContain('ENVELOPE_DOES_NOT_EXIST')
    expect(row.archived_at).toBeNull()
  })
})

describe('putImmutable', () => {
  it('never overwrites: a second write keeps the first copy and returns its hash', async () => {
    const db = fakeSupabase()
    const first = new TextEncoder().encode('first')
    const second = new TextEncoder().encode('second')
    expect(await putImmutable(db.client, 'p/signed.pdf', first, 'application/pdf')).toBe(sha256Hex(first))
    expect(await putImmutable(db.client, 'p/signed.pdf', second, 'application/pdf')).toBe(sha256Hex(first))
    expect(new TextDecoder().decode(db.objects.get(`${SIGNED_BUCKET}/p/signed.pdf`))).toBe('first')
  })
})

describe('archivePending', () => {
  it('works through unstored DocuSign agreements only, and reports failures', async () => {
    const rows = [
      completed({ id: 'a', envelope_id: 'env-a' }),
      completed({ id: 'b', envelope_id: 'env-b' }),
      completed({ id: 'stored', archived_at: '2026-09-21T00:00:00Z' }),
      completed({ id: 'coverage', reused_from: 'a' }),
      completed({ id: 'gave-up', archive_attempts: 10 }),
      completed({ id: 'unsigned', status: 'sent' }),
    ]
    fetchSignedDocument.mockImplementation(async (_db, row: { envelope_id: string }) => {
      if (row.envelope_id === 'env-b') throw new Error('gone')
      return { pdf, certificate: null }
    })
    const db = fakeSupabase({ docusign_envelopes: rows })

    const result = await archivePending(db.client, { limit: 20 })
    expect(result.eligible).toBe(2)
    expect(result.archived).toBe(1)
    expect(result.failed).toEqual([{ id: 'b', error: 'gone' }])
  })

  it('changes nothing on a dry run', async () => {
    const db = fakeSupabase({ docusign_envelopes: [completed()] })
    const result = await archivePending(db.client, { limit: 20, dryRun: true })
    expect(result).toEqual({ eligible: 1, archived: 0, failed: [] })
    expect(fetchSignedDocument).not.toHaveBeenCalled()
  })
})

describe('loadSignedRecord', () => {
  it('serves a stored copy as a short-lived link with a safe filename', async () => {
    const db = fakeSupabase()
    db.objects.set(`${SIGNED_BUCKET}/docusign/2026/row-1/signed.pdf`, new Uint8Array(pdf))
    const record = await loadSignedRecord(db.client, completed({ signed_pdf_path: 'docusign/2026/row-1/signed.pdf' }))
    expect(record.kind).toBe('url')
    if (record.kind !== 'url') return
    expect(record.filename).toBe('consent-jose-alvarez.pdf')
    expect(record.url).toContain('ttl=120')
    expect(fetchSignedDocument).not.toHaveBeenCalled()
  })

  it('archives an unstored DocuSign agreement on first download', async () => {
    const db = fakeSupabase({ docusign_envelopes: [completed()] })
    const record = await loadSignedRecord(db.client, completed())
    expect(record.kind).toBe('url')
    expect(db.table('docusign_envelopes')[0].archived_at).toBeTruthy()
  })

  it('falls back to the live document when storing fails, so nobody is refused it', async () => {
    fetchSignedDocument
      .mockRejectedValueOnce(new Error('storage path failed'))
      .mockResolvedValueOnce({ pdf, certificate: null })
    const db = fakeSupabase({ docusign_envelopes: [completed()] })
    const record = await loadSignedRecord(db.client, completed())
    expect(record.kind).toBe('bytes')
  })

  it('names the certificate as a certificate', async () => {
    const db = fakeSupabase()
    db.objects.set(`${SIGNED_BUCKET}/c.pdf`, new Uint8Array(cert))
    const record = await loadSignedRecord(
      db.client,
      completed({ certificate_path: 'c.pdf', envelope_type: 'mentor', minor_name: null, signer_name: 'Mo Lee' }),
      'certificate',
    )
    expect(record.kind === 'url' && record.filename).toBe('agreement-mo-lee-certificate.pdf')
  })
})
