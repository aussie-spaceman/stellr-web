import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { RESOURCES_BUCKET } from '@/lib/community'
import { isPdf, stampPdfBytes } from '@/lib/watermark/pdf'
import { enqueueVideoWatermark } from '@/lib/watermark/video-queue'
import { isInteractiveKey } from '@/lib/interactive-lessons-meta'

// Video files can be large — override the default 4 MB Next.js body limit.
export const maxRequestBodySize = '500mb'

// Admin: add a lesson item to a module (FR-COM-10).
// Accepts multipart/form-data so admins can upload/record a video or document,
// or link a Google Doc / external URL.
//   fields: moduleId, title, contentKind, estimatedMinutes?, displayOrder?
//           sectionId?  (group the lesson under a section)
//           status?     ('draft' | 'published', default published)
//           body?       (lesson notes shown beneath the featured media)
//           file        (required for video|document)
//           externalUrl (required for google_doc|link — also accepts YouTube/Vimeo embeds)
//           interactiveKey (for interactive — a key registered in lib/interactive-lessons-meta.ts)
// PATCH (JSON) updates an existing lesson: { id, title?, body?, status?, sectionId?, displayOrder? }
// DELETE (?id=) removes a lesson.

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const form = await req.formData()
  const moduleId = form.get('moduleId') as string | null
  const title = (form.get('title') as string | null)?.trim()
  const contentKind = form.get('contentKind') as string | null
  const externalUrl = (form.get('externalUrl') as string | null)?.trim() || null
  const interactiveKey = (form.get('interactiveKey') as string | null)?.trim() || null
  const estimatedMinutes = parseInt((form.get('estimatedMinutes') as string) ?? '', 10)
  const displayOrder = parseInt((form.get('displayOrder') as string) ?? '0', 10)
  const sectionId = (form.get('sectionId') as string | null)?.trim() || null
  const status = (form.get('status') as string | null) === 'draft' ? 'draft' : 'published'
  const body = (form.get('body') as string | null)?.trim() || null
  const file = form.get('file') as File | null

  if (!moduleId || !title || !contentKind) {
    return NextResponse.json({ error: 'moduleId, title, contentKind required' }, { status: 400 })
  }

  const ALLOWED_KINDS = ['video', 'document', 'google_doc', 'link', 'live', 'interactive']
  if (!ALLOWED_KINDS.includes(contentKind)) {
    return NextResponse.json({ error: 'Invalid contentKind' }, { status: 400 })
  }

  // 'live' lessons are an embedded JaaS room — no file or URL; the room name is
  // derived from the item id at view time (see lib/video-provider trainingRoomName).
  const needsFile = contentKind === 'video' || contentKind === 'document'
  const needsUrl = contentKind === 'google_doc' || contentKind === 'link'
  if (needsFile && !file) {
    return NextResponse.json({ error: 'file required for video/document' }, { status: 400 })
  }
  if (needsUrl && !externalUrl) {
    return NextResponse.json({ error: 'externalUrl required for google_doc/link' }, { status: 400 })
  }
  // 'interactive' lessons render a code-registered component. A missing key is
  // tolerated (the player shows 'unavailable' until one is set), but a key that
  // isn't in the registry is rejected — lessons can't point at nonexistent code.
  if (contentKind === 'interactive' && interactiveKey && !isInteractiveKey(interactiveKey)) {
    return NextResponse.json({ error: 'Unknown interactiveKey' }, { status: 400 })
  }

  const db = supabaseServer()
  let storagePath: string | null = null

  if (needsFile && file) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    storagePath = `training/${Date.now()}-${safeName}`
    // PDF documents are watermarked inline; videos are queued for the ffmpeg
    // worker (can't run in this serverless route).
    let payload: File | Uint8Array = file
    if (contentKind === 'document' && isPdf(file.name, file.type)) {
      try {
        payload = new Uint8Array(await stampPdfBytes(new Uint8Array(await file.arrayBuffer())))
      } catch (err) {
        console.error('[training] item pdf watermark failed, storing original:', err)
      }
    }
    const { error: uploadError } = await db.storage
      .from(RESOURCES_BUCKET)
      .upload(storagePath, payload, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })
    if (uploadError) {
      console.error('[training] item upload error:', uploadError)
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }
    if (contentKind === 'video') await enqueueVideoWatermark(db, RESOURCES_BUCKET, storagePath, 'training')
  }

  const { data, error } = await db
    .from('training_items')
    .insert({
      module_id: moduleId,
      title,
      content_kind: contentKind,
      storage_path: storagePath,
      external_url: needsFile || contentKind === 'interactive' ? null : externalUrl,
      interactive_key: contentKind === 'interactive' ? interactiveKey : null,
      estimated_minutes: Number.isFinite(estimatedMinutes) ? estimatedMinutes : null,
      display_order: Number.isFinite(displayOrder) ? displayOrder : 0,
      section_id: sectionId,
      status,
      body,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[training] item insert error:', error)
    return NextResponse.json({ error: 'Could not add item' }, { status: 500 })
  }
  return NextResponse.json({ id: data.id })
}

// PATCH — update a lesson. Accepts JSON (rename, publish, move, reorder, change
// content type/URL) OR multipart/form-data (when replacing the file for a
// video/document/resource lesson). Changing content type re-points the media:
// switching to a file kind requires a file; to a URL kind requires externalUrl;
// to 'interactive' requires a registered interactiveKey; to 'live' clears both
// (the room is derived from the item id).
export async function PATCH(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = supabaseServer()

  const isMultipart = (req.headers.get('content-type') ?? '').includes('multipart/form-data')
  let fields: Record<string, unknown> = {}
  let file: File | null = null
  if (isMultipart) {
    const form = await req.formData()
    file = form.get('file') as File | null
    fields = Object.fromEntries([...form.entries()].filter(([k]) => k !== 'file'))
  } else {
    fields = await req.json().catch(() => ({}))
  }

  const id = fields.id as string | undefined
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (typeof fields.title === 'string') patch.title = fields.title.trim()
  if (typeof fields.body === 'string') patch.body = fields.body.trim() || null
  if (fields.status === 'draft' || fields.status === 'published') patch.status = fields.status
  if ('sectionId' in fields) patch.section_id = fields.sectionId || null
  if (fields.displayOrder != null && !Number.isNaN(Number(fields.displayOrder))) patch.display_order = Number(fields.displayOrder)
  if (fields.estimatedMinutes != null && fields.estimatedMinutes !== '' && !Number.isNaN(Number(fields.estimatedMinutes))) {
    patch.estimated_minutes = Number(fields.estimatedMinutes)
  }

  // Content type / media change.
  const contentKind = fields.contentKind as string | undefined
  if (contentKind) {
    const ALLOWED = ['video', 'document', 'google_doc', 'link', 'live', 'interactive']
    if (!ALLOWED.includes(contentKind)) return NextResponse.json({ error: 'Invalid contentKind' }, { status: 400 })
    patch.content_kind = contentKind
    const externalUrl = (fields.externalUrl as string | undefined)?.trim() || null
    const interactiveKey = (fields.interactiveKey as string | undefined)?.trim() || null
    const needsFile = contentKind === 'video' || contentKind === 'document'
    const needsUrl = contentKind === 'google_doc' || contentKind === 'link'
    // Switching away from 'interactive' clears the key; switching to it sets it below.
    patch.interactive_key = null

    if (needsFile) {
      if (file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const storagePath = `training/${Date.now()}-${safeName}`
        let payload: File | Uint8Array = file
        if (contentKind === 'document' && isPdf(file.name, file.type)) {
          try {
            payload = new Uint8Array(await stampPdfBytes(new Uint8Array(await file.arrayBuffer())))
          } catch (err) {
            console.error('[training] item pdf watermark failed, storing original:', err)
          }
        }
        const { error: upErr } = await db.storage
          .from(RESOURCES_BUCKET)
          .upload(storagePath, payload, { contentType: file.type || 'application/octet-stream', upsert: false })
        if (upErr) {
          console.error('[training] item re-upload error:', upErr)
          return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
        }
        patch.storage_path = storagePath
        patch.external_url = null
        if (contentKind === 'video') await enqueueVideoWatermark(db, RESOURCES_BUCKET, storagePath, 'training')
      }
      // no file provided → keep existing storage_path (metadata-only edit)
    } else if (needsUrl) {
      if (!externalUrl) return NextResponse.json({ error: 'externalUrl required for this content type' }, { status: 400 })
      patch.external_url = externalUrl
      patch.storage_path = null
    } else if (contentKind === 'interactive') {
      // Key must be registered in code (lib/interactive-lessons-meta.ts).
      if (!interactiveKey || !isInteractiveKey(interactiveKey)) {
        return NextResponse.json({ error: 'A registered interactiveKey is required for this content type' }, { status: 400 })
      }
      patch.interactive_key = interactiveKey
      patch.external_url = null
      patch.storage_path = null
    } else {
      // 'live' — room derived from item id; clear media.
      patch.external_url = null
      patch.storage_path = null
    }
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })

  const { error } = await db.from('training_items').update(patch).eq('id', id)
  if (error) {
    console.error('[training] item update error:', error)
    return NextResponse.json({ error: 'Could not update lesson' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

// DELETE — remove a lesson. Query: ?id=
export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = supabaseServer()
  const { error } = await db.from('training_items').delete().eq('id', id)
  if (error) {
    console.error('[training] item delete error:', error)
    return NextResponse.json({ error: 'Could not delete lesson' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
