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

// deep review INT-11: a recording can be several hundred MB, so give the pull +
// upload real headroom rather than the platform default, which could kill the
// function mid-upload (leaving the row stuck 'pending' and JaaS re-downloading
// the whole file on every retry until the ~24h link expires).
export const maxDuration = 300

const JAAS_WEBHOOK_SECRET = process.env.JAAS_WEBHOOK_SECRET
const LEGACY_SECRET = process.env.RECORDING_WEBHOOK_SECRET

// deep review INT-11: refuse to buffer a recording larger than this into memory.
// The webhook downloads the whole file into a Buffer before uploading, so an
// unexpectedly huge file would OOM the function; a Content-Length over the cap
// is rejected up front instead. Override with RECORDING_MAX_BYTES if JaaS
// recordings legitimately exceed it. Default 1 GiB.
const MAX_RECORDING_BYTES = Number(process.env.RECORDING_MAX_BYTES) || 1024 * 1024 * 1024

type Target = { kind: 'session' | 'training'; id: string }

/**
 * Deterministic storage path for a recording (INT-11). Previously the path
 * carried a `Date.now()` suffix, so every JaaS retry wrote to a NEW object and
 * orphaned the last one. A stable path + upsert means a retry overwrites in
 * place — no orphans — and matches how the watermark worker rewrites the same path.
 */
export function recordingStoragePath(target: Target): string {
  const prefix = target.kind === 'session' ? target.id : `train-${target.id}`
  return `recordings/${prefix}.mp4`
}

/** Guard against buffering an oversized recording into memory (INT-11). */
export function recordingWithinSizeLimit(contentLength: number | null, max = MAX_RECORDING_BYTES): boolean {
  if (contentLength == null || !Number.isFinite(contentLength)) return true // unknown size: let it through, bounded by maxDuration
  return contentLength <= max
}

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

    // deep review INT-11: reject an oversized file before buffering it, so a
    // pathological recording can't OOM the function.
    const contentLength = Number(res.headers.get('content-length'))
    if (!recordingWithinSizeLimit(Number.isFinite(contentLength) ? contentLength : null)) {
      throw new Error(`recording too large: ${contentLength} bytes > ${MAX_RECORDING_BYTES}`)
    }

    const buf = Buffer.from(await res.arrayBuffer())
    // deep review INT-11: deterministic path (no Date.now()) so a JaaS retry
    // overwrites in place instead of orphaning the previous upload.
    const path = recordingStoragePath(target)

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
  const ok = await offload({ kind: 'session', id: body.sessionId }, body.recordingUrl)
  return NextResponse.json({ ok }, { status: ok ? 200 : 500 })
}
