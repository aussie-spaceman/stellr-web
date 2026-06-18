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

async function checkrPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${ENV.baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Checkr ${path} failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

// ─── Webhook parsing ─────────────────────────────────────────────────────────

interface CheckrEnvelope {
  type?: string
  data?: { object?: Record<string, unknown> }
}

// Map a Checkr report (status + result) to our domain status. Only a complete
// report is terminal: complete+clear → passed, complete+consider → referred.
// pending/suspended/resumed mean Checkr is still working → in_progress.
function mapReport(status: string | undefined, result: string | null): MappedStatus {
  if ((status ?? '').toLowerCase() !== 'complete') return 'in_progress'
  return (result ?? '').toLowerCase() === 'clear' ? 'passed' : 'referred'
}

export const checkrProvider: BackgroundProvider = {
  name: 'checkr',

  configured,

  async order(input: BackgroundOrderInput): Promise<BackgroundOrder> {
    if (!configured()) throw new Error('Checkr not configured (CHECKR_API_KEY / CHECKR_PACKAGE_SLUG)')

    // 1) Candidate shell — the candidate supplies SSN/PII on the hosted page.
    const candidate = await checkrPost<{ id: string }>('/candidates', {
      first_name: input.firstName,
      last_name: input.lastName,
      email: input.email,
      no_middle_name: true,
    })

    // 2) Invitation — Checkr emails the candidate and returns the hosted apply URL.
    const state = (input.state || ENV.workLocation || '').toUpperCase()
    const invitation = await checkrPost<{ id: string; invitation_url?: string; status?: string }>(
      '/invitations',
      {
        candidate_id: candidate.id,
        package: ENV.packageSlug,
        work_locations: [{ country: 'US', ...(state ? { state } : {}) }],
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
    if (!ENV.webhookSecret) {
      console.warn('[checkr] no API key/webhook secret set — accepting webhook unverified')
      return true
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

    // Reports carry candidate_id + result; invitations carry candidate_id + report_id.
    const candidateRef = (obj.candidate_id as string) ?? null
    const result = (obj.result as string) ?? null

    if (type.startsWith('report.')) {
      const reportRef = (obj.id as string) ?? null
      const status = mapReport(obj.status as string | undefined, result)
      return { candidateRef, invitationRef: null, reportRef, status, result }
    }

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
      return { candidateRef, invitationRef: (obj.id as string) ?? null, reportRef: null, status: null, result: 'expired' }
    }

    // Other events (candidate.*, report.created without a useful delta, etc.) are ignored.
    return null
  },
}
