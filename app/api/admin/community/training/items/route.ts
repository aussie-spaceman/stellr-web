import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { RESOURCES_BUCKET } from '@/lib/community'
import { claimUpload } from '@/lib/uploads'
import { watermarkIfPdf } from '@/lib/resource-finalise'
import { enqueueVideoWatermark } from '@/lib/watermark/video-queue'
import { isInteractiveKey } from '@/lib/interactive-lessons-meta'
import { isStellrAdmin } from '@/lib/authz'
import { withAudit } from '@/lib/audit/route'

// What this request acted on, which withAudit's spec cannot read for itself: the body has gone.
const auditedId = new WeakMap<Request, string>()
const auditedOp = new WeakMap<Request, string>()

// Claiming a stored upload re-reads and may rewrite it (watermark).
export const maxDuration = 60

// Admin: add a lesson item to a module (FR-COM-10).
// JSON only. Video and document media is uploaded straight to storage via
// /api/uploads/sign and referenced here by storagePath; a Google Doc / external
// URL is linked instead. (This route used to take multipart with
// maxRequestBodySize = '500mb', which promised something it could not deliver:
// Vercel rejects any request body over 4.5MB before the function runs, so a
// real video upload never had a chance of arriving.)
//   fields: moduleId, title, contentKind, estimatedMinutes?, displayOrder?
//           sectionId?  (group the lesson under a section)
//           status?     ('draft' | 'published', default published)
//           body?       (lesson notes shown beneath the featured media)
//           storagePath (required for video, optional for document — from /api/uploads/sign;
//                        a document lesson can be made of attached resources alone)
//           externalUrl (required for google_doc|link — also accepts YouTube/Vimeo embeds)
//           interactiveKey (for interactive — a key registered in lib/interactive-lessons-meta.ts)
// PATCH (JSON) updates an existing lesson: { id, title?, body?, status?, sectionId?, displayOrder? }
// DELETE (?id=) removes a lesson.

export const POST = withAudit(
  ({ args: [req] }) => ({
    action: 'training.item.create',
    actor: { session: true },
    tenant: { stellr: true },
    target: { table: 'training_items', id: auditedId.get(req) ?? null },
  }),
  createItem,
)

async function createItem(req: Request) {
  if (!(await isStellrAdmin({ route: '/api/admin/community/training/items' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // JSON only. Lesson media (a document, or a VIDEO) is uploaded straight to
  // storage via /api/uploads/sign and arrives here as a path: the platform caps
  // a request body at 4.5MB before the function runs, so this route could never
  // actually have accepted a real video.
  const form = (await req.json().catch(() => ({}))) as Record<string, string | undefined>
  const moduleId = form.moduleId ?? null
  const title = form.title?.trim()
  const contentKind = form.contentKind ?? null
  const externalUrl = form.externalUrl?.trim() || null
  const interactiveKey = form.interactiveKey?.trim() || null
  const estimatedMinutes = parseInt(form.estimatedMinutes ?? '', 10)
  const displayOrder = parseInt(form.displayOrder ?? '0', 10)
  const sectionId = form.sectionId?.trim() || null
  const status = form.status === 'draft' ? 'draft' : 'published'
  const body = form.body?.trim() || null
  const uploadPath = form.storagePath?.trim() || null
  const uploadType = form.fileType ?? ''

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
  if (contentKind === 'video' && !uploadPath) {
    return NextResponse.json({ error: 'file required for video' }, { status: 400 })
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

  if (needsFile && uploadPath) {
    const claimed = await claimUpload({ purpose: 'training-item', storagePath: uploadPath })
    if ('error' in claimed) return NextResponse.json({ error: claimed.error }, { status: claimed.status })
    storagePath = uploadPath
    // PDF documents are watermarked inline; videos are queued for the ffmpeg
    // worker (can't run in this serverless route).
    if (contentKind === 'document') {
      const stamped = await watermarkIfPdf(claimed.bucket, storagePath, claimed.bytes, uploadType)
      if ('error' in stamped) return NextResponse.json({ error: stamped.error }, { status: stamped.status })
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
  auditedId.set(req, data.id)
  return NextResponse.json({ id: data.id })
}

export const PATCH = withAudit(
  ({ args: [req] }) => ({
    action: 'training.item.update',
    actor: { session: true },
    tenant: { stellr: true },
    target: { table: 'training_items', id: auditedId.get(req) ?? null },
    metadata: { op: auditedOp.get(req) ?? null },
  }),
  updateItem,
)

// PATCH — update a lesson. Accepts JSON (rename, publish, move, reorder, change
// content type/URL) OR multipart/form-data (when replacing the file for a
// video/document/resource lesson). Changing content type re-points the media:
// switching to a file kind requires a file; to a URL kind requires externalUrl;
// to 'interactive' requires a registered interactiveKey; to 'live' clears both
// (the room is derived from the item id).
async function updateItem(req: Request) {
  if (!(await isStellrAdmin({ route: '/api/admin/community/training/items' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = supabaseServer()

  const fields = (await req.json().catch(() => ({}))) as Record<string, unknown>

  // Drag-and-drop: { moduleId, reorder: [{ id, sectionId, displayOrder }] }.
  if (Array.isArray(fields.reorder)) auditedOp.set(req, 'reorder')
  if (Array.isArray(fields.reorder)) return applyReorder(db, fields.moduleId, fields.reorder)

  const id = fields.id as string | undefined
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  auditedId.set(req, id)

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
      const uploadPath = (fields.storagePath as string | undefined)?.trim() || null
      if (uploadPath) {
        const claimed = await claimUpload({ purpose: 'training-item', storagePath: uploadPath })
        if ('error' in claimed) return NextResponse.json({ error: claimed.error }, { status: claimed.status })
        if (contentKind === 'document') {
          const stamped = await watermarkIfPdf(claimed.bucket, uploadPath, claimed.bytes, (fields.fileType as string) ?? '')
          if ('error' in stamped) return NextResponse.json({ error: stamped.error }, { status: stamped.status })
        }
        patch.storage_path = uploadPath
        patch.external_url = null
        if (contentKind === 'video') await enqueueVideoWatermark(db, RESOURCES_BUCKET, uploadPath, 'training')
      }
      // no file provided → keep existing storage_path (metadata-only edit)
      else if (contentKind === 'document') {
        // A Resource lesson needs a file of its own or an attached resource.
        const [{ data: row }, { count }] = await Promise.all([
          db.from('training_items').select('storage_path').eq('id', id).maybeSingle(),
          db.from('training_item_resources').select('id', { count: 'exact', head: true }).eq('item_id', id),
        ])
        if (!row?.storage_path && !count) {
          return NextResponse.json({ error: 'Upload a file or attach a resource first.' }, { status: 400 })
        }
        patch.external_url = null
      }
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

// Move lessons within a course. Every placement is checked against the course
// before any is written, so a bad request cannot half-apply.
async function applyReorder(db: ReturnType<typeof supabaseServer>, moduleId: unknown, reorder: unknown[]) {
  if (typeof moduleId !== 'string' || !moduleId) return NextResponse.json({ error: 'moduleId required' }, { status: 400 })
  const moves = reorder as { id?: unknown; sectionId?: unknown; displayOrder?: unknown }[]
  const valid = moves.every(
    (m) =>
      typeof m?.id === 'string' &&
      (m.sectionId === null || typeof m.sectionId === 'string') &&
      Number.isInteger(m.displayOrder) &&
      (m.displayOrder as number) >= 0,
  )
  if (!valid) return NextResponse.json({ error: 'Invalid reorder' }, { status: 400 })
  if (moves.length === 0) return NextResponse.json({ ok: true })

  const [{ data: items }, { data: sections }] = await Promise.all([
    db.from('training_items').select('id').eq('module_id', moduleId).in('id', moves.map((m) => m.id as string)),
    db.from('training_sections').select('id').eq('module_id', moduleId),
  ])
  const itemIds = new Set((items ?? []).map((i) => i.id as string))
  const sectionIds = new Set((sections ?? []).map((s) => s.id as string))
  if (moves.some((m) => !itemIds.has(m.id as string) || (m.sectionId !== null && !sectionIds.has(m.sectionId as string)))) {
    return NextResponse.json({ error: 'A lesson or section is not part of this course' }, { status: 400 })
  }

  const results = await Promise.all(
    moves.map((m) =>
      db.from('training_items').update({ section_id: m.sectionId, display_order: m.displayOrder }).eq('id', m.id as string).eq('module_id', moduleId),
    ),
  )
  const failed = results.find((r) => r.error)
  if (failed) {
    console.error('[training] lesson reorder error:', failed.error)
    return NextResponse.json({ error: 'Could not save the new lesson order' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export const DELETE = withAudit(
  ({ args: [req] }) => ({
    action: 'training.item.delete',
    actor: { session: true },
    tenant: { stellr: true },
    target: { table: 'training_items', id: auditedId.get(req) ?? null },
  }),
  deleteItem,
)

// DELETE — remove a lesson. Query: ?id=
async function deleteItem(req: Request) {
  if (!(await isStellrAdmin({ route: '/api/admin/community/training/items' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  auditedId.set(req, id)

  const db = supabaseServer()
  const { error } = await db.from('training_items').delete().eq('id', id)
  if (error) {
    console.error('[training] item delete error:', error)
    return NextResponse.json({ error: 'Could not delete lesson' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
