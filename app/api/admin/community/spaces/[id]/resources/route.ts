import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { attachSpaceResource } from '@/lib/container-sync'
import { createLinkBinary, normaliseUrl } from '@/lib/resource-upload'
import { attachAllowed } from '@/lib/access-objects'
import { finaliseStoredUpload } from '@/lib/resource-finalise'

// The watermark pass re-reads and rewrites the stored object, so give it more
// room than the default for a 25MB PDF.
export const maxDuration = 60

// Short, colour-coded file-type label for the Resources list / attachment chip.
function fileLabel(name: string, mime: string): string {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  if (mime.startsWith('image/')) return 'IMG'
  if (ext === 'pdf' || mime === 'application/pdf') return 'PDF'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'XLS'
  if (['doc', 'docx'].includes(ext)) return 'DOC'
  if (['ppt', 'pptx'].includes(ext)) return 'PPT'
  if (['dwg', 'dxf', 'step', 'stp', 'stl', 'f3d'].includes(ext)) return 'CAD'
  if (['zip', 'rar', '7z'].includes(ext)) return 'ZIP'
  return (ext || 'file').toUpperCase().slice(0, 4)
}

// POST /api/admin/community/spaces/[id]/resources — admin adds a resource into a
// space's Resources (Assign resource modal, screen 20). JSON only: either a link
// ({ url, title? }) or an already-uploaded file ({ storagePath, fileName,
// fileType }) whose bytes went straight to storage via /api/uploads/sign.

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId, sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id: spaceId } = await params

  // Relationship-matrix gate (object_type_relations) — closed by default.
  if (!(await attachAllowed('space', 'resource'))) {
    return NextResponse.json(
      { error: 'A resource cannot be attached to a space (relationship matrix).' },
      { status: 403 },
    )
  }

  const db0 = supabaseServer()
  let adminId: string | null = null
  if (userId) {
    const { data } = await db0.from('members').select('id').eq('clerk_user_id', userId).maybeSingle()
    adminId = (data as { id: string } | null)?.id ?? null
  }

  // Link resource — JSON body, no storage object.
  if (req.headers.get('content-type')?.includes('application/json')) {
    const b = await req.json().catch(() => ({}))
    const rawUrl = (typeof b.url === 'string' ? b.url : '').trim()

    // Direct-to-storage upload — the bytes are already in the bucket, sent by
    // the browser via a signed URL, so only the metadata comes through here.
    if (typeof b.storagePath === 'string' && b.storagePath) {
      const fileName = (typeof b.fileName === 'string' ? b.fileName : '').trim()
      const done = await finaliseStoredUpload({
        purpose: 'space-resource',
        storagePath: b.storagePath,
        title: (typeof b.title === 'string' ? b.title : '').trim() || fileName,
        spaceId,
        fileType: fileLabel(fileName, typeof b.fileType === 'string' ? b.fileType : ''),
        uploadedBy: adminId,
        fromChat: false,
      })
      if ('error' in done) return NextResponse.json({ error: done.error }, { status: done.status })
      await attachSpaceResource(db0, spaceId, done.id)
      return NextResponse.json({ id: done.id })
    }

    const title = (typeof b.title === 'string' ? b.title : '').trim() || rawUrl
    if (!rawUrl) return NextResponse.json({ error: 'url required' }, { status: 400 })
    const normalised = normaliseUrl(rawUrl)
    if (!normalised) return NextResponse.json({ error: 'That URL is not valid' }, { status: 400 })

    const created = await createLinkBinary({
      url: rawUrl,
      normalisedUrl: normalised,
      title,
      uploadedBy: adminId ?? '',
    })
    if ('error' in created) return NextResponse.json({ error: created.error }, { status: 500 })
    await attachSpaceResource(db0, spaceId, created.binaryId)
    return NextResponse.json({ id: created.binaryId })
  }

  return NextResponse.json(
    { error: 'Send storagePath from a signed upload instead of a file body.' },
    { status: 415 },
  )
}
