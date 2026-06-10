import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { RESOURCES_BUCKET } from '@/lib/community'

// Admin: add a lesson item to a module (FR-COM-10).
// Accepts multipart/form-data so admins can upload/record a video or document,
// or link a Google Doc / external URL.
//   fields: moduleId, title, contentKind, estimatedMinutes?, displayOrder?
//           sectionId?  (group the lesson under a section)
//           status?     ('draft' | 'published', default published)
//           body?       (lesson notes shown beneath the featured media)
//           file        (required for video|document)
//           externalUrl (required for google_doc|link — also accepts YouTube/Vimeo embeds)
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
  const estimatedMinutes = parseInt((form.get('estimatedMinutes') as string) ?? '', 10)
  const displayOrder = parseInt((form.get('displayOrder') as string) ?? '0', 10)
  const sectionId = (form.get('sectionId') as string | null)?.trim() || null
  const status = (form.get('status') as string | null) === 'draft' ? 'draft' : 'published'
  const body = (form.get('body') as string | null)?.trim() || null
  const file = form.get('file') as File | null

  if (!moduleId || !title || !contentKind) {
    return NextResponse.json({ error: 'moduleId, title, contentKind required' }, { status: 400 })
  }

  const needsFile = contentKind === 'video' || contentKind === 'document'
  if (needsFile && !file) {
    return NextResponse.json({ error: 'file required for video/document' }, { status: 400 })
  }
  if (!needsFile && !externalUrl) {
    return NextResponse.json({ error: 'externalUrl required for google_doc/link' }, { status: 400 })
  }

  const db = supabaseServer()
  let storagePath: string | null = null

  if (needsFile && file) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    storagePath = `training/${Date.now()}-${safeName}`
    const { error: uploadError } = await db.storage
      .from(RESOURCES_BUCKET)
      .upload(storagePath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })
    if (uploadError) {
      console.error('[training] item upload error:', uploadError)
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }
  }

  const { data, error } = await db
    .from('training_items')
    .insert({
      module_id: moduleId,
      title,
      content_kind: contentKind,
      storage_path: storagePath,
      external_url: needsFile ? null : externalUrl,
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

// PATCH — update a lesson (rename, publish/unpublish, move section, reorder).
export async function PATCH(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const { id } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (typeof body.title === 'string') patch.title = body.title.trim()
  if (typeof body.body === 'string') patch.body = body.body.trim() || null
  if (body.status === 'draft' || body.status === 'published') patch.status = body.status
  if ('sectionId' in body) patch.section_id = body.sectionId || null
  if (typeof body.displayOrder === 'number') patch.display_order = body.displayOrder
  if (typeof body.estimatedMinutes === 'number') patch.estimated_minutes = body.estimatedMinutes
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })

  const db = supabaseServer()
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
