import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer } from '@/lib/supabase'
import { sendEmail, staffAlertEmail } from '@/lib/email'
import { emailLayout, escapeHtml as esc } from '@/lib/email-layout'
import { startCronRun } from '@/lib/cron-runs'

// S1 error capture. instrumentation.ts hands every server error Next reports
// (onRequestError) to captureRequestError(), which writes one row per distinct
// error to app_errors (migration 20261103234624) and bumps its count. Once a
// day sendDailyErrorDigest() emails staff "Errors in the last day" — only when
// there were any: an all-clear nobody reads trains people to ignore the alarm.
//
// Vercel Hobby keeps runtime logs for an hour, so before this an error that
// nobody happened to be watching for left no trace at all.
//
// Rules that keep the capture itself from becoming a problem:
//   • It never throws. A failure to record an error is logged and dropped.
//   • The message is scrubbed of emails, phone numbers and tokens, then
//     truncated, BEFORE it is hashed or stored. The route stored is Next's
//     pattern ("/api/register/[slug]"), never the concrete path or query.
//   • Writes are rate-limited per digest, per warm instance: the first
//     occurrence is written at once, repeats inside the window are counted in
//     memory and folded into the next write. A global cap bounds an error storm.
//     Counts held in memory are lost if the instance is recycled first, so the
//     count is a floor, not an exact figure.

/** Longest message stored, after scrubbing. */
export const MAX_MESSAGE = 500
/** Repeats of one digest inside this window are batched into one write. */
export const WRITE_WINDOW_MS = 60_000
/** At most this many writes per instance per minute, across all digests. */
export const MAX_WRITES_PER_MINUTE = 30
/** Rows not seen for this long are deleted by the daily digest. */
export const RETENTION_DAYS = 90

const DAY = 86_400_000

// ── Scrubbing ────────────────────────────────────────────────────────────────

/**
 * Strip personal data and secrets from an error message: email addresses,
 * phone numbers, JWTs, bearer tokens, API keys, long opaque strings and query
 * string values. When unsure, scrub — a debugging detail lost is cheaper than
 * a parent's phone number kept.
 */
export function scrubMessage(raw: string): string {
  let s = raw.slice(0, 4000)
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
  s = s.replace(/eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*/g, '[token]')
  s = s.replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, '$1 [token]')
  s = s.replace(/\b(?:sk|pk|rk|whsec|re|ghp|gho|ghs|github_pat|xox[abpr])_[A-Za-z0-9_-]{8,}/g, '[token]')
  s = s.replace(/([?&][^=\s&#]+=)[^&\s#]+/g, '$1[redacted]')
  s = s.replace(/\b(password|passwd|secret|token|api[_-]?key|authorization)(["']?\s*[:=]\s*["']?)[^\s,;"'&]+/gi, '$1$2[redacted]')
  s = s.replace(/\b[0-9a-f]{24,}\b/gi, '[token]')
  s = s.replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, (m) => (/\d/.test(m) && /[A-Za-z]/.test(m) ? '[token]' : m))
  // A run of 9–15 digits with phone punctuation. Dates ("2026-11-03") have 8.
  s = s.replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => {
    const digits = m.replace(/\D/g, '').length
    return digits >= 9 && digits <= 15 ? '[phone]' : m
  })
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > MAX_MESSAGE ? `${s.slice(0, MAX_MESSAGE - 1)}…` : s
}

/** "<METHOD> <route pattern>", query string removed, scrubbed, bounded. */
export function routeLabel(method: string | undefined, routePath: string | undefined, path: string | undefined): string {
  const route = (routePath || path || 'unknown').split('?')[0]
  return scrubMessage(`${(method || 'GET').toUpperCase()} ${route}`).slice(0, 300)
}

/**
 * The digest groups repeats of one error: the route plus the scrubbed message
 * with ids and numbers flattened, so "row 41 not found" and "row 42 not found"
 * are one error.
 */
export function errorDigest(route: string, message: string): string {
  const normalised = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d+/g, '#')
  return createHash('sha256').update(`${route}\n${normalised}`).digest('hex').slice(0, 32)
}

/** The text of whatever was thrown. */
export function errorText(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err) ?? String(err)
  } catch {
    return String(err)
  }
}

// Next's control-flow "errors" (redirect(), notFound(), dynamic usage bailouts)
// are not faults. Next normally filters them before onRequestError; this is
// belt and braces.
function isControlFlow(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest
  return typeof digest === 'string' && /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING)/.test(digest)
}

// ── Rate limiting (per warm instance) ────────────────────────────────────────

interface Pending { lastWrite: number; pending: number }
const seen = new Map<string, Pending>()
let minuteStart = 0
let minuteWrites = 0

/** Test hook: forget the in-memory rate-limit state. */
export function resetErrorCaptureState(): void {
  seen.clear()
  minuteStart = 0
  minuteWrites = 0
}

/**
 * How many occurrences to write now for this digest, or 0 to hold it back.
 * Exported for tests.
 */
export function takeWrite(digest: string, now: number): number {
  if (seen.size > 500) seen.clear()
  if (now - minuteStart >= 60_000) {
    minuteStart = now
    minuteWrites = 0
  }
  const entry = seen.get(digest)
  if (entry && now - entry.lastWrite < WRITE_WINDOW_MS) {
    entry.pending++
    return 0
  }
  if (minuteWrites >= MAX_WRITES_PER_MINUTE) {
    if (entry) entry.pending++
    else seen.set(digest, { lastWrite: 0, pending: 1 })
    return 0
  }
  minuteWrites++
  const count = 1 + (entry?.pending ?? 0)
  seen.set(digest, { lastWrite: now, pending: 0 })
  return count
}

// ── Capture ──────────────────────────────────────────────────────────────────

export interface CapturedRequest {
  path?: string
  method?: string
}
export interface CapturedContext {
  routePath?: string
  routeType?: string
}

/**
 * Record one server error. Best-effort: never throws, never awaits longer than
 * one database call. `db` is injectable for tests; production uses the
 * service-role client.
 */
export async function captureRequestError(
  err: unknown,
  request: CapturedRequest,
  context: CapturedContext,
  opts: { db?: SupabaseClient; now?: number } = {},
): Promise<void> {
  try {
    if (isControlFlow(err)) return
    const route = routeLabel(request?.method, context?.routePath, request?.path)
    const message = scrubMessage(errorText(err)) || 'Unknown error'
    const digest = errorDigest(route, message)
    const count = takeWrite(digest, opts.now ?? Date.now())
    if (count === 0) return
    const db = opts.db ?? supabaseServer()
    const { error } = await db.rpc('record_app_error', {
      p_digest: digest,
      p_route: route,
      p_message: message,
      p_count: count,
    })
    if (error) console.error('[app-errors] record failed:', error.message)
  } catch (e) {
    console.error('[app-errors] capture failed:', e instanceof Error ? e.message : e)
  }
}

// ── Daily digest ─────────────────────────────────────────────────────────────

export interface AppErrorRow {
  route: string
  message: string
  count: number
  occurred_at: string
  last_seen: string
}

/** Errors seen in the 24 hours before `now`, most frequent first. */
export async function loadRecentErrors(db: SupabaseClient, now = new Date()): Promise<AppErrorRow[]> {
  const { data, error } = await db
    .from('app_errors')
    .select('route, message, count, occurred_at, last_seen')
    .gte('last_seen', new Date(now.getTime() - DAY).toISOString())
    .order('count', { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []) as AppErrorRow[]
}

/** Shown in the email; the rest are counted. */
const LISTED = 20

export function renderErrorDigest(rows: AppErrorRow[]): { subject: string; html: string; text: string } {
  const n = rows.length
  const subject = `[Stellr] ${n} server error${n === 1 ? '' : 's'} in the last day`
  const shown = rows.slice(0, LISTED)
  const more = n - shown.length
  const when = (iso: string) => iso.slice(0, 16).replace('T', ' ')

  const items = shown
    .map((r) => `<li style="margin:0 0 12px">
          <strong>${esc(r.route)}</strong> · ${r.count}× total · first ${esc(when(r.occurred_at))} UTC · last ${esc(when(r.last_seen))} UTC<br>
          <span style="font-family:monospace;font-size:13px">${esc(r.message)}</span>
        </li>`)
    .join('')
  const html = emailLayout({
    heading: 'Errors in the last day',
    preheader: `${n} distinct server error${n === 1 ? '' : 's'} were seen in the last 24 hours.`,
    bodyHtml: `
        <p>${n} distinct server error${n === 1 ? ' was' : 's were'} seen in the last 24 hours. Each line is one error; the count is every time it has happened since it was first seen.</p>
        <ul style="padding-left:20px">${items}</ul>
        ${more > 0 ? `<p>…and ${more} more.</p>` : ''}
        <p style="color:#6b7280;font-size:14px">The full list is in the <code>app_errors</code> table. Messages are scrubbed of emails, phone numbers and tokens before they are stored.</p>`,
  })
  const text =
    `Errors in the last day\n\n${n} distinct server error${n === 1 ? ' was' : 's were'} seen in the last 24 hours.\n\n` +
    shown.map((r) => `${r.route} · ${r.count}× total · first ${when(r.occurred_at)} UTC · last ${when(r.last_seen)} UTC\n  ${r.message}`).join('\n\n') +
    (more > 0 ? `\n\n…and ${more} more.` : '') +
    `\n\nThe full list is in the app_errors table.`
  return { subject, html, text }
}

const JOB = 'error-digest'

/** Whether a run already emailed the digest in the last 20 hours. */
async function alreadyAlerted(db: SupabaseClient, now: Date): Promise<boolean> {
  const { data, error } = await db
    .from('cron_runs')
    .select('id')
    .eq('job', JOB)
    .eq('result->>alerted', 'true')
    .gte('started_at', new Date(now.getTime() - 20 * 3_600_000).toISOString())
    .limit(1)
  if (error) console.error('[app-errors] duplicate check failed:', error.message)
  return (data ?? []).length > 0
}

/**
 * The daily "Errors in the last day" email, to the staff inbox, sent only when
 * there were errors. Also deletes rows not seen for RETENTION_DAYS. Runs from
 * an existing daily cron (app/api/cron/entitlements) rather than a cron of its
 * own, and records itself in cron_runs as 'error-digest'. Never throws.
 */
export async function sendDailyErrorDigest(db: SupabaseClient, now = new Date()): Promise<{ errors: number; alerted: boolean }> {
  try {
    if (await alreadyAlerted(db, now)) return { errors: 0, alerted: false }
  } catch (err) {
    console.error('[app-errors] duplicate check threw:', err)
  }
  const run = await startCronRun(db, JOB)
  try {
    const { error: pruneError } = await db
      .from('app_errors')
      .delete()
      .lt('last_seen', new Date(now.getTime() - RETENTION_DAYS * DAY).toISOString())
    if (pruneError) run.fail('prune', pruneError.message)

    const rows = await loadRecentErrors(db, now)
    if (rows.length === 0) {
      await run.finish({ errors: 0, alerted: false })
      return { errors: 0, alerted: false }
    }
    const email = renderErrorDigest(rows)
    await sendEmail({ to: staffAlertEmail(), subject: email.subject, html: email.html, text: email.text })
    await run.finish({ errors: rows.length, alerted: true })
    return { errors: rows.length, alerted: true }
  } catch (err) {
    console.error('[app-errors] daily digest failed:', err)
    run.fail('digest', err)
    await run.finish({ alerted: false })
    return { errors: 0, alerted: false }
  }
}
