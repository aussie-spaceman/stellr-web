import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, RESOURCES_BUCKET } from '@/lib/community'
import { attachSpaceResource } from '@/lib/container-sync'

// POST /api/admin/community/resources — upload a file + create a resource record.
// Expects multipart/form-data: file, title, description?, spaceId?, minTierRank?
export async function POST(req: Request) {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const uploader = await getCurrentMember()

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const title = (formData.get('title') as string | null)?.trim()
  const description = (formData.get('description') as string | null)?.trim() || null
  const spaceId = (formData.get('spaceId') as string | null) || null

  if (!file || !title) {
    return NextResponse.json({ error: 'file and title are required' }, { status: 400 })
  }

  const db = supabaseServer()

  // Stream the file into the private bucket. Path: resources/<timestamp>-<safeName>
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `resources/${Date.now()}-${safeName}`

  const { error: uploadError } = await db.storage
    .from(RESOURCES_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })

  if (uploadError) {
    console.error('[community] resource upload error:', uploadError)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  const { data: resource, error: dbError } = await db
    .from('community_resources')
    .insert({
      space_id: spaceId,
      title,
      description,
      storage_path: storagePath,
      file_type: file.type || null,
      file_size_bytes: file.size,
      uploaded_by: uploader?.id ?? null,
    })
    .select('id')
    .single()

  if (dbError) {
    console.error('[community] resource db insert error:', dbError)
    return NextResponse.json({ error: 'Failed to save resource' }, { status: 500 })
  }

  // Space-targeted uploads also surface in the global catalogue.
  if (spaceId) await attachSpaceResource(db, spaceId, resource.id)

  return NextResponse.json({ id: resource.id })
}

// GET /api/admin/community/resources — list all resources for admin UI
export async function GET() {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = supabaseServer()
  const { data } = await db
    .from('community_resources')
    .select('id, title, description, file_type, file_size_bytes, created_at, community_spaces(name)')
    .order('created_at', { ascending: false })

  return NextResponse.json({ resources: data ?? [] })
}

// PATCH /api/admin/community/resources — edit a stored binary.
// Body: { id, title?, spaceId? }. title renames the binary; spaceId re-homes it.
// Per-resource access (min_tier_rank / tier allowlist) was retired with the
// catalogue (decision 6b) — access is inherited from the container.
export async function PATCH(req: Request) {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const b = await req.json().catch(() => ({}))
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = supabaseServer()

  const patch: Record<string, unknown> = {}
  // Binary-level rename (handover §4.6 edit). Changes the stored binary's title;
  // per-attachment display_name overrides still win in each container.
  if (typeof b.title === 'string' && b.title.trim()) patch.title = b.title.trim().slice(0, 200)
  if (b.spaceId !== undefined) patch.space_id = b.spaceId || null

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }
  const { error } = await db.from('community_resources').update(patch).eq('id', b.id)
  if (error) return NextResponse.json({ error: 'Could not update resource' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/community/resources?id=<uuid> — remove a single resource,
// deleting its stored file first so the bucket doesn't accumulate orphans.
export async function DELETE(req: Request) {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = supabaseServer()
  const { data: resource } = await db
    .from('community_resources')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle()

  const storagePath = (resource as { storage_path: string | null } | null)?.storage_path
  if (storagePath) {
    const { error: storageError } = await db.storage.from(RESOURCES_BUCKET).remove([storagePath])
    if (storageError) console.error('[community] resource storage delete error:', storageError)
  }

  // Cascade: remove every container_contents attachment of this binary (content_ref
  // is a text reference, not an FK, so it won't cascade on its own). The delete
  // disappears the resource from every object it was attached to (handover §4.6).
  await db
    .from('container_contents')
    .delete()
    .in('content_type', ['resource', 'recording'])
    .eq('content_ref', id)

  const { error } = await db.from('community_resources').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Could not delete resource' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
