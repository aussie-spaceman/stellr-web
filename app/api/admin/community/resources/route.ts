import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getSignedInMember, RESOURCES_BUCKET } from '@/lib/community'
import { attachSpaceResource } from '@/lib/container-sync'
import { createLinkBinary, normaliseUrl } from '@/lib/resource-upload'
import { finaliseStoredUpload } from '@/lib/resource-finalise'

// The watermark pass re-reads and rewrites the stored object, so give it more
// room than the default for a 25MB PDF.
export const maxDuration = 60

// POST /api/admin/community/resources — create a resource record (JSON only).
// Either a link ({ url, title, … }) or an already-uploaded file
// ({ storagePath, fileType, title, … }) whose bytes the browser sent straight to
// storage via /api/uploads/sign. File bodies are no longer accepted: the
// platform caps a request body at 4.5MB before the function runs, so posting
// bytes here silently capped every upload.
export async function POST(req: Request) {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const uploader = await getSignedInMember()

  // Link resources arrive as JSON; file uploads as multipart form-data.
  if (req.headers.get('content-type')?.includes('application/json')) {
    const b = await req.json().catch(() => ({}))
    const title = (typeof b.title === 'string' ? b.title : '').trim()
    const rawUrl = (typeof b.url === 'string' ? b.url : '').trim()
    const description = (typeof b.description === 'string' ? b.description : '').trim() || null
    const spaceId = (typeof b.spaceId === 'string' && b.spaceId) || null

    // Direct-to-storage upload: the bytes are already in the bucket (the browser
    // sent them via a signed URL, which is the only way past the platform's
    // 4.5MB request-body limit), so only the metadata arrives here.
    if (typeof b.storagePath === 'string' && b.storagePath) {
      if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 })
      const done = await finaliseStoredUpload({
        purpose: spaceId ? 'space-resource' : 'admin-resource',
        storagePath: b.storagePath,
        title,
        description,
        spaceId,
        fileType: typeof b.fileType === 'string' ? b.fileType : null,
        uploadedBy: uploader?.id ?? null,
      })
      if ('error' in done) return NextResponse.json({ error: done.error }, { status: done.status })
      const db = supabaseServer()
      if (spaceId) await attachSpaceResource(db, spaceId, done.id)
      return NextResponse.json({ id: done.id })
    }

    if (!rawUrl || !title) {
      return NextResponse.json({ error: 'url and title are required' }, { status: 400 })
    }
    const normalised = normaliseUrl(rawUrl)
    if (!normalised) return NextResponse.json({ error: 'That URL is not valid' }, { status: 400 })

    const created = await createLinkBinary({
      url: rawUrl,
      normalisedUrl: normalised,
      title,
      description,
      uploadedBy: uploader?.id ?? '',
    })
    if ('error' in created) return NextResponse.json({ error: created.error }, { status: 500 })

    const db = supabaseServer()
    if (spaceId) await attachSpaceResource(db, spaceId, created.binaryId)
    return NextResponse.json({ id: created.binaryId })
  }

  return NextResponse.json(
    { error: 'Send storagePath from a signed upload instead of a file body.' },
    { status: 415 },
  )
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
