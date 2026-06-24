import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { RESOURCES_BUCKET } from '@/lib/community'

// Admin CRUD for per-lesson attached resources (files / links) shown beneath a
// lesson's primary content in the member Course detail.
export const maxRequestBodySize = '100mb'

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

// GET ?itemId= — list a lesson's resources.
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const itemId = new URL(req.url).searchParams.get('itemId')
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 })
  const db = supabaseServer()
  const { data } = await db
    .from('training_item_resources')
    .select('id, kind, title, external_url, display_order')
    .eq('item_id', itemId)
    .order('display_order', { ascending: true })
  return NextResponse.json({ resources: data ?? [] })
}

// POST — add a resource. Multipart (kind=file) or JSON (kind=link).
//   file: { itemId, kind:'file', title, file }
//   link: { itemId, kind:'link', title, externalUrl }
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = supabaseServer()
  const isMultipart = (req.headers.get('content-type') ?? '').includes('multipart/form-data')

  let itemId: string | null
  let kind: string | null
  let title: string | null
  let externalUrl: string | null = null
  let file: File | null = null

  if (isMultipart) {
    const form = await req.formData()
    itemId = form.get('itemId') as string | null
    kind = (form.get('kind') as string | null) ?? 'file'
    title = (form.get('title') as string | null)?.trim() ?? null
    file = form.get('file') as File | null
  } else {
    const b = await req.json().catch(() => ({}))
    itemId = b.itemId ?? null
    kind = b.kind ?? 'link'
    title = (b.title as string | undefined)?.trim() ?? null
    externalUrl = (b.externalUrl as string | undefined)?.trim() ?? null
  }

  if (!itemId || !title) return NextResponse.json({ error: 'itemId and title required' }, { status: 400 })

  const { count } = await db.from('training_item_resources').select('id', { count: 'exact', head: true }).eq('item_id', itemId)
  let storagePath: string | null = null

  if (kind === 'file') {
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    storagePath = `training/resources/${Date.now()}-${safeName}`
    const { error: upErr } = await db.storage.from(RESOURCES_BUCKET).upload(storagePath, file, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (upErr) {
      console.error('[training] resource upload error:', upErr)
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }
  } else {
    if (!externalUrl) return NextResponse.json({ error: 'externalUrl required for a link' }, { status: 400 })
  }

  const { data, error } = await db
    .from('training_item_resources')
    .insert({ item_id: itemId, kind: kind === 'file' ? 'file' : 'link', title, storage_path: storagePath, external_url: kind === 'file' ? null : externalUrl, display_order: count ?? 0 })
    .select('id')
    .single()
  if (error) {
    console.error('[training] resource insert error:', error)
    return NextResponse.json({ error: 'Could not add resource' }, { status: 500 })
  }
  return NextResponse.json({ id: data.id })
}

// DELETE ?id=
export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = supabaseServer()
  const { error } = await db.from('training_item_resources').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Could not remove resource' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
