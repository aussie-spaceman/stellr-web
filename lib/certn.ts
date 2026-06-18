// Certn (certn.co) background-check client — PRD §13.
//
// Stellr orders checks on behalf of adult non-students using Certn's HR vertical
// and the HOSTED INVITE flow: we send Certn the candidate's email plus the set
// of checks we want, and Certn emails the candidate to self-complete their PII,
// ID verification and consent on Certn-hosted pages (FCRA/PIPEDA-clean — Certn,
// the CRA, owns consent capture). We learn the outcome via a webhook.
//
// Stellr is billed per check by Certn; there is no applicant-pays step (the
// member is NOT charged — user decision 17-Jun). Validity (3yr) is enforced on
// our side, not by Certn.
//
// Env follows the DocuSign/Printful pattern (ENV read at module load):
//   CERTN_CLIENT_ID / CERTN_CLIENT_SECRET  — OAuth2 client-credentials
//   CERTN_BASE_URL    — https://demo-api.certn.co (sandbox) | https://api.certn.co
//   CERTN_WEBHOOK_SECRET — optional shared secret matched on the inbound webhook

import { createHmac, timingSafeEqual } from 'crypto'

const ENV = {
  clientId:     process.env.CERTN_CLIENT_ID     ?? '',
  clientSecret: process.env.CERTN_CLIENT_SECRET ?? '',
  baseUrl:     (process.env.CERTN_BASE_URL      ?? 'https://demo-api.certn.co').replace(/\/$/, ''),
  webhookSecret: process.env.CERTN_WEBHOOK_SECRET ?? '',
}

export function certnConfigured(): boolean {
  return !!(ENV.clientId && ENV.clientSecret)
}

let tokenCache: { accessToken: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.accessToken
  if (!certnConfigured()) throw new Error('Certn not configured (CERTN_CLIENT_ID / CERTN_CLIENT_SECRET)')

  const basic = Buffer.from(`${ENV.clientId}:${ENV.clientSecret}`).toString('base64')
  const res = await fetch(`${ENV.baseUrl}/token/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) throw new Error(`Certn auth failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { access_token: string; expires_in: number }
  tokenCache = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return tokenCache.accessToken
}

async function certnRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken()
  const { headers: extra, ...rest } = init
  return fetch(`${ENV.baseUrl}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extra,
    },
  })
}

// The checks we request for an adult clearance: Enhanced Criminal Record Check +
// Enhanced Identity Verification (US adults additionally get tier-2 criminal).
// We deliberately do NOT request a Vulnerable Sector Check — those can't be done
// online by any provider in Canada (PRD copy says "Background Check", not VSC).
export function defaultRequestFlags(country?: string | null): Record<string, boolean> {
  const flags: Record<string, boolean> = {
    request_enhanced_criminal_record_check: true,
    request_enhanced_identity_verification: true,
  }
  if ((country ?? '').toUpperCase() === 'US' || (country ?? '').toUpperCase() === 'USA') {
    flags.request_us_criminal_record_check_tier_2 = true
  }
  return flags
}

export interface OrderCheckInput {
  email: string
  firstName: string
  lastName: string
  flags?: Record<string, boolean>
}

export interface OrderedCheck {
  applicationId: string
  status: string // raw Certn status
  flags: Record<string, boolean>
}

/**
 * Place a background-check order via the hosted invite flow. Certn emails the
 * candidate to complete their info & consent. Returns the Certn application id
 * we store and reconcile webhooks against.
 */
export async function orderCheck(input: OrderCheckInput): Promise<OrderedCheck> {
  const flags = input.flags ?? defaultRequestFlags()
  const res = await certnRequest('/api/v1/hr/applications/', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email,
      first_name: input.firstName,
      last_name: input.lastName,
      // Invite flow: Certn collects the rest from the candidate.
      ...flags,
    }),
  })
  if (!res.ok) throw new Error(`Certn order failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { id?: string; short_uid?: string; report_status?: string; status?: string }
  const applicationId = data.id ?? data.short_uid
  if (!applicationId) throw new Error('Certn order returned no application id')
  return { applicationId, status: data.report_status ?? data.status ?? 'WAITING_ON_CANDIDATE', flags }
}

export interface CertnApplication {
  applicationId: string
  reportStatus: string // ANALYZING | IN_PROGRESS | COMPLETE
  result: string | null // CLEARED | REFERRED | null
  raw: unknown
}

export async function getApplication(applicationId: string): Promise<CertnApplication> {
  const res = await certnRequest(`/api/v1/hr/applicants/${applicationId}/`)
  if (!res.ok) throw new Error(`Certn fetch failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as Record<string, unknown>
  return parseApplication(data, applicationId)
}

// Normalise a Certn application/webhook body into our shape. Certn's exact
// status/result enum sits behind a gated help page; we read report_status +
// result defensively and map to our domain statuses in mapResult().
export function parseApplication(data: Record<string, unknown>, fallbackId?: string): CertnApplication {
  const applicationId =
    (data.id as string) ?? (data.short_uid as string) ?? fallbackId ?? ''
  const reportStatus = ((data.report_status as string) ?? (data.status as string) ?? '').toUpperCase()
  const result =
    (data.result as string) ?? (data.result_label as string) ?? (data.certn_score_label as string) ?? null
  return { applicationId, reportStatus, result, raw: data }
}

export type MappedStatus = 'in_progress' | 'passed' | 'referred'

/**
 * Map a Certn report_status + result to our background-check status.
 * Anything not yet COMPLETE → in_progress. COMPLETE → passed when the result
 * reads cleared/pass/negative; otherwise referred (flagged for review).
 */
export function mapResult(reportStatus: string, result: string | null): MappedStatus {
  if (reportStatus.toUpperCase() !== 'COMPLETE') return 'in_progress'
  const r = (result ?? '').toUpperCase()
  const cleared = ['CLEARED', 'CLEAR', 'PASS', 'PASSED', 'NEGATIVE', 'NONE'].some((k) => r.includes(k))
  return cleared ? 'passed' : 'referred'
}

/** Fetch the completed report PDF for an application (best-effort). */
export async function fetchReportPdf(applicationId: string): Promise<ArrayBuffer | null> {
  try {
    const res = await certnRequest(`/api/v1/hr/applicants/${applicationId}/reports/`, {
      headers: { Accept: 'application/pdf' },
    })
    if (!res.ok) return null
    return await res.arrayBuffer()
  } catch {
    return null
  }
}

/**
 * Verify an inbound Certn webhook. When CERTN_WEBHOOK_SECRET is set, Certn signs
 * the raw body (HMAC-SHA256, hex) in the Certn-Signature header. With no secret
 * configured we accept (sandbox/dev) — but log so it's visible.
 */
export function verifyWebhook(rawBody: string, signature: string | null): boolean {
  if (!ENV.webhookSecret) {
    console.warn('[certn] CERTN_WEBHOOK_SECRET not set — accepting webhook unverified')
    return true
  }
  if (!signature) return false
  const expected = createHmac('sha256', ENV.webhookSecret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature.trim())
  return a.length === b.length && timingSafeEqual(a, b)
}
