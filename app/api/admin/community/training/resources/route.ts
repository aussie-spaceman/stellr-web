import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { RESOURCES_BUCKET } from '@/lib/community'
import { claimUpload } from '@/lib/uploads'
import { watermarkIfPdf } from '@/lib/resource-finalise'

// Claiming a stored upload re-reads and may rewrite it (watermark).
export const maxDuration = 60

// Admin CRUD for per-lesson attached resources (files / links) shown beneath a
// lesson's primary content in the member Course detail.

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

// POST — add a resource. Multipart (kind=file) or JSON (kind=link | existing).
//   file:     { itemId, kind:'file', title, file }
//   link:     { itemId, kind:'link', title, externalUrl }
//   existing: { itemId, kind:'existing', resourceId, title? }  ← reference a
//             Global Resources Catalogue binary without re-uploading it.
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = supabaseServer()
  // JSON only. An uploaded file arrives as a storagePath from /api/uploads/sign;
  // the bytes never pass through here, because the platform caps a request body
  // at 4.5MB before this function runs.
  const b = await req.json().catch(() => ({}))
  const itemId: string | null = b.itemId ?? null
  const kind: string | null = b.kind ?? 'link'
  const title: string | null = (b.title as string | undefined)?.trim() ?? null
  const externalUrl: string | null = (b.externalUrl as string | undefined)?.trim() ?? null
  const resourceId: string | null = (b.resourceId as string | undefined) ?? null
  const uploadPath: string | null = (b.storagePath as string | undefined)?.trim() ?? null
  const uploadType: string = (b.fileType as string | undefined) ?? ''

  // Attach an existing catalogue resource by reference — reuse its stored binary
  // rather than re-uploading. Deleting the lesson resource only drops this
  // reference row, never the shared binary.
  if (kind === 'existing') {
    if (!itemId || !resourceId) return NextResponse.json({ error: 'itemId and resourceId required' }, { status: 400 })
    const { data: src } = await db
      .from('community_resources')
      .select('title, storage_path')
      .eq('id', resourceId)
      .maybeSingle()
    if (!src?.storage_path) return NextResponse.json({ error: 'Resource not found' }, { status: 404 })
    const { count: existingCount } = await db
      .from('training_item_resources')
      .select('id', { count: 'exact', head: true })
      .eq('item_id', itemId)
    const { data, error } = await db
      .from('training_item_resources')
      .insert({
        item_id: itemId,
        kind: 'file',
        title: title || (src.title as string),
        storage_path: src.storage_path as string,
        external_url: null,
        display_order: existingCount ?? 0,
      })
      .select('id')
      .single()
    if (error) {
      console.error('[training] existing-resource attach error:', error)
      return NextResponse.json({ error: 'Could not attach resource' }, { status: 500 })
    }
    return NextResponse.json({ id: data.id })
  }

  if (!itemId || !title) return NextResponse.json({ error: 'itemId and title required' }, { status: 400 })

  const { count } = await db.from('training_item_resources').select('id', { count: 'exact', head: true }).eq('item_id', itemId)
  let storagePath: string | null = null

  if (kind === 'file') {
    if (!uploadPath) return NextResponse.json({ error: 'storagePath required' }, { status: 400 })
    const claimed = await claimUpload({ purpose: 'training-item-resource', storagePath: uploadPath })
    if ('error' in claimed) return NextResponse.json({ error: claimed.error }, { status: claimed.status })
    // Copyright watermark on the bottom-right of every page of uploaded PDFs.
    await watermarkIfPdf(claimed.bucket, uploadPath, claimed.bytes, uploadType)
    storagePath = uploadPath
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
