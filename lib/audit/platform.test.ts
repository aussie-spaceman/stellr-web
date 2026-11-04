// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// lib/audit/platform.ts: audit() never throws and is off by default;
// verifyChain() recomputes the chain outside the database. The golden vector
// below is the same one supabase/tests/database/platform_audit.test.sql checks
// against public.platform_audit_canonical / platform_audit_digest, so the two
// implementations cannot drift apart unnoticed.

const capture = vi.fn()
vi.mock('@/lib/app-errors', async () => {
  const real = await vi.importActual<typeof import('@/lib/app-errors')>('@/lib/app-errors')
  return { scrubMessage: real.scrubMessage, captureRequestError: (...a: unknown[]) => capture(...a) }
})
const serverClient = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => serverClient() }))

const {
  audit,
  auditEnabled,
  AUDIT_FLAG,
  inferActorKind,
  sanitizeMetadata,
  cleanReason,
  canonicalRow,
  canonicalTimestamp,
  rowHash,
  byteaHex,
  checkRows,
  verifyChain,
  checkRecordedHeads,
} = await import('./platform')
type StoredAuditRow = import('./platform').StoredAuditRow

const STELLR = '00000000-0000-4000-8000-000000000001'
const MEMBER = '11111111-1111-4111-8111-111111111111'

const GOLDEN = {
  tenant_id: STELLR,
  chain_seq: 1,
  actor: 'user_abc123',
  actor_kind: 'user',
  action: 'support.impersonate.start',
  target_table: 'members',
  target_id: MEMBER,
  reason: 'Ticket 42 – check',
  metadata_text: '{"a": "x", "b": 1}',
  occurred_at: '2026-11-04T10:00:00.123+00:00',
}
const GOLDEN_CANONICAL =
  'pae1|36:00000000-0000-4000-8000-000000000001|1:1|11:user_abc123|4:user|25:support.impersonate.start|7:members|36:11111111-1111-4111-8111-111111111111|19:Ticket 42 – check|18:{"a": "x", "b": 1}|24:2026-11-04T10:00:00.123Z'
const GOLDEN_HASH = 'b5015758ffdab53c2e415bfd74f7f47a993105847a36702553594af1a92fe423'
const GOLDEN_NEXT = {
  tenant_id: null,
  chain_seq: 2,
  actor: 'system',
  actor_kind: 'system',
  action: 'platform.test.event',
  target_table: null,
  target_id: null,
  reason: null,
  metadata_text: '{}',
  occurred_at: '2026-11-04T10:00:01+00:00',
}
const GOLDEN_NEXT_HASH = '0d460bd020cefade5ab5f355269d0abbe9b7ed1172d2684a79c6f534773384b9'

/** A valid chain of n rows for one tenant, as PostgREST would return it. */
function chain(n: number, tenant: string | null = STELLR): StoredAuditRow[] {
  const rows: StoredAuditRow[] = []
  let prev: string | null = null
  for (let i = 1; i <= n; i++) {
    const base = {
      id: 100 + i,
      tenant_id: tenant,
      chain_seq: i,
      actor: 'system',
      actor_kind: 'system',
      action: 'test.event.step',
      target_table: 'members',
      target_id: MEMBER,
      reason: null,
      metadata_text: `{"i": ${i}}`,
      occurred_at: `2026-11-04T10:00:0${i % 10}.5+00:00`,
    }
    const hash = rowHash(prev, canonicalRow(base))
    rows.push({ ...base, prev_hash: prev === null ? null : `\\x${prev}`, hash: `\\x${hash}` })
    prev = hash
  }
  return rows
}

/** A minimal supabase-js stand-in for the reads verifyChain and checkRecordedHeads make. */
function fakeReadDb(rows: StoredAuditRow[], opts: { error?: string; maxRows?: number } = {}) {
  const calls: { filters: [string, string, unknown][]; limit?: number }[] = []
  const from = (table: string) => {
    expect(table).toBe('platform_audit_events')
    const call: { filters: [string, string, unknown][]; limit?: number } = { filters: [] }
    calls.push(call)
    const q = {
      select: () => q,
      is: (c: string, v: unknown) => (call.filters.push(['is', c, v]), q),
      eq: (c: string, v: unknown) => (call.filters.push(['eq', c, v]), q),
      gt: (c: string, v: unknown) => (call.filters.push(['gt', c, v]), q),
      order: () => q,
      limit: (n: number) => {
        call.limit = n
        if (opts.error) return Promise.resolve({ data: null, error: { message: opts.error } })
        let out = rows.filter((r) =>
          call.filters.every(([op, c, v]) => {
            const val = (r as unknown as Record<string, unknown>)[c]
            if (op === 'is') return val === v
            if (op === 'eq') return String(val) === String(v)
            return Number(val) > Number(v)
          }),
        )
        // maxRows mimics PostgREST's server-side Max Rows cap, which wins over limit().
        out = out.sort((a, b) => Number(a.chain_seq) - Number(b.chain_seq)).slice(0, Math.min(n, opts.maxRows ?? n))
        return Promise.resolve({ data: out, error: null })
      },
    }
    return q
  }
  return { client: { from } as never, calls }
}

describe('canonical form and hash (golden vector shared with pgTAP)', () => {
  it('matches the SQL canonical text byte for byte', () => {
    expect(canonicalRow(GOLDEN)).toBe(GOLDEN_CANONICAL)
  })

  it('genesis hash = sha256(canonical)', () => {
    expect(rowHash(null, GOLDEN_CANONICAL)).toBe(GOLDEN_HASH)
  })

  it('chained hash = sha256(prev || canonical), NULL fields as ~', () => {
    expect(rowHash(GOLDEN_HASH, canonicalRow(GOLDEN_NEXT))).toBe(GOLDEN_NEXT_HASH)
  })

  it('length prefixes count UTF-8 bytes, not characters', () => {
    expect(canonicalRow({ ...GOLDEN, reason: 'é' })).toContain('|2:é|')
  })

  it('normalises PostgREST timestamps to millisecond UTC', () => {
    expect(canonicalTimestamp('2026-11-04T20:00:00.1+10:00')).toBe('2026-11-04T10:00:00.100Z')
    expect(() => canonicalTimestamp('not a date')).toThrow(/unreadable/)
  })

  it('reads bytea in PostgREST and plain hex form', () => {
    expect(byteaHex('\\xABCD')).toBe('abcd')
    expect(byteaHex('abcd')).toBe('abcd')
    expect(byteaHex(null)).toBeNull()
    expect(() => byteaHex('\\xZZ')).toThrow()
  })
})

describe('checkRows', () => {
  it('accepts a valid chain and reports its head', () => {
    const rows = chain(5)
    const res = checkRows(rows)
    expect(res.ok).toBe(true)
    expect(res.head).toEqual({ seq: 5, hash: byteaHex(rows[4].hash) })
  })

  it('accepts an empty chain', () => {
    expect(checkRows([])).toEqual({ ok: true, head: { seq: 0, hash: null }, checked: 0 })
  })

  it('detects an edited row at its position', () => {
    const rows = chain(4)
    rows[2] = { ...rows[2], reason: 'rewritten' }
    const res = checkRows(rows)
    expect(res).toMatchObject({ ok: false, firstBad: { seq: 3, problem: 'hash does not match the row' }, head: { seq: 2 } })
  })

  it('detects edited metadata', () => {
    const rows = chain(3)
    rows[0] = { ...rows[0], metadata_text: '{"i": 9}' }
    expect(checkRows(rows)).toMatchObject({ ok: false, firstBad: { seq: 1 } })
  })

  it('detects a deleted row as a gap', () => {
    const rows = chain(4)
    rows.splice(1, 1)
    expect(checkRows(rows)).toMatchObject({ ok: false, firstBad: { seq: 3, problem: 'sequence gap' } })
  })

  it('detects renumbering to hide a deletion (the hash covers chain_seq)', () => {
    const rows = chain(4)
    const removed = rows.splice(1, 1)[0]
    rows[1] = { ...rows[1], chain_seq: 2, prev_hash: removed.prev_hash }
    expect(checkRows(rows)).toMatchObject({ ok: false, firstBad: { seq: 2, problem: 'hash does not match the row' } })
  })

  it('detects a broken prev link', () => {
    const rows = chain(3)
    rows[1] = { ...rows[1], prev_hash: `\\x${'00'.repeat(32)}` }
    expect(checkRows(rows)).toMatchObject({ ok: false, firstBad: { seq: 2, problem: 'prev_hash does not match the previous row' } })
  })

  it('detects a row moved from another tenant (the hash covers tenant_id)', () => {
    const rows = chain(2)
    rows[1] = { ...rows[1], tenant_id: 'aaaaaaaa-0000-4000-8000-00000000000a' }
    expect(checkRows(rows)).toMatchObject({ ok: false, firstBad: { seq: 2 } })
  })

  it('continues across pages from a carried state', () => {
    const rows = chain(6)
    const first = checkRows(rows.slice(0, 3))
    expect(first.ok).toBe(true)
    expect(checkRows(rows.slice(3), { seq: first.head.seq, hash: first.head.hash }).ok).toBe(true)
  })
})

describe('verifyChain', () => {
  it('pages through a tenant chain and verifies it', async () => {
    const rows = [...chain(7), ...chain(3, null)]
    const db = fakeReadDb(rows)
    const res = await verifyChain(STELLR, { db: db.client, pageSize: 3 })
    expect(res).toMatchObject({ ok: true, tenantId: STELLR, checked: 7, head: { seq: 7 } })
    // 3 + 3 + 1, then an empty page ends it: a short page is not the end.
    expect(db.calls.length).toBe(4)
    expect(db.calls[0].filters).toContainEqual(['eq', 'tenant_id', STELLR])
  })

  it('reads the platform chain with tenant_id IS NULL', async () => {
    const db = fakeReadDb([...chain(2), ...chain(4, null)])
    const res = await verifyChain(null, { db: db.client })
    expect(res).toMatchObject({ ok: true, tenantId: null, checked: 4 })
    expect(db.calls[0].filters).toContainEqual(['is', 'tenant_id', null])
  })

  it('reports a break found on a later page', async () => {
    const rows = chain(6)
    rows[4] = { ...rows[4], actor: 'cron:forged' }
    const res = await verifyChain(STELLR, { db: fakeReadDb(rows).client, pageSize: 2 })
    expect(res).toMatchObject({ ok: false, firstBad: { seq: 5, problem: 'hash does not match the row' }, head: { seq: 4 } })
  })

  it('does not stop at a short page: a server row cap below pageSize still reaches the tampered row', async () => {
    // Regression: PostgREST's Max Rows (a hosted dashboard setting) caps every
    // page. Treating a short page as the end reported a forged chain intact.
    const rows = chain(800)
    rows[700] = { ...rows[700], actor: 'cron:forged' }
    const capped = fakeReadDb(rows, { maxRows: 500 })
    const res = await verifyChain(STELLR, { db: capped.client })
    expect(res).toMatchObject({ ok: false, firstBad: { seq: 701, problem: 'hash does not match the row' }, head: { seq: 700 } })
  })

  it('reports the true head of an intact chain under a row cap', async () => {
    const res = await verifyChain(STELLR, { db: fakeReadDb(chain(800), { maxRows: 500 }).client })
    expect(res).toMatchObject({ ok: true, checked: 800, head: { seq: 800 } })
  })

  it('throws when the rows cannot be read (a read failure is not a pass)', async () => {
    await expect(verifyChain(STELLR, { db: fakeReadDb([], { error: 'permission denied' }).client })).rejects.toThrow(/permission denied/)
  })
})

describe('checkRecordedHeads', () => {
  it('passes while every recorded head is still in place', async () => {
    const rows = chain(3)
    const res = await checkRecordedHeads([{ tenantId: STELLR, seq: 3, hash: byteaHex(rows[2].hash)! }], { db: fakeReadDb(rows).client })
    expect(res).toEqual({ ok: true, problems: [] })
  })

  it('catches rows removed from the end of a chain', async () => {
    const rows = chain(3)
    const head = { tenantId: STELLR, seq: 3, hash: byteaHex(rows[2].hash)! }
    const res = await checkRecordedHeads([head], { db: fakeReadDb(rows.slice(0, 2)).client })
    expect(res.ok).toBe(false)
    expect(res.problems[0]).toMatch(/missing/)
  })

  it('catches a whole chain rewritten with fresh hashes', async () => {
    const rows = chain(3)
    const head = { tenantId: STELLR, seq: 3, hash: byteaHex(rows[2].hash)! }
    const rewritten = chain(3).map((r) => ({ ...r }))
    // A rewrite that verifies on its own: recompute every hash after an edit.
    let prev: string | null = null
    for (const r of rewritten) {
      r.metadata_text = '{"rewritten": true}'
      const h = rowHash(prev, canonicalRow(r))
      r.prev_hash = prev === null ? null : `\\x${prev}`
      r.hash = `\\x${h}`
      prev = h
    }
    expect(checkRows(rewritten).ok).toBe(true)
    const res = await checkRecordedHeads([head], { db: fakeReadDb(rewritten).client })
    expect(res.ok).toBe(false)
    expect(res.problems[0]).toMatch(/rewritten/)
  })
})

describe('metadata and reason hygiene', () => {
  it('drops keys that name personal data and nested objects', () => {
    expect(
      sanitizeMetadata({ adminMemberId: 'm1', email: 'x', First_Name: 'y', date_of_birth: 'z', nested: { a: 1 }, count: 3, on: true }),
    ).toEqual({ adminMemberId: 'm1', count: 3, on: true })
  })

  it('redacts email- and phone-shaped values but keeps ids', () => {
    expect(sanitizeMetadata({ a: 'someone@example.test', b: '+1 (555) 010-0199', c: MEMBER, d: 'cs_test_12345678901' })).toEqual({
      a: '[email]',
      b: '[phone]',
      c: MEMBER,
      d: 'cs_test_12345678901',
    })
  })

  it('bounds strings, arrays and key count, and rejects odd keys', () => {
    const big = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]))
    expect(Object.keys(sanitizeMetadata(big)).length).toBe(32)
    // Nothing that long is an id: it is redacted, not truncated into the log.
    expect(sanitizeMetadata({ s: 'x'.repeat(500) }).s).toBe('[redacted]')
    expect(sanitizeMetadata({ s: 'x'.repeat(80) }).s).toBe('x'.repeat(80))
    expect((sanitizeMetadata({ list: Array.from({ length: 30 }, (_, i) => i) }).list as number[]).length).toBe(20)
    expect(sanitizeMetadata({ 'bad key': 1, '1x': 2, ok: Number.NaN })).toEqual({})
    expect(sanitizeMetadata(null)).toEqual({})
  })

  it('keeps personal data about a child out of metadata, whatever the key is called', () => {
    // Regression: an exact-key denylist let every one of these through.
    const out = sanitizeMetadata({
      studentName: 'Jane Doe',
      childName: 'Sam Smith',
      parentName: 'Ann Doe',
      displayName: 'Jane',
      schoolName: 'X High',
      age: 12,
      ageYears: 12,
      dateOfBirthIso: '2014-03-02',
      medicalNote: 'asthma',
      healthInfo: 'asthma',
      note: 'Jane Doe is 12 and has asthma',
      context: 'Jane Doe is 12 and has asthma',
      guardianPhone: '+1 (555) 010-0199',
      firstname: 'Jane',
      when: '2014-03-02',
      who: 'Jane',
    })
    const text = JSON.stringify(out)
    for (const leak of ['Jane', 'Sam', 'Ann', 'Doe', 'High', 'asthma', '2014', '555']) expect(text).not.toContain(leak)
    expect(out).not.toHaveProperty('age')
    expect(out).not.toHaveProperty('ageYears')
  })

  it('still keeps ids, codes, counts and flags', () => {
    expect(
      sanitizeMetadata({
        adminMemberId: 'admin1',
        memberId: MEMBER,
        actorClerkId: 'user_2abcDEF123',
        sessionId: 'cs_test_12345678901',
        reason: 'replaced',
        status: 'exited',
        eventSlug: 'nevada-2026',
        pageCount: 3,
        stage: 'paid_seat',
        retryCount: 2,
        dryRun: false,
        ids: [MEMBER, 'admin1'],
      }),
    ).toEqual({
      adminMemberId: 'admin1',
      memberId: MEMBER,
      actorClerkId: 'user_2abcDEF123',
      sessionId: 'cs_test_12345678901',
      reason: 'replaced',
      status: 'exited',
      eventSlug: 'nevada-2026',
      pageCount: 3,
      stage: 'paid_seat',
      retryCount: 2,
      dryRun: false,
      ids: [MEMBER, 'admin1'],
    })
  })

  it('reason is a short code or ticket reference, never free text about a person', () => {
    expect(cleanReason('Viewing as Jane Doe (age 12) per her mother; allergic to peanuts')).toBe('[redacted]')
    expect(cleanReason('ticket:4521')).toBe('ticket:4521')
    expect(cleanReason('support_request')).toBe('support_request')
    expect(cleanReason('2014-03-02')).toBe('[redacted]')
    expect(cleanReason('x'.repeat(200))).toBe('[redacted]')
  })

  it('redacts a free-text or oversized reason and maps empty to null', () => {
    expect(cleanReason('Asked by someone@example.test')).toBe('[redacted]')
    expect(cleanReason('someone@example.test')).toBe('[redacted]')
    expect(cleanReason('')).toBeNull()
    expect(cleanReason('   ')).toBeNull()
    expect(cleanReason(null)).toBeNull()
    expect(cleanReason('r'.repeat(900))).toBe('[redacted]')
  })

  it('infers the actor kind', () => {
    expect(inferActorKind('system')).toBe('system')
    expect(inferActorKind('cron:apollo-reconcile')).toBe('cron')
    expect(inferActorKind('user_abc')).toBe('user')
  })
})

describe('audit()', () => {
  const rpc = vi.fn()
  const db = { rpc } as never
  const saved = process.env[AUDIT_FLAG]

  beforeEach(() => {
    rpc.mockReset()
    capture.mockReset()
    serverClient.mockReset()
    delete process.env[AUDIT_FLAG]
  })
  afterEach(() => {
    if (saved === undefined) delete process.env[AUDIT_FLAG]
    else process.env[AUDIT_FLAG] = saved
  })

  const input = {
    tenantId: STELLR,
    actor: 'user_abc123',
    action: 'support.impersonate.start',
    target: { table: 'members', id: MEMBER },
    reason: 'Help desk, reply to someone@example.test',
    metadata: { adminMemberId: 'm1', email: 'leak@example.test' },
  }

  it('is off by default: no database call at all', async () => {
    expect(auditEnabled()).toBe(false)
    expect(await audit(input)).toEqual({ ok: false, skipped: 'disabled' })
    expect(serverClient).not.toHaveBeenCalled()
  })

  it('only the exact value "true" turns it on', () => {
    process.env[AUDIT_FLAG] = '1'
    expect(auditEnabled()).toBe(false)
    process.env[AUDIT_FLAG] = 'true'
    expect(auditEnabled()).toBe(true)
  })

  it('appends through platform_audit_append with cleaned values and never sends a hash', async () => {
    process.env[AUDIT_FLAG] = 'true'
    rpc.mockResolvedValue({ data: { id: 7, chain_seq: 3 }, error: null })
    expect(await audit(input, { db })).toEqual({ ok: true, id: 7, seq: 3 })
    expect(rpc).toHaveBeenCalledWith('platform_audit_append', {
      p_tenant: STELLR,
      p_actor: 'user_abc123',
      p_actor_kind: 'user',
      p_action: 'support.impersonate.start',
      p_target_table: 'members',
      p_target_id: MEMBER,
      p_reason: '[redacted]',
      p_metadata: { adminMemberId: 'm1' },
    })
    const args = rpc.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(args).some((k) => /hash|seq|occurred/.test(k))).toBe(false)
  })

  it('sends null target and tenant for a platform event', async () => {
    rpc.mockResolvedValue({ data: [{ id: 1, chain_seq: 1 }], error: null })
    const res = await audit({ tenantId: null, actor: 'cron:digest', action: 'cron.run.finish' }, { db, enabled: true })
    expect(res).toEqual({ ok: true, id: 1, seq: 1 })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_tenant: null, p_actor_kind: 'cron', p_target_table: null, p_target_id: null, p_reason: null, p_metadata: {} })
  })

  it('never throws on a database error: logs to app_errors and returns ok:false', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'new row violates check constraint' } })
    const res = await audit(input, { db, enabled: true })
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('check constraint') })
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture.mock.calls[0][2]).toEqual({ routePath: 'audit:support.impersonate.start' })
  })

  it('never throws when the client itself throws', async () => {
    rpc.mockImplementation(() => {
      throw new Error('fetch failed')
    })
    expect(await audit(input, { db, enabled: true })).toMatchObject({ ok: false, error: 'fetch failed' })
    expect(capture).toHaveBeenCalled()
  })

  it('never throws when the server client cannot be built', async () => {
    serverClient.mockImplementation(() => {
      throw new Error('Supabase server env vars not configured')
    })
    expect(await audit(input, { enabled: true })).toMatchObject({ ok: false })
  })

  it('never throws when even the error capture fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'down' } })
    capture.mockRejectedValue(new Error('also down'))
    expect(await audit(input, { db, enabled: true })).toMatchObject({ ok: false })
  })

  it('gives up after the timeout instead of holding up the caller', async () => {
    rpc.mockReturnValue(new Promise(() => {}))
    const started = Date.now()
    const res = await audit(input, { db, enabled: true, timeoutMs: 20 })
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('timed out') })
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('treats an empty reply as a failure', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await audit(input, { db, enabled: true })).toMatchObject({ ok: false, error: expect.stringContaining('no row') })
  })
})
