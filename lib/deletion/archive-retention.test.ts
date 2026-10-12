// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { ARCHIVE_RETENTION_YEARS, archivePurgeCutoff, purgeExpiredArchives } from './archive-retention'

// deep review MP-7: `deletion_archive` keeps a full-PII recovery snapshot of
// every hard-deleted member/participant/registration and had no retention
// purge. These prove the purge deletes aged-out snapshots and keeps fresh ones.

const now = new Date('2033-07-01T12:00:00Z')

// cutoff = now - 7 years = 2026-07-01T12:00:00.000Z
function rows() {
  return [
    // A participant snapshot well past 7 years: the child's DOB/EC/ethnicity.
    { id: 'old', entity_type: 'participant', deleted_at: '2026-06-01T00:00:00.000Z' },
    // Exactly on the cutoff — due (the boundary is inclusive, `lte`).
    { id: 'boundary', entity_type: 'member', deleted_at: '2026-07-01T12:00:00.000Z' },
    // Inside the window — must be kept.
    { id: 'recent', entity_type: 'registration', deleted_at: '2030-01-01T00:00:00.000Z' },
  ]
}

describe('ARCHIVE_RETENTION_YEARS', () => {
  it('is the 7-year Privacy Policy §10 period shared with signed agreements', () => {
    expect(ARCHIVE_RETENTION_YEARS).toBe(7)
    expect(archivePurgeCutoff(now)).toBe('2026-07-01T12:00:00.000Z')
  })
})

describe('purgeExpiredArchives', () => {
  it('purges snapshots older than 7 years and keeps newer ones', async () => {
    const db = fakeSupabase({ deletion_archive: rows() })
    const result = await purgeExpiredArchives(db.client, { limit: 1000, now })

    expect(result).toEqual({ eligible: 2, purged: 2, failed: [] })
    // The fresh snapshot — and only it — survives.
    expect(db.table('deletion_archive').map((r) => r.id)).toEqual(['recent'])
  })

  it('is idempotent: a second run over what remains deletes nothing', async () => {
    const db = fakeSupabase({ deletion_archive: rows() })
    await purgeExpiredArchives(db.client, { limit: 1000, now })
    const second = await purgeExpiredArchives(db.client, { limit: 1000, now })
    expect(second).toEqual({ eligible: 0, purged: 0, failed: [] })
    expect(db.table('deletion_archive').map((r) => r.id)).toEqual(['recent'])
  })

  it('reports and changes nothing on a dry run', async () => {
    const db = fakeSupabase({ deletion_archive: rows() })
    expect(await purgeExpiredArchives(db.client, { limit: 1000, now, dryRun: true })).toEqual({
      eligible: 2,
      purged: 0,
      failed: [],
    })
    expect(db.table('deletion_archive')).toHaveLength(3)
  })

  it('fails closed when the read errors, rather than reporting nothing was due', async () => {
    const db = fakeSupabase(
      { deletion_archive: rows() },
      { failOn: (table, action) => (table === 'deletion_archive' && action === 'select' ? 'permission denied' : null) },
    )
    await expect(purgeExpiredArchives(db.client, { limit: 1000, now })).rejects.toThrow(/permission denied/)
    // Nothing was deleted — the error surfaced instead of a silent success.
    expect(db.table('deletion_archive')).toHaveLength(3)
  })

  it('fails closed when the delete errors, leaving the rows for the next run', async () => {
    const db = fakeSupabase(
      { deletion_archive: rows() },
      { failOn: (table, action) => (table === 'deletion_archive' && action === 'delete' ? 'permission denied' : null) },
    )
    await expect(purgeExpiredArchives(db.client, { limit: 1000, now })).rejects.toThrow(/permission denied/)
    expect(db.table('deletion_archive')).toHaveLength(3)
  })
})
