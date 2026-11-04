import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer } from '@/lib/supabase'
import { captureRequestError, scrubMessage } from '@/lib/app-errors'

// The S4 platform audit log (migration 20261104300000, docs/PLATFORM-AUDIT.md).
//
// audit() appends one event to public.platform_audit_events through the
// database function platform_audit_append(). The database computes the chain:
// each row's hash covers the previous row's hash and the row itself, with one
// chain per tenant and one platform chain (tenantId null). verifyChain()
// recomputes a chain HERE, outside the database, from the stored columns, so a
// replaced verify function in the database cannot hide a break.
//
// Rules:
//   • audit() never throws into its caller. A failed write is recorded in
//     app_errors (scrubbed, rate-limited) and the caller carries on. It is
//     also bounded by a timeout, so a slow database cannot hold up a request.
//   • Off unless PLATFORM_AUDIT_ENABLED=true. Until then audit() does nothing
//     and returns { ok: false, skipped: 'disabled' }.
//   • metadata is ids only. Keys that name personal data are dropped, values
//     shaped like an email or a phone number are redacted, and only flat
//     primitives (or short arrays of them) are kept. reason is scrubbed too.

export const AUDIT_FLAG = 'PLATFORM_AUDIT_ENABLED'

/** Longest an audit write may hold up its caller. */
export const AUDIT_TIMEOUT_MS = 2_500

/** Bounds that match the table's CHECK constraints. */
export const MAX_REASON = 500
const MAX_METADATA_KEYS = 32
const MAX_METADATA_STRING = 200
const MAX_METADATA_ARRAY = 20

/** Metadata keys that would carry personal data. Matched case-insensitively, ignoring _ and -. */
const DENIED_KEYS = new Set([
  'email', 'emails', 'phone', 'phonenumber', 'mobile', 'name', 'firstname', 'lastname', 'fullname',
  'dob', 'dateofbirth', 'birthdate', 'birthday', 'address', 'street', 'postcode', 'zip', 'zipcode',
  'ip', 'ipaddress', 'useragent', 'password', 'token', 'secret', 'medical', 'allergies', 'allergy',
  'conditions', 'emergencycontact', 'guardian', 'notes', 'comment', 'message', 'body',
])

export type ActorKind = 'user' | 'system' | 'cron'

export interface AuditInput {
  /** The tenant whose chain this goes on; null for a platform-level event. */
  tenantId: string | null
  /** A Clerk user id, 'system', or 'cron:<job>'. */
  actor: string
  /** Inferred from actor when omitted. */
  actorKind?: ActorKind
  /** Dotted lower-case, e.g. 'support.impersonate.start'. */
  action: string
  target?: { table: string; id?: string | null } | null
  reason?: string | null
  metadata?: Record<string, unknown> | null
}

export type AuditResult =
  | { ok: true; id: number; seq: number }
  | { ok: false; skipped: 'disabled' }
  | { ok: false; error: string }

export interface AuditOptions {
  db?: SupabaseClient
  /** Overrides the flag (tests, scripts). */
  enabled?: boolean
  timeoutMs?: number
}

export function auditEnabled(): boolean {
  return process.env[AUDIT_FLAG] === 'true'
}

/** 'system' → system, 'cron:x' → cron, anything else → user. */
export function inferActorKind(actor: string): ActorKind {
  if (actor === 'system') return 'system'
  if (actor.startsWith('cron:')) return 'cron'
  return 'user'
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
/** A whole value shaped like a phone number (ids with digit runs are left alone). */
const PHONE = /^\+?[\d\s().-]{9,24}$/

function normaliseKey(k: string): string {
  return k.toLowerCase().replace(/[_-]/g, '')
}

function cleanValue(v: unknown): string | number | boolean | null | undefined {
  if (v === null) return null
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string') {
    if (EMAIL.test(v)) return '[email]'
    const digits = v.replace(/\D/g, '').length
    if (PHONE.test(v) && digits >= 9 && digits <= 15) return '[phone]'
    return v.length > MAX_METADATA_STRING ? v.slice(0, MAX_METADATA_STRING) : v
  }
  return undefined
}

/**
 * Keep metadata to ids, counts, flags and short codes: denied keys dropped,
 * nested objects dropped, email/phone shapes redacted, sizes bounded.
 */
export function sanitizeMetadata(input: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  for (const [key, value] of Object.entries(input)) {
    if (Object.keys(out).length >= MAX_METADATA_KEYS) break
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) continue
    if (DENIED_KEYS.has(normaliseKey(key))) continue
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_METADATA_ARRAY).map(cleanValue).filter((x) => x !== undefined)
      out[key] = items
      continue
    }
    const v = cleanValue(value)
    if (v !== undefined) out[key] = v
  }
  return out
}

/** Reason text: scrubbed of emails, phones and tokens, bounded; empty → null. */
export function cleanReason(reason: string | null | undefined): string | null {
  if (!reason) return null
  const s = scrubMessage(reason).slice(0, MAX_REASON).trim()
  return s || null
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    const t = setTimeout(() => reject(new Error(`platform audit write timed out after ${ms} ms`)), ms)
    ;(t as { unref?: () => void }).unref?.()
  })
}

async function recordFailure(err: unknown, action: string, db: SupabaseClient | undefined): Promise<void> {
  try {
    console.error('[platform-audit] write failed:', err instanceof Error ? err.message : err)
    await captureRequestError(err, { method: 'AUDIT', path: 'platform_audit' }, { routePath: `audit:${action}` }, db ? { db } : {})
  } catch {
    // captureRequestError never throws; this is belt and braces.
  }
}

/**
 * Append one audit event. Never throws. Off unless PLATFORM_AUDIT_ENABLED=true
 * (or opts.enabled). Bounded by opts.timeoutMs (default 2.5 s).
 */
export async function audit(input: AuditInput, opts: AuditOptions = {}): Promise<AuditResult> {
  const enabled = opts.enabled ?? auditEnabled()
  if (!enabled) return { ok: false, skipped: 'disabled' }

  let db: SupabaseClient | undefined = opts.db
  try {
    db = db ?? supabaseServer()
    const call = db.rpc('platform_audit_append', {
      p_tenant: input.tenantId,
      p_actor: input.actor,
      p_actor_kind: input.actorKind ?? inferActorKind(input.actor),
      p_action: input.action,
      p_target_table: input.target?.table ?? null,
      p_target_id: input.target?.id ?? null,
      p_reason: cleanReason(input.reason),
      p_metadata: sanitizeMetadata(input.metadata),
    })
    const { data, error } = (await Promise.race([call, timeout(opts.timeoutMs ?? AUDIT_TIMEOUT_MS)])) as {
      data: unknown
      error: { message: string } | null
    }
    if (error) throw new Error(`platform_audit_append: ${error.message}`)
    const row = (Array.isArray(data) ? data[0] : data) as { id?: number; chain_seq?: number } | null
    if (!row || typeof row.id !== 'number') throw new Error('platform_audit_append returned no row')
    return { ok: true, id: row.id, seq: Number(row.chain_seq) }
  } catch (err) {
    await recordFailure(err, input.action, db)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Verification (off-database) ──────────────────────────────────────────────

/** A row as verifyChain reads it. metadata_text is metadata::text from Postgres. */
export interface StoredAuditRow {
  id: number
  tenant_id: string | null
  chain_seq: number | string
  actor: string
  actor_kind: string
  action: string
  target_table: string | null
  target_id: string | null
  reason: string | null
  metadata_text: string
  occurred_at: string
  prev_hash: string | null
  hash: string
}

function field(v: string | null): string {
  return v === null ? '~' : `${Buffer.byteLength(v, 'utf8')}:${v}`
}

/** "2026-11-04T10:00:00.123+00:00" (PostgREST) → "2026-11-04T10:00:00.123Z". */
export function canonicalTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`unreadable occurred_at: ${iso}`)
  return d.toISOString()
}

/**
 * The text a row's hash covers. Mirrors public.platform_audit_canonical() in
 * migration 20261104300000; change both together. metadataText must be
 * Postgres's own jsonb::text rendering (verifyChain selects metadata::text).
 */
export function canonicalRow(r: {
  tenant_id: string | null
  chain_seq: number | string
  actor: string
  actor_kind: string
  action: string
  target_table: string | null
  target_id: string | null
  reason: string | null
  metadata_text: string
  occurred_at: string
}): string {
  return [
    'pae1',
    field(r.tenant_id),
    field(String(r.chain_seq)),
    field(r.actor),
    field(r.actor_kind),
    field(r.action),
    field(r.target_table),
    field(r.target_id),
    field(r.reason),
    field(r.metadata_text),
    field(canonicalTimestamp(r.occurred_at)),
  ].join('|')
}

/** sha256(prev || canonical), as hex. */
export function rowHash(prevHex: string | null, canonical: string): string {
  const prev = prevHex ? Buffer.from(prevHex, 'hex') : Buffer.alloc(0)
  return createHash('sha256').update(Buffer.concat([prev, Buffer.from(canonical, 'utf8')])).digest('hex')
}

/** bytea as PostgREST returns it ("\\x0a1b…"), or plain hex, → lower-case hex. */
export function byteaHex(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const hex = v.startsWith('\\x') ? v.slice(2) : v
  if (!/^[0-9a-f]*$/i.test(hex)) throw new Error('unreadable bytea value')
  return hex.toLowerCase()
}

export interface ChainHead {
  seq: number
  hash: string | null
}

export interface VerifyResult {
  ok: boolean
  tenantId: string | null
  checked: number
  head: ChainHead
  firstBad?: { id: number; seq: number; problem: string }
}

export const VERIFY_COLUMNS =
  'id, tenant_id, chain_seq, actor, actor_kind, action, target_table, target_id, reason, metadata_text:metadata::text, occurred_at, prev_hash, hash'

/**
 * Check a sequence of rows already in chain order. Pure: verifyChain feeds it
 * pages from the database; tests feed it directly. `start` carries the state
 * across pages.
 */
export function checkRows(
  rows: StoredAuditRow[],
  start: { seq: number; hash: string | null } = { seq: 0, hash: null },
): { ok: true; head: ChainHead; checked: number } | { ok: false; head: ChainHead; checked: number; firstBad: { id: number; seq: number; problem: string } } {
  let prev = start.hash
  let expect = start.seq + 1
  let checked = 0
  for (const r of rows) {
    checked++
    const seq = Number(r.chain_seq)
    const bad = (problem: string) => ({ ok: false as const, head: { seq: expect - 1, hash: prev }, checked, firstBad: { id: r.id, seq, problem } })
    if (seq !== expect) return bad('sequence gap')
    const storedPrev = byteaHex(r.prev_hash)
    if (storedPrev !== prev) return bad('prev_hash does not match the previous row')
    const stored = byteaHex(r.hash)
    if (stored !== rowHash(prev, canonicalRow(r))) return bad('hash does not match the row')
    prev = stored
    expect++
  }
  return { ok: true, head: { seq: expect - 1, hash: prev }, checked }
}

/**
 * Recompute one tenant's chain (null = the platform chain) outside the
 * database. Read-only. Throws only when the rows cannot be read; a broken
 * chain is a result, not an exception.
 */
export async function verifyChain(
  tenantId: string | null,
  opts: { db?: SupabaseClient; pageSize?: number } = {},
): Promise<VerifyResult> {
  const db = opts.db ?? supabaseServer()
  const pageSize = opts.pageSize ?? 1000
  let state = { seq: 0, hash: null as string | null }
  let checked = 0
  for (;;) {
    let q = db.from('platform_audit_events').select(VERIFY_COLUMNS)
    q = tenantId === null ? q.is('tenant_id', null) : q.eq('tenant_id', tenantId)
    const { data, error } = await q.gt('chain_seq', state.seq).order('chain_seq', { ascending: true }).limit(pageSize)
    if (error) throw new Error(`platform audit read failed: ${error.message}`)
    const rows = (data ?? []) as unknown as StoredAuditRow[]
    const res = checkRows(rows, state)
    checked += res.checked
    if (!res.ok) return { ok: false, tenantId, checked, head: res.head, firstBad: res.firstBad }
    state = { seq: res.head.seq, hash: res.head.hash }
    if (rows.length < pageSize) return { ok: true, tenantId, checked, head: res.head }
  }
}

export interface RecordedHead {
  tenantId: string | null
  seq: number
  hash: string
}

/**
 * Compare a chain's rows with heads recorded earlier, somewhere the database
 * owner cannot edit. A recorded head whose row is missing (the tail was cut)
 * or whose hash changed (the chain was rewritten) is a break that in-database
 * verification alone cannot see.
 */
export async function checkRecordedHeads(
  heads: RecordedHead[],
  opts: { db?: SupabaseClient } = {},
): Promise<{ ok: boolean; problems: string[] }> {
  const db = opts.db ?? supabaseServer()
  const problems: string[] = []
  for (const h of heads) {
    let q = db.from('platform_audit_events').select('chain_seq, hash')
    q = h.tenantId === null ? q.is('tenant_id', null) : q.eq('tenant_id', h.tenantId)
    const { data, error } = await q.eq('chain_seq', h.seq).limit(1)
    if (error) throw new Error(`platform audit read failed: ${error.message}`)
    const row = ((data ?? []) as { chain_seq: number; hash: string }[])[0]
    const label = h.tenantId ?? 'platform'
    if (!row) problems.push(`${label}: recorded head ${h.seq} is missing (rows were removed from the end of the chain)`)
    else if (byteaHex(row.hash) !== h.hash.toLowerCase()) problems.push(`${label}: row ${h.seq} no longer has its recorded hash (the chain was rewritten)`)
  }
  return { ok: problems.length === 0, problems }
}
