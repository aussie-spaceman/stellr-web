import crypto from 'crypto'
import { NextResponse, after } from 'next/server'
import { acceptUpload, markPhase, runOffload, targetForRoom } from '@/lib/recording-offload'

// Recording offload (FR-COM-11/12 sessions + FR-COM-10 live training lessons).
//
// JaaS keeps a cloud recording's download link (preAuthenticatedLink) alive for
// only ~24h, so its RECORDING_UPLOADED webhook must pull the file into private
// Supabase Storage promptly. The link is saved first and the event acknowledged
// straight away; the copy runs after the response, so JaaS does not redeliver a
// slow copy and a failure can be retried from the course builder. JaaS signs every webhook (HMAC-SHA256 over
// "<timestamp>.<rawBody>", base64, in the X-Jaas-Signature header) — we verify
// that before trusting the payload.
//
// The room name encodes which entity the recording belongs to:
//   stellr-train-<itemId>  → training_items   (live lesson; becomes the replay)
//   stellr-<sessionId>     → sessions         (coaching/mentoring)
//
// A legacy shared-secret path ({ sessionId, recordingUrl } + x-webhook-secret)
// is kept for manual re-offload / testing.

export const runtime = 'nodejs'

// The copy runs after the response, inside this limit (lib/recording-offload.ts).
export const maxDuration = 300

const JAAS_WEBHOOK_SECRET = process.env.JAAS_WEBHOOK_SECRET
const LEGACY_SECRET = process.env.RECORDING_WEBHOOK_SECRET

/** Verify the JaaS X-Jaas-Signature header against the raw request body. */
function verifyJaasSignature(header: string, rawBody: string, secret: string): boolean {
  // Header format: "t=1632490060,v1=base64sig"
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=')
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()]
    })
  ) as { t?: string; v1?: string }

  if (!parts.t || !parts.v1) return false

  // Reject stale signatures (>5 min skew) to blunt replay attacks.
  const ts = Number(parts.t)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${parts.t}.${rawBody}`)
    .digest('base64')

  const a = Buffer.from(expected)
  const b = Buffer.from(parts.v1)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function POST(req: Request) {
  const raw = await req.text()
  const jaasSig = req.headers.get('x-jaas-signature')

  // ── JaaS-signed webhook (primary path) ──────────────────────────────────
  if (jaasSig) {
    if (!JAAS_WEBHOOK_SECRET) {
      console.error('[recording] JAAS_WEBHOOK_SECRET not set — cannot verify webhook.')
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
    }
    if (!verifyJaasSignature(jaasSig, raw, JAAS_WEBHOOK_SECRET)) {
      return NextResponse.json({ error: 'Bad signature' }, { status: 401 })
    }

    let payload: {
      eventType?: string
      fqn?: string
      idempotencyKey?: string
      data?: { preAuthenticatedLink?: string }
    }
    try {
      payload = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    // fqn is "<appId>/<roomName>"; the room name is everything after the slash.
    const fqn = payload.fqn ?? ''
    const slash = fqn.indexOf('/')
    const room = slash >= 0 ? fqn.slice(slash + 1) : ''
    const target = room ? targetForRoom(room) : null

    // Status only: the course builder shows these as they happen.
    if (target && payload.eventType === 'RECORDING_STARTED') await markPhase(target, 'recording')
    if (target && payload.eventType === 'RECORDING_ENDED') await markPhase(target, 'processing')

    if (payload.eventType !== 'RECORDING_UPLOADED') {
      return NextResponse.json({ ok: true, ignored: payload.eventType ?? 'unknown' })
    }

    const link = payload.data?.preAuthenticatedLink
    if (!link || !target) {
      // Nothing actionable — ack so JaaS doesn't retry indefinitely.
      console.warn('[recording] upload event missing link/target:', payload.fqn)
      return NextResponse.json({ ok: true, skipped: true })
    }

    // If the link cannot be saved, answer 500 so JaaS redelivers it: this request
    // holds the only copy.
    let accepted: boolean
    try {
      accepted = await acceptUpload(target, link, payload.idempotencyKey ?? null)
    } catch (e) {
      console.error('[recording] could not save the download link:', e)
      return NextResponse.json({ ok: false }, { status: 500 })
    }
    if (accepted) after(() => runOffload(target).then(() => undefined))
    return NextResponse.json({ ok: true, duplicate: !accepted })
  }

  // ── Legacy shared-secret path (manual re-offload / testing) ──────────────
  // Fail CLOSED: if LEGACY_SECRET is unset this path must reject, not run
  // unauthenticated. `offload()` does a server-side fetch(recordingUrl) and writes
  // into the private bucket, so an unauthenticated caller here is an SSRF +
  // arbitrary-recording-overwrite vector. Constant-time compare on the secret.
  const provided = req.headers.get('x-webhook-secret') ?? ''
  if (!LEGACY_SECRET) {
    return NextResponse.json({ error: 'Legacy path disabled' }, { status: 403 })
  }
  {
    const a = Buffer.from(provided)
    const b = Buffer.from(LEGACY_SECRET)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    }
  }
  let body: { sessionId?: string; recordingUrl?: string }
  try {
    body = JSON.parse(raw)
  } catch {
    body = {}
  }
  if (!body.sessionId || !body.recordingUrl) {
    return NextResponse.json({ error: 'sessionId and recordingUrl required' }, { status: 400 })
  }
  const target = { kind: 'session' as const, id: body.sessionId }
  await acceptUpload(target, body.recordingUrl, null)
  const ok = await runOffload(target)
  return NextResponse.json({ ok }, { status: ok ? 200 : 500 })
}
