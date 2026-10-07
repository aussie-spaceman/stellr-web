// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { decryptBackup, encryptBackup } from './backup-crypto'
import { memoryBackupStore } from './backup-store'
import { backupName, exportTables, replicatePending } from './replicate'
import { purgeExpired } from './retention'
import { SIGNED_BUCKET, sha256Hex } from './storage'

const key = randomBytes(32)

beforeEach(() => vi.stubEnv('ESIGN_BACKUP_KEY', key.toString('base64')))
afterEach(() => vi.unstubAllEnvs())

describe('backup encryption', () => {
  it('round-trips, and the stored bytes do not contain the plaintext', () => {
    const plain = new TextEncoder().encode('%PDF-1.7 Pat Rivera signed for Sam')
    const sealed = encryptBackup(plain)
    expect(Buffer.from(sealed).includes(Buffer.from('Pat Rivera'))).toBe(false)
    expect(decryptBackup(sealed).toString()).toBe('%PDF-1.7 Pat Rivera signed for Sam')
  })

  it('refuses a tampered copy rather than returning altered bytes', () => {
    const sealed = encryptBackup(new TextEncoder().encode('original'))
    sealed[sealed.length - 1] ^= 0xff
    expect(() => decryptBackup(sealed)).toThrow()
  })

  it('refuses the wrong key', () => {
    const sealed = encryptBackup(new TextEncoder().encode('x'))
    expect(() => decryptBackup(sealed, randomBytes(32))).toThrow()
  })
})

describe('replicatePending', () => {
  function setup(pdf: Uint8Array, recordedSha = sha256Hex(pdf)) {
    const db = fakeSupabase({
      agreements: [{
        id: 'row-1', provider: 'native', archived_at: '2026-10-02T00:00:00Z', replicated_at: null,
        signed_pdf_path: 'native/2026/row-1/signed.pdf', signed_pdf_sha256: recordedSha,
        certificate_path: 'native/2026/row-1/audit.json',
      }],
    })
    db.objects.set(`${SIGNED_BUCKET}/native/2026/row-1/signed.pdf`, pdf)
    db.objects.set(`${SIGNED_BUCKET}/native/2026/row-1/audit.json`, new TextEncoder().encode('{"events":[]}'))
    return db
  }

  it('copies the signed PDF and audit file, encrypted, and marks the row', async () => {
    const pdf = new TextEncoder().encode('%PDF signed')
    const db = setup(pdf)
    const store = memoryBackupStore()
    expect(await replicatePending(db.client, store)).toEqual({ replicated: 1, failed: [] })
    expect(decryptBackup(store.files.get(backupName('row-1', 'signed'))!).toString()).toBe('%PDF signed')
    expect(store.files.has(backupName('row-1', 'audit'))).toBe(true)
    expect(db.table('agreements')[0].replicated_at).toBeTruthy()
  })

  it('stops starting records at the deadline, leaving them for the next run', async () => {
    const db = setup(new TextEncoder().encode('%PDF signed'))
    const store = memoryBackupStore()
    expect(await replicatePending(db.client, store, { deadline: Date.now() - 1 })).toEqual({ replicated: 0, failed: [], stoppedEarly: true })
    expect(store.files.size).toBe(0)
    expect(db.table('agreements')[0].replicated_at).toBeNull()
    expect(await replicatePending(db.client, store, { deadline: Date.now() + 60_000 })).toEqual({ replicated: 1, failed: [] })
  })

  it('will not copy a stored record that no longer matches its hash', async () => {
    const db = setup(new TextEncoder().encode('%PDF altered'), 'f'.repeat(64))
    const store = memoryBackupStore()
    const result = await replicatePending(db.client, store)
    expect(result.replicated).toBe(0)
    expect(result.failed[0].error).toMatch(/no longer matches/)
    expect(store.files.size).toBe(0)
  })
})

describe('retention removes the off-site copies too', () => {
  it('deletes a purged record’s backups', async () => {
    const db = fakeSupabase({
      agreements: [{ id: 'old', retain_until: '2026-01-01T00:00:00Z', signed_pdf_path: null, certificate_path: null }],
    })
    db.rpcs.esign_purge_audit = () => 0
    const store = memoryBackupStore()
    await store.put(backupName('old', 'signed'), new Uint8Array([1]))
    await store.put(backupName('old', 'audit'), new Uint8Array([2]))
    await purgeExpired(db.client, { limit: 10, now: new Date('2026-10-02T00:00:00Z'), store })
    expect(store.files.size).toBe(0)
  })
})

describe('exportTables', () => {
  it('writes an encrypted export with the audit-chain anchor, and keeps 30 days', async () => {
    const db = fakeSupabase({ agreements: [{ id: 'a', created_at: '2026-10-01' }] })
    db.rpcs.esign_audit_heads = () => [{ envelope_row: 'a', last_id: 3, hash: 'h3' }]
    const store = memoryBackupStore()
    for (let d = 1; d <= 31; d++) await store.put(`export-2026-08-${String(d).padStart(2, '0')}.json.enc`, new Uint8Array([0]))

    const result = await exportTables(db.client, store, new Date('2026-10-02T03:00:00Z'))
    const payload = JSON.parse(decryptBackup(store.files.get('export-2026-10-02.json.enc')!).toString())
    expect(payload.anchor).toBe(result.anchor)
    expect(payload.heads).toEqual([{ envelope_row: 'a', last_id: 3, hash: 'h3' }])
    expect(payload.tables.agreements).toHaveLength(1)
    expect([...store.files.keys()].filter((k) => k.startsWith('export-'))).toHaveLength(30)
  })
})
