import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer } from '@/lib/supabase'
import { RESOURCES_BUCKET } from '@/lib/community'
import { enqueueVideoWatermark } from '@/lib/watermark/video-queue'
import { notifyCommunityAdmins } from '@/lib/notify'
import { SAVING_STALE_MS } from '@/lib/recording-view'

// Moves a recording from JaaS into private storage (FR-COM-10/11/12).
//
// JaaS keeps a recording's download link alive for 24 hours. The link is saved
// before anything else happens, so a failed copy can be retried for as long as
// the file exists. The copy is streamed, not buffered: a 30-minute recording is
// hundreds of megabytes, and holding it in memory is what the 1 GiB guard below
// used to exist for.

export type RecordingTarget = { kind: 'session' | 'training'; id: string }

const JAAS_LINK_TTL_MS = 24 * 60 * 60 * 1000
const MB = 1024 * 1024

// Leave the function room to record the outcome before the 300 s limit kills it.
const COPY_TIMEOUT_MS = 280_000
// A transient failure inside this window gets one more try in the same run.
const RETRY_WITHIN_MS = 120_000

const MAX_RECORDING_BYTES = Number(process.env.RECORDING_MAX_BYTES) || 2048 * MB

/** Stable path + upsert, so a retry overwrites in place instead of orphaning a file. */
export function recordingStoragePath(target: RecordingTarget): string {
  const prefix = target.kind === 'session' ? target.id : `train-${target.id}`
  return `recordings/${prefix}.mp4`
}

export function recordingWithinSizeLimit(contentLength: number | null, max = MAX_RECORDING_BYTES): boolean {
  if (contentLength == null || !Number.isFinite(contentLength)) return true
  return contentLength <= max
}

/** Map a JaaS room name back to the entity that owns the recording. */
export function targetForRoom(room: string): RecordingTarget | null {
  if (room.startsWith('stellr-train-')) return { kind: 'training', id: room.slice('stellr-train-'.length) }
  if (room.startsWith('stellr-')) return { kind: 'session', id: room.slice('stellr-'.length) }
  return null
}

const ownerTable = (target: RecordingTarget) => (target.kind === 'session' ? 'sessions' : 'training_items')

/** Refused for a reason a second attempt cannot change. */
class PermanentError extends Error {}

function describeSize(bytes: number | null): string {
  return bytes ? `This recording is ${Math.round(bytes / MB)} MB, which is` : 'This recording is'
}

/** The sentence an admin reads. Never the raw provider error. */
export function failureMessage(err: unknown, sizeBytes: number | null): string {
  const e = err as { statusCode?: string; code?: string; message?: string } | null
  if (e?.statusCode === '413' || e?.code === 'EntityTooLarge') {
    return `${describeSize(sizeBytes)} over the storage limit per file.`
  }
  if (err instanceof PermanentError) return err.message
  if (e && typeof e === 'object' && 'name' in e && (e as { name?: string }).name === 'TimeoutError') {
    return 'Copying the file took longer than the 5 minutes allowed.'
  }
  return 'Copying the file from JaaS failed.'
}

/** Record a phase the room or JaaS reported. Never throws: this is only status. */
export async function markPhase(
  target: RecordingTarget,
  phase: 'recording' | 'processing',
  db: SupabaseClient = supabaseServer(),
): Promise<void> {
  const now = new Date().toISOString()
  if (phase === 'recording') {
    const { error } = await db.from('recording_offloads').upsert(
      {
        target_kind: target.kind,
        target_id: target.id,
        status: 'recording',
        source_url: null,
        source_expires_at: null,
        idempotency_key: null,
        error: null,
        size_bytes: null,
        attempts: 0,
        updated_at: now,
      },
      { onConflict: 'target_kind,target_id' },
    )
    if (error) console.error('[recording] could not mark recording:', error)
    return
  }
  // Only from 'recording': the file can arrive before the room reports its end.
  const { error } = await db
    .from('recording_offloads')
    .update({ status: 'processing', updated_at: now })
    .eq('target_kind', target.kind)
    .eq('target_id', target.id)
    .eq('status', 'recording')
  if (error) console.error('[recording] could not mark processing:', error)
}

/**
 * Save the link from a RECORDING_UPLOADED event. This must succeed before the
 * event is acknowledged, because it is the only copy. Returns false for a
 * redelivery of an event already being handled or already done.
 */
export async function acceptUpload(
  target: RecordingTarget,
  link: string,
  idempotencyKey: string | null,
  db: SupabaseClient = supabaseServer(),
): Promise<boolean> {
  if (idempotencyKey) {
    const { data: existing } = await db
      .from('recording_offloads')
      .select('idempotency_key')
      .eq('target_kind', target.kind)
      .eq('target_id', target.id)
      .maybeSingle()
    if (existing?.idempotency_key === idempotencyKey) return false
  }
  const { error } = await db.from('recording_offloads').upsert(
    {
      target_kind: target.kind,
      target_id: target.id,
      status: 'failed', // runOffload claims it; a crash before then stays retryable.
      source_url: link,
      source_expires_at: new Date(Date.now() + JAAS_LINK_TTL_MS).toISOString(),
      idempotency_key: idempotencyKey,
      error: null,
      attempts: 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'target_kind,target_id' },
  )
  if (error) throw error
  return true
}

/** Take the job, unless another run holds it and is still within the time limit. */
async function claim(target: RecordingTarget, db: SupabaseClient) {
  const staleBefore = new Date(Date.now() - SAVING_STALE_MS).toISOString()
  const { data, error } = await db
    .from('recording_offloads')
    .update({ status: 'saving', error: null, updated_at: new Date().toISOString() })
    .eq('target_kind', target.kind)
    .eq('target_id', target.id)
    .not('source_url', 'is', null)
    .or(`status.neq.saving,updated_at.lt.${staleBefore}`)
    .select('source_url, attempts')
    .maybeSingle()
  if (error) throw error
  return data as { source_url: string; attempts: number } | null
}

/** One streamed copy. Returns the size JaaS declared, if it declared one. */
async function copyOnce(sourceUrl: string, path: string, db: SupabaseClient, onSize: (b: number | null) => void): Promise<void> {
  const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(COPY_TIMEOUT_MS) })
  if (res.status === 403 || res.status === 404 || res.status === 410) {
    throw new PermanentError('JaaS no longer has this file. The link may have expired.')
  }
  if (!res.ok || !res.body) throw new Error(`fetch ${res.status}`)

  const declared = Number(res.headers.get('content-length'))
  const size = Number.isFinite(declared) && declared > 0 ? declared : null
  onSize(size)
  if (!recordingWithinSizeLimit(size)) {
    await res.body.cancel().catch(() => {})
    throw new PermanentError(`${describeSize(size)} over the ${Math.round(MAX_RECORDING_BYTES / MB)} MB limit for a recording.`)
  }

  const { error } = await db.storage
    .from(RESOURCES_BUCKET)
    .upload(path, res.body as unknown as ReadableStream, { contentType: 'video/mp4', upsert: true, duplex: 'half' })
  if (error) throw error
}

/**
 * Run a saved job through to its end. Returns true when the file is stored.
 * Never throws: every outcome is written to the row, and a failure tells the
 * admins, because the link only lasts a day.
 */
export async function runOffload(target: RecordingTarget, db: SupabaseClient = supabaseServer()): Promise<boolean> {
  const table = ownerTable(target)
  let size: number | null = null
  try {
    const job = await claim(target, db)
    if (!job) return false

    // Keep a playable older recording playable while its replacement is copied.
    const { data: owner } = await db.from(table).select('recording_path').eq('id', target.id).maybeSingle()
    if (!owner?.recording_path) await db.from(table).update({ recording_status: 'pending' }).eq('id', target.id)

    const path = recordingStoragePath(target)
    const started = Date.now()
    let attempts = job.attempts
    for (;;) {
      attempts += 1
      try {
        await copyOnce(job.source_url, path, db, (b) => { size = b })
        break
      } catch (err) {
        const permanent = err instanceof PermanentError || (err as { statusCode?: string }).statusCode === '413'
        if (permanent || Date.now() - started > RETRY_WITHIN_MS || attempts - job.attempts >= 2) {
          await db.from('recording_offloads').update({ attempts }).eq('target_kind', target.kind).eq('target_id', target.id)
          throw err
        }
        console.warn('[recording] copy failed, retrying once:', err)
      }
    }

    await db.from(table).update({ recording_path: path, recording_status: 'available' }).eq('id', target.id)
    await db
      .from('recording_offloads')
      .update({ status: 'saved', source_url: null, source_expires_at: null, error: null, size_bytes: size, attempts, updated_at: new Date().toISOString() })
      .eq('target_kind', target.kind)
      .eq('target_id', target.id)

    // Burned in by scripts/watermark-worker.ts, which rewrites this same path.
    await enqueueVideoWatermark(db, RESOURCES_BUCKET, path, 'recording')
    return true
  } catch (err) {
    console.error('[recording] offload failed:', err)
    const message = failureMessage(err, size)
    await db
      .from('recording_offloads')
      .update({ status: 'failed', error: message, size_bytes: size, updated_at: new Date().toISOString() })
      .eq('target_kind', target.kind)
      .eq('target_id', target.id)
    const { data: owner } = await db.from(table).select('recording_path, title').eq('id', target.id).maybeSingle()
    await db.from(table).update({ recording_status: owner?.recording_path ? 'available' : 'none' }).eq('id', target.id)
    await alertAdmins(target, (owner as { title?: string } | null)?.title ?? null, message)
    return false
  }
}

async function alertAdmins(target: RecordingTarget, title: string | null, message: string): Promise<void> {
  const name = title ? `"${title}"` : target.kind === 'session' ? 'a session' : 'a lesson'
  const body = `A recording for ${name} could not be saved. ${message} JaaS keeps the file for 24 hours, so retry from the lesson today.`
  try {
    await notifyCommunityAdmins({
      type: 'recording',
      body,
      referenceType: target.kind === 'training' ? 'training_item' : 'session',
      referenceId: target.id,
      email: { subject: 'A recording could not be saved', html: `<p>${escapeForEmail(body)}</p>`, text: body },
    })
  } catch (err) {
    console.error('[recording] could not alert admins:', err)
  }
}

function escapeForEmail(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Current limit on one file in the recordings bucket, or null if unknown. */
export async function recordingFileLimitBytes(db: SupabaseClient = supabaseServer()): Promise<number | null> {
  const { data, error } = await db.storage.getBucket(RESOURCES_BUCKET)
  if (error) return null
  return typeof data?.file_size_limit === 'number' ? data.file_size_limit : null
}
