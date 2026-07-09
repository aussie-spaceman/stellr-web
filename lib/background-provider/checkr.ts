// Checkr (checkr.com) provider — US background checks via the hosted invite flow.
//
// Order flow is two calls: create a Candidate (name + email), then create an
// Invitation against a dashboard-defined package slug. Checkr emails the
// candidate a hosted apply page (invitation_url) where they enter their PII and
// give FCRA consent — so Checkr, the CRA, owns consent capture and we never
// collect SSNs. Stellr is billed per report; the candidate is never charged.
//
// Auth is HTTP Basic with the secret API key as the username and a blank
// password. Webhooks are signed with X-Checkr-Signature = HMAC-SHA256(rawBody,
// apiKey). Outcomes arrive as { type, data: { object } } envelopes; we map the
// report result (clear / consider) onto our domain status.
//
// Env:
//   CHECKR_API_KEY            secret key (server-side). Required to place orders.
//   CHECKR_BASE_URL           https://api.checkr-staging.com/v1 | https://api.checkr.com/v1
//   CHECKR_PACKAGE_SLUG       the criminal+identity package slug from YOUR dashboard
//   CHECKR_WORK_LOCATION_STATE default US state for work_locations (e.g. 'CA')
//   CHECKR_WEBHOOK_SECRET     optional; defaults to CHECKR_API_KEY (Checkr signs
//                             with the API key)

import { createHmac, timingSafeEqual } from 'crypto'
import type {
  BackgroundProvider,
  BackgroundOrder,
  BackgroundOrderInput,
  BackgroundWebhookResult,
  MappedStatus,
} from '@/lib/background-provider/types'

const ENV = {
  apiKey:        process.env.CHECKR_API_KEY ?? '',
  baseUrl:      (process.env.CHECKR_BASE_URL ?? 'https://api.checkr-staging.com/v1').replace(/\/$/, ''),
  packageSlug:   process.env.CHECKR_PACKAGE_SLUG ?? '',
  workLocation:  process.env.CHECKR_WORK_LOCATION_STATE ?? '',
  webhookSecret: process.env.CHECKR_WEBHOOK_SECRET ?? process.env.CHECKR_API_KEY ?? '',
}

function configured(): boolean {
  return !!(ENV.apiKey && ENV.packageSlug)
}

function authHeader(): string {
  // Secret key as the username, empty password.
  return `Basic ${Buffer.from(`${ENV.apiKey}:`).toString('base64')}`
}

async function checkrPost<T>(
  path: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(`${ENV.baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Checkr ${path} failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

// Basic data validation before any POST (Checkr REQUIRED): reject obviously bad
// input here so we surface a clear error rather than a 400 from Checkr's API.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function validateOrder(input: BackgroundOrderInput): void {
  const problems: string[] = []
  if (!input.firstName?.trim()) problems.push('first name')
  if (!input.lastName?.trim()) problems.push('last name')
  if (!input.email?.trim() || !EMAIL_RE.test(input.email.trim())) problems.push('a valid email address')
  if (problems.length) throw new Error(`Background check needs ${problems.join(', ')} before it can be ordered`)
}

// ─── Webhook parsing ─────────────────────────────────────────────────────────

interface CheckrEnvelope {
  type?: string
  data?: { object?: Record<string, unknown> }
}

// Map a Checkr report to our domain status, matching how Checkr's own dashboard
// labels an SMB report (so our status always agrees with theirs).
//
// Only a `complete` report is terminal (pending/suspended/resumed → in progress).
// The raw `result` drives the status; "Assess" support means a `consider` result
// that Assess deems `eligible` is treated as cleared. `includes_canceled` is a
// cancellation signal, not a pass: a report that completes with no reportable
// result but canceled screenings is "Canceled", even though Assess auto-tags it
// `review` (that tag reflects the cancellation, not an actual record to review —
// so it must not override a clear result or turn a cancellation into a review).
function mapReport(
  status: string | undefined,
  result: string | null,
  assessment: string | null,
  includesCanceled: boolean,
): MappedStatus {
  if ((status ?? '').toLowerCase() !== 'complete') return 'in_progress'

  const r = (result ?? '').toLowerCase()
  const a = (assessment ?? '').toLowerCase()

  // Completed with no reportable result but canceled screenings → "Canceled".
  if (!r && includesCanceled) return 'cancelled'
  // A clear result is cleared; includes_canceled is surfaced only as an indicator.
  if (r === 'clear') return 'passed'
  // Charges found: Assess can still clear them (eligible); otherwise human review.
  if (r === 'consider') return a === 'eligible' ? 'passed' : 'referred'
  // No raw result but an Assess tag exists → honour it.
  if (a) return a === 'eligible' ? 'passed' : 'referred'
  // Complete with nothing usable: surface for review rather than silently passing.
  return includesCanceled ? 'cancelled' : 'referred'
}

export const checkrProvider: BackgroundProvider = {
  name: 'checkr',

  configured,

  async order(input: BackgroundOrderInput): Promise<BackgroundOrder> {
    if (!configured()) throw new Error('Checkr not configured (CHECKR_API_KEY / CHECKR_PACKAGE_SLUG)')
    validateOrder(input)

    const state = (input.state || ENV.workLocation || '').toUpperCase()
    const workLocations = [{ country: 'US', ...(state ? { state } : {}) }]

    // 1) Candidate shell — the candidate supplies SSN/PII on the hosted page. We
    // send work_locations here too (Account Hierarchy requirement) but NOT the SSN
    // or DL (Checkr doesn't pre-populate them). An idempotency key prevents a
    // retry from creating a duplicate candidate within Checkr's 24h window.
    const candidate = await checkrPost<{ id: string }>(
      '/candidates',
      {
        first_name: input.firstName.trim(),
        last_name: input.lastName.trim(),
        email: input.email.trim(),
        no_middle_name: true,
        work_locations: workLocations,
      },
      input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {},
    )

    // 2) Invitation — Checkr emails the candidate and returns the hosted apply URL.
    const invitation = await checkrPost<{ id: string; invitation_url?: string; status?: string }>(
      '/invitations',
      {
        candidate_id: candidate.id,
        package: ENV.packageSlug,
        work_locations: workLocations,
      },
    )

    return {
      candidateRef: candidate.id,
      invitationRef: invitation.id,
      reportRef: null, // populated when the candidate completes and a report is created
      invitationUrl: invitation.invitation_url ?? null,
      rawStatus: invitation.status ?? 'pending',
    }
  },

  verifyWebhook(rawBody: string, headers: Headers): boolean {
    const signature = headers.get('x-checkr-signature')
    // Fail CLOSED when the secret is unset. This gates background-check pass/fail
    // for people working with minors — an unconfigured secret must never accept an
    // unauthenticated POST that could flip a compliance result.
    if (!ENV.webhookSecret) {
      console.error('[checkr] webhook secret not set — rejecting webhook (fail closed)')
      return false
    }
    if (!signature) return false
    const expected = createHmac('sha256', ENV.webhookSecret).update(rawBody).digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(signature.trim())
    return a.length === b.length && timingSafeEqual(a, b)
  },

  parseWebhook(rawBody: string): BackgroundWebhookResult | null {
    let env: CheckrEnvelope
    try {
      env = JSON.parse(rawBody) as CheckrEnvelope
    } catch {
      return null
    }
    const type = env.type ?? ''
    const obj = env.data?.object ?? {}

    // Reports carry candidate_id + result/assessment; invitations carry
    // candidate_id + report_id.
    const candidateRef = (obj.candidate_id as string) ?? null
    const result = (obj.result as string) ?? null
    const assessment = (obj.assessment as string) ?? null
    const includesCanceled = obj.includes_canceled === true

    // ── Report lifecycle ──────────────────────────────────────────────────────
    if (type.startsWith('report.')) {
      const reportRef = (obj.id as string) ?? null
      const base = { candidateRef, invitationRef: null, reportRef, result, assessment, includesCanceled }

      // report.canceled — every screening canceled before any completed.
      if (type === 'report.canceled') return { ...base, status: 'cancelled', result: result ?? 'canceled' }
      // report.engaged — an adjudicator engaged the report; treat as cleared.
      if (type === 'report.engaged') return { ...base, status: 'passed' }
      // Adverse action / dispute — flagged for human review.
      if (type === 'report.pre_adverse_action' || type === 'report.post_adverse_action' || type === 'report.disputed')
        return { ...base, status: 'referred' }
      // suspended/resumed — Checkr is still working the report.
      if (type === 'report.suspended' || type === 'report.resumed') return { ...base, status: 'in_progress' }
      // report.completed (and any other report.* carrying a status) — map it.
      return { ...base, status: mapReport(obj.status as string | undefined, result, assessment, includesCanceled) }
    }

    // ── Invitation lifecycle ──────────────────────────────────────────────────
    if (type === 'invitation.completed') {
      // The report now exists; mark in-progress and capture its id. The terminal
      // outcome arrives via report.completed.
      return {
        candidateRef,
        invitationRef: (obj.id as string) ?? null,
        reportRef: (obj.report_id as string) ?? null,
        status: 'in_progress',
        result: null,
      }
    }

    if (type === 'invitation.expired') {
      return { candidateRef, invitationRef: (obj.id as string) ?? null, reportRef: null, status: 'expired', result: 'expired' }
    }

    if (type === 'invitation.deleted') {
      return { candidateRef, invitationRef: (obj.id as string) ?? null, reportRef: null, status: 'cancelled', result: 'canceled' }
    }

    // Other events (candidate.*, invitation.created — we already record 'invited'
    // at order time, report.created without a useful delta, etc.) are ignored.
    return null
  },
}
