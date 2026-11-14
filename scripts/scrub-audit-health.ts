/**
 * Scrub health and emergency-contact data out of the copies already written to
 * audit_log and deletion_archive (S0 audit scrub, docs/THREAT-MODEL.md TB4 I).
 *
 * Migration 20261114030557_s0_audit_scrub_trigger stops the members audit
 * trigger copying these columns from the day it is applied. It does not touch
 * the rows written before then. This script does, and only when the owner runs
 * it after a backup: docs/RUNBOOK-privacy-retention-and-deletion.md, Part E.
 *
 *   npx tsx scripts/scrub-audit-health.ts --i-have-a-backup                      # dry run (default): counts, writes nothing
 *   npx tsx scripts/scrub-audit-health.ts --i-have-a-backup --apply              # scrub the project in .env.local
 *   npx tsx scripts/scrub-audit-health.ts --i-have-a-backup --apply --production # owner only: scrub production
 *   options: --table audit_log|deletion_archive   one table (default both)
 *            --batch <n>                           rows read per page (default 200, 1–1000)
 *            --max-rows <n>                        stop after updating n rows per table (default 5000)
 *
 * What it does: reads every audit_log row (old_data, new_data) and every
 * deletion_archive snapshot, page by page in id order, and removes each key in
 * SCRUB_KEYS wherever it sits, at any depth: a snapshot nests rows as
 * `{ table: [rows] }`. A row with none of those keys is left alone, so a rerun
 * only reads. With --max-rows reached it stops; rerun to continue.
 *
 * Guards: it refuses to run at all without --i-have-a-backup, refuses a
 * production URL without --production, and refuses any flag it does not know
 * (so `--aply` is an error, not a dry run that looks like an apply).
 *
 * Prints counts and key names only: never a value, a row id or a key.
 *
 * Prerequisites (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PRODUCTION_SUPABASE_REF } from './production-guard.mjs'

/**
 * Every JSON key the scrub removes: the plaintext columns in the S4 sensitive
 * catalogue (lib/field-crypto-fields.ts: participants, members and
 * member_pending_consent), each with its `_enc` ciphertext and, where one
 * exists, its `_bidx` blind index. Sorted. The audit trigger's `v_scrub` array
 * in supabase/migrations/20261114030557_s0_audit_scrub_trigger.sql is the same
 * list; scripts/scrub-audit-health.test.ts checks both against the catalogue.
 */
export const SCRUB_KEYS = [
  'dietary_requirements',
  'dietary_requirements_enc',
  'ec_email',
  'ec_email_bidx',
  'ec_email_enc',
  'ec_first_name',
  'ec_first_name_enc',
  'ec_last_name',
  'ec_last_name_enc',
  'ec_phone',
  'ec_phone_bidx',
  'ec_phone_enc',
  'ec_relationship',
  'ec_relationship_enc',
  'emergency_contact_email',
  'emergency_contact_email_bidx',
  'emergency_contact_email_enc',
  'emergency_contact_first_name',
  'emergency_contact_first_name_enc',
  'emergency_contact_last_name',
  'emergency_contact_last_name_enc',
  'emergency_contact_phone',
  'emergency_contact_phone_bidx',
  'emergency_contact_phone_enc',
  'emergency_contact_relationship',
  'emergency_contact_relationship_enc',
  'guardian_email',
  'guardian_email_bidx',
  'guardian_email_enc',
  'guardian_name',
  'guardian_name_enc',
  'health_conditions',
  'health_conditions_enc',
] as const

const SCRUB_KEY_SET: ReadonlySet<string> = new Set(SCRUB_KEYS)

/** Deeper than any real row image or snapshot; past it the row is reported as failed, never half-scrubbed. */
export const MAX_DEPTH = 64

export interface ScrubResult {
  /** A copy of the input without the scrubbed keys. The input is never mutated. */
  value: unknown
  /** How many times each key was removed (key name → count). Empty when nothing changed. */
  removed: Map<string, number>
}

/**
 * Remove every key in `keys` from a JSON value, at any depth, through objects
 * and arrays. Pure and idempotent: scrubbing the result again removes nothing.
 * A key is removed whatever its value (null included), as the trigger does.
 */
export function scrubJson(value: unknown, keys: ReadonlySet<string> = SCRUB_KEY_SET): ScrubResult {
  const removed = new Map<string, number>()
  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || typeof v !== 'object') return v
    if (depth > MAX_DEPTH) throw new Error(`JSON nested deeper than ${MAX_DEPTH}`)
    if (Array.isArray(v)) return v.map((item) => walk(item, depth + 1))
    const out: Record<string, unknown> = {}
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      if (keys.has(k)) {
        removed.set(k, (removed.get(k) ?? 0) + 1)
        continue
      }
      out[k] = walk(child, depth + 1)
    }
    return out
  }
  return { value: walk(value, 0), removed }
}

export function mergeCounts(into: Map<string, number>, from: Map<string, number>): Map<string, number> {
  for (const [k, n] of from) into.set(k, (into.get(k) ?? 0) + n)
  return into
}

// ── Tables ──────────────────────────────────────────────────────────────────

export const TABLES = {
  audit_log: ['old_data', 'new_data'],
  deletion_archive: ['snapshot'],
} as const satisfies Record<string, readonly string[]>
export type ScrubTable = keyof typeof TABLES

/**
 * The patch for one row: each JSON column that held a scrubbed key, with its
 * scrubbed value. Null when the row needs no change.
 */
export function rowPatch(
  table: ScrubTable,
  row: Record<string, unknown>,
  counts?: Map<string, number>,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {}
  for (const column of TABLES[table]) {
    const { value, removed } = scrubJson(row[column])
    if (removed.size === 0) continue
    patch[column] = value
    if (counts) mergeCounts(counts, removed)
  }
  return Object.keys(patch).length ? patch : null
}

// ── Arguments and guards ────────────────────────────────────────────────────

export interface Options {
  apply: boolean
  backup: boolean
  production: boolean
  tables: ScrubTable[]
  batch: number
  maxRows: number
}

const BOOLEAN_FLAGS = new Set(['--apply', '--i-have-a-backup', '--production'])
const VALUE_FLAGS = new Set(['--table', '--batch', '--max-rows'])

function positiveInt(raw: string | undefined, flag: string, max: number): number | string {
  if (raw === undefined || !/^\d+$/.test(raw)) return `${flag} takes a whole number`
  const n = Number(raw)
  if (n < 1 || n > max) return `${flag} must be between 1 and ${max}`
  return n
}

/** Parse argv. Returns the options, or an error message to print. */
export function parseArgs(argv: readonly string[]): Options | { error: string } {
  const opts: Options = { apply: false, backup: false, production: false, tables: ['audit_log', 'deletion_archive'], batch: 200, maxRows: 5000 }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (BOOLEAN_FLAGS.has(arg)) {
      if (arg === '--apply') opts.apply = true
      if (arg === '--i-have-a-backup') opts.backup = true
      if (arg === '--production') opts.production = true
      continue
    }
    if (!VALUE_FLAGS.has(arg)) return { error: `Unknown argument: ${arg}` }
    const raw = argv[++i]
    if (arg === '--table') {
      if (raw !== 'audit_log' && raw !== 'deletion_archive') return { error: '--table must be audit_log or deletion_archive' }
      opts.tables = [raw]
    } else if (arg === '--batch') {
      const n = positiveInt(raw, arg, 1000)
      if (typeof n === 'string') return { error: n }
      opts.batch = n
    } else {
      const n = positiveInt(raw, arg, 1_000_000)
      if (typeof n === 'string') return { error: n }
      opts.maxRows = n
    }
  }
  return opts
}

/** True when the Supabase URL's host names the production project. */
export function isProductionUrl(url: string): boolean {
  try {
    return new URL(url).host.toLowerCase().includes(PRODUCTION_SUPABASE_REF)
  } catch {
    return url.toLowerCase().includes(PRODUCTION_SUPABASE_REF)
  }
}

/** Why this run must not start, or null when it may. */
export function refusal(opts: Options, url: string | undefined): string | null {
  if (!opts.backup) {
    return 'Refusing to run without --i-have-a-backup. Take a backup first (docs/RUNBOOK-privacy-retention-and-deletion.md, Part E): the scrub cannot be undone.'
  }
  if (!url) return 'NEXT_PUBLIC_SUPABASE_URL is not set.'
  if (isProductionUrl(url) && !opts.production) {
    return 'Refusing the PRODUCTION project without --production (an owner action, after a backup).'
  }
  return null
}

// ── Running ─────────────────────────────────────────────────────────────────

export interface TableReport {
  table: ScrubTable
  scanned: number
  /** Rows holding at least one scrubbed key. */
  holding: number
  updated: number
  failed: number
  /** --max-rows was reached before the table was finished. */
  stopped: boolean
  keys: Map<string, number>
}

/** The lines to print for one table: counts and key names only. */
export function formatReport(r: TableReport, apply: boolean): string[] {
  const lines = [
    `${r.table}: ${r.scanned} row(s) read; ${r.holding} hold health or emergency-contact keys` +
      (apply ? `; ${r.updated} scrubbed, ${r.failed} failed` : ' (dry run: nothing written)'),
  ]
  for (const [k, n] of [...r.keys].sort(([a], [b]) => a.localeCompare(b))) lines.push(`  ${k}: ${n}`)
  if (r.stopped) lines.push(`  stopped at --max-rows; rerun to continue`)
  return lines
}

/** The slice of a Supabase client this script uses; tests can stand one in. */
export interface ScrubDb {
  from(table: string): {
    select(columns: string): {
      order(column: string, o: { ascending: boolean }): {
        limit(n: number): PageQuery
      }
    }
    update(patch: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<{ error: { code?: string } | null }>
    }
  }
}
export interface PageQuery extends PromiseLike<{ data: Record<string, unknown>[] | null; error: { code?: string } | null }> {
  gt(column: string, value: string): PageQuery
}

export async function scrubTable(db: ScrubDb, table: ScrubTable, opts: Pick<Options, 'apply' | 'batch' | 'maxRows'>): Promise<TableReport> {
  const r: TableReport = { table, scanned: 0, holding: 0, updated: 0, failed: 0, stopped: false, keys: new Map() }
  const columns = ['id', ...TABLES[table]].join(', ')
  let last: string | null = null
  for (;;) {
    let q = db.from(table).select(columns).order('id', { ascending: true }).limit(opts.batch)
    if (last !== null) q = q.gt('id', last)
    const { data, error } = await q
    if (error) throw new Error(`Cannot read ${table} (${error.code ?? 'unknown error'})`)
    const rows = data ?? []
    for (const row of rows) {
      r.scanned++
      let patch: Record<string, unknown> | null
      try {
        patch = rowPatch(table, row, r.keys)
      } catch {
        r.failed++
        continue
      }
      if (!patch) continue
      r.holding++
      if (!opts.apply) continue
      if (r.updated >= opts.maxRows) {
        r.stopped = true
        break
      }
      const { error: updateError } = await db.from(table).update(patch).eq('id', String(row.id))
      if (updateError) r.failed++
      else r.updated++
    }
    if (r.stopped || rows.length < opts.batch) break
    last = String(rows[rows.length - 1].id)
  }
  return r
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2))
  if ('error' in opts) {
    console.error(opts.error)
    return 1
  }
  const dotenv = await import('dotenv')
  const envPath = path.resolve(process.cwd(), '.env.local')
  dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const refused = refusal(opts, url)
  if (refused) {
    console.error(refused)
    return 1
  }
  const { createClient } = await import('@supabase/supabase-js')
  const { supabaseFetch, supabaseSecretKey, SECRET_KEY_VARS } = await import('../lib/supabase-keys')
  const key = supabaseSecretKey()
  if (!key) {
    console.error(`${SECRET_KEY_VARS} is not set.`)
    return 1
  }
  const db = createClient(url!, key, { auth: { persistSession: false }, global: { fetch: supabaseFetch } })

  console.log(`${opts.apply ? 'APPLY' : 'DRY RUN'} against ${isProductionUrl(url!) ? 'PRODUCTION' : 'a non-production project'}\n`)
  let failed = 0
  for (const table of opts.tables) {
    const report = await scrubTable(db as unknown as ScrubDb, table, opts)
    failed += report.failed
    for (const line of formatReport(report, opts.apply)) console.log(line)
  }
  if (!opts.apply) console.log('\nDry run. Add --apply to scrub.')
  return failed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : 'Scrub failed')
      process.exit(1)
    })
}
