import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { RESOURCES_BUCKET } from '@/lib/community'

// Admin: add a lesson item to a module (FR-COM-10).
// Accepts multipart/form-data so admins can upload/record a video or document,
// or link a Google Doc / external URL.
//   fields: moduleId, title, contentKind, estimatedMinutes?, displayOrder?
//           file        (required for video|document)
//           externalUrl (required for google_doc|link)

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
    })
    .select('id')
    .single()

  if (error) {
    console.error('[training] item insert error:', error)
    return NextResponse.json({ error: 'Could not add item' }, { status: 500 })
  }
  return NextResponse.json({ id: data.id })
}
