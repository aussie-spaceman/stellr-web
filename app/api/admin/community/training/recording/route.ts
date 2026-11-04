import { NextResponse, after } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentUserIsAdmin } from '@/lib/admin-auth'
import { RESOURCES_BUCKET, signedDownloadUrl, VIDEO_SIGNED_URL_TTL_SECONDS } from '@/lib/community'
import { markPhase, recordingFileLimitBytes, runOffload } from '@/lib/recording-offload'
import { recordingView, type OffloadRow } from '@/lib/recording-view'

// A lesson's recording, as the Course builder sees it.
//   GET    ?itemId=   status, reason for any failure, and a playable URL
//   POST   { itemId, action: 'started' | 'ended' | 'retry' }
//   DELETE ?itemId=   remove the saved video, or clear a failed attempt

// A retry copies the file here, after the response.
export const maxDuration = 300

const OFFLOAD_FIELDS = 'status, source_url, source_expires_at, error, size_bytes, updated_at'

async function load(itemId: string) {
  const db = supabaseServer()
  const [{ data: item }, { data: row }] = await Promise.all([
    db.from('training_items').select('recording_path, recording_status').eq('id', itemId).maybeSingle(),
    db.from('recording_offloads').select(OFFLOAD_FIELDS).eq('target_kind', 'training').eq('target_id', itemId).maybeSingle(),
  ])
  if (!item) return null
  return { item, view: recordingView(item, (row as OffloadRow | null) ?? null) }
}

export async function GET(req: Request) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const itemId = new URL(req.url).searchParams.get('itemId')
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 })

  const found = await load(itemId)
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { item, view } = found

  const [url, fileLimitBytes] = await Promise.all([
    view.hasFile ? signedDownloadUrl(item.recording_path as string, VIDEO_SIGNED_URL_TTL_SECONDS) : null,
    recordingFileLimitBytes(),
  ])
  return NextResponse.json({ ...view, url, fileLimitBytes })
}

export async function POST(req: Request) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { itemId, action } = (await req.json().catch(() => ({}))) as { itemId?: string; action?: string }
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 })

  const found = await load(itemId)
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const target = { kind: 'training' as const, id: itemId }

  if (action === 'started') {
    await markPhase(target, 'recording')
  } else if (action === 'ended') {
    await markPhase(target, 'processing')
  } else if (action === 'retry') {
    if (!found.view.canRetry) {
      return NextResponse.json({ error: 'This recording can no longer be retried. Record it again.' }, { status: 409 })
    }
    after(() => runOffload(target).then(() => undefined))
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const itemId = new URL(req.url).searchParams.get('itemId')
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 })

  const found = await load(itemId)
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { phase } = found.view
  // A copy in flight would put the file straight back.
  if (phase === 'saving' || phase === 'recording') {
    return NextResponse.json({ error: 'Wait for this recording to finish before deleting it.' }, { status: 409 })
  }

  const db = supabaseServer()
  const path = found.item.recording_path as string | null
  if (path) {
    // The storage object goes first: if this fails the lesson still points at a
    // real file, rather than losing track of one that still exists.
    const { error } = await db.storage.from(RESOURCES_BUCKET).remove([path])
    if (error) {
      console.error('[training] recording delete error:', error)
      return NextResponse.json({ error: 'Could not delete the recording. Please try again.' }, { status: 500 })
    }
    // A queued watermark job would otherwise fail against the missing file.
    await db.from('video_watermark_jobs').delete().eq('storage_path', path)
  }
  await db.from('recording_offloads').delete().eq('target_kind', 'training').eq('target_id', itemId)
  const { error } = await db.from('training_items').update({ recording_path: null, recording_status: 'none' }).eq('id', itemId)
  if (error) {
    console.error('[training] recording clear error:', error)
    return NextResponse.json({ error: 'Could not delete the recording. Please try again.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
