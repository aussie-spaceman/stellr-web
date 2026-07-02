import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { RESOURCES_BUCKET } from '@/lib/community'
import { enqueueVideoWatermark } from '@/lib/watermark/video-queue'

// Recording offload (FR-COM-11/12 sessions + FR-COM-10 live training lessons).
//
// JaaS keeps a cloud recording's download link (preAuthenticatedLink) alive for
// only ~24h, so its RECORDING_UPLOADED webhook must pull the file into private
// Supabase Storage promptly. JaaS signs every webhook (HMAC-SHA256 over
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

const JAAS_WEBHOOK_SECRET = process.env.JAAS_WEBHOOK_SECRET
const LEGACY_SECRET = process.env.RECORDING_WEBHOOK_SECRET

type Target = { kind: 'session' | 'training'; id: string }

/** Map a JaaS room name back to the entity that owns the recording. */
function targetForRoom(room: string): Target | null {
  if (room.startsWith('stellr-train-')) {
    return { kind: 'training', id: room.slice('stellr-train-'.length) }
  }
  if (room.startsWith('stellr-')) {
    return { kind: 'session', id: room.slice('stellr-'.length) }
  }
  return null
}

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

/**
 * Pull a recording into private Supabase Storage and record its path on the
 * owning row. Best-effort: marks 'pending' first, 'available' on success, and
 * rolls back to 'none' on failure.
 */
async function offload(target: Target, recordingUrl: string): Promise<boolean> {
  const db = supabaseServer()
  const table = target.kind === 'session' ? 'sessions' : 'training_items'
  await db.from(table).update({ recording_status: 'pending' }).eq('id', target.id)

  try {
    const res = await fetch(recordingUrl)
    if (!res.ok) throw new Error(`fetch ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const prefix = target.kind === 'session' ? target.id : `train-${target.id}`
    const path = `recordings/${prefix}-${Date.now()}.mp4`

    const { error: upErr } = await db.storage
      .from(RESOURCES_BUCKET)
      .upload(path, buf, { contentType: 'video/mp4', upsert: true })
    if (upErr) throw upErr

    await db
      .from(table)
      .update({ recording_path: path, recording_status: 'available' })
      .eq('id', target.id)

    // Queue the recording for the "© Stellr Education" watermark (burned in by
    // scripts/watermark-worker.ts — ffmpeg can't run here). The worker overwrites
    // this same path in place once it processes the job.
    await enqueueVideoWatermark(db, RESOURCES_BUCKET, path, 'recording')
    return true
  } catch (e) {
    console.error('[recording] offload failed:', e)
    await db.from(table).update({ recording_status: 'none' }).eq('id', target.id)
    return false
  }
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
      data?: { preAuthenticatedLink?: string }
    }
    try {
      payload = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    // Ack everything; we only act on the upload event.
    if (payload.eventType !== 'RECORDING_UPLOADED') {
      return NextResponse.json({ ok: true, ignored: payload.eventType ?? 'unknown' })
    }

    const link = payload.data?.preAuthenticatedLink
    // fqn is "<appId>/<roomName>"; the room name is everything after the slash.
    const fqn = payload.fqn ?? ''
    const slash = fqn.indexOf('/')
    const room = slash >= 0 ? fqn.slice(slash + 1) : ''
    const target = room ? targetForRoom(room) : null
    if (!link || !target) {
      // Nothing actionable — ack so JaaS doesn't retry indefinitely.
      console.warn('[recording] upload event missing link/target:', payload.fqn)
      return NextResponse.json({ ok: true, skipped: true })
    }

    const ok = await offload(target, link)
    return NextResponse.json({ ok }, { status: ok ? 200 : 500 })
  }

  // ── Legacy shared-secret path (manual re-offload / testing) ──────────────
  if (LEGACY_SECRET && req.headers.get('x-webhook-secret') !== LEGACY_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
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
  const ok = await offload({ kind: 'session', id: body.sessionId }, body.recordingUrl)
  return NextResponse.json({ ok }, { status: ok ? 200 : 500 })
}
