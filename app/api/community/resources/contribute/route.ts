import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { searchAttachableResources } from '@/lib/mentoring'
import {
  attachBinary,
  createFileBinary,
  createLinkBinary,
  findAccessibleDuplicate,
  memberManagesContainer,
  normaliseUrl,
  sha256Hex,
} from '@/lib/resource-upload'

// Resources Catalogue — contribution endpoint (handover §4.5). A manager of a
// container adds a file or link; on a dedup match the member can already reach we
// soft-warn (return { duplicate }) and never store the bytes/link twice. Attach
// is always by reference. Gated on container management (object_roles / mentor).

// GET ?containerId&q — search the library to attach by reference.
export async function GET(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const containerId = searchParams.get('containerId') ?? ''
  if (!containerId || !(await memberManagesContainer(member, containerId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const results = await searchAttachableResources(searchParams.get('q') ?? '')
  return NextResponse.json({ results })
}

export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const contentType = req.headers.get('content-type') ?? ''

  // ── File upload (multipart) ────────────────────────────────────────────────
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const containerId = (form.get('containerId') as string | null) ?? ''
    const file = form.get('file') as File | null
    const displayName = ((form.get('displayName') as string | null) ?? '').trim()

    if (!containerId || !file) return NextResponse.json({ error: 'containerId and file required' }, { status: 400 })
    if (!(await memberManagesContainer(member, containerId))) {
      return NextResponse.json({ error: 'You do not manage this object.' }, { status: 403 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const contentHash = sha256Hex(buffer)

    const dup = await findAccessibleDuplicate(member, { contentHash })
    if (dup) return NextResponse.json({ duplicate: dup })

    const created = await createFileBinary({
      file,
      buffer,
      title: displayName || file.name,
      contentHash,
      uploadedBy: member.id,
    })
    if ('error' in created) return NextResponse.json({ error: created.error }, { status: 500 })
    await attachBinary(containerId, created.binaryId, null)
    return NextResponse.json({ ok: true, binaryId: created.binaryId })
  }

  // ── Link / attach-existing / detach (JSON) ─────────────────────────────────
  const b = (await req.json().catch(() => ({}))) as {
    containerId?: string
    action?: string
    url?: string
    binaryId?: string
    displayName?: string
    minMembership?: number | null
  }
  const containerId = b.containerId ?? ''
  if (!containerId || !(await memberManagesContainer(member, containerId))) {
    return NextResponse.json({ error: 'You do not manage this object.' }, { status: 403 })
  }
  const displayName = (b.displayName ?? '').trim()

  switch (b.action) {
    case 'addLink': {
      const url = (b.url ?? '').trim()
      const normalised = normaliseUrl(url)
      if (!normalised) return NextResponse.json({ error: 'Enter a valid URL' }, { status: 400 })

      const dup = await findAccessibleDuplicate(member, { normalisedUrl: normalised })
      if (dup) return NextResponse.json({ duplicate: dup })

      const created = await createLinkBinary({
        url,
        normalisedUrl: normalised,
        title: displayName || url,
        uploadedBy: member.id,
      })
      if ('error' in created) return NextResponse.json({ error: created.error }, { status: 500 })
      await attachBinary(containerId, created.binaryId, null)
      return NextResponse.json({ ok: true, binaryId: created.binaryId })
    }

    case 'attachExisting': {
      if (!b.binaryId) return NextResponse.json({ error: 'binaryId required' }, { status: 400 })
      await attachBinary(containerId, b.binaryId, displayName || null)
      return NextResponse.json({ ok: true, binaryId: b.binaryId })
    }

    case 'detach': {
      if (!b.binaryId) return NextResponse.json({ error: 'binaryId required' }, { status: 400 })
      const db = supabaseServer()
      await db
        .from('container_contents')
        .delete()
        .eq('container_id', containerId)
        .eq('content_type', 'resource')
        .eq('content_ref', b.binaryId)
      return NextResponse.json({ ok: true })
    }

    case 'setAccess': {
      // Per-attachment membership floor (decision 6b — the re-homed green-circle).
      // null/0 = open to everyone on the roster; 1 = paid members only.
      if (!b.binaryId) return NextResponse.json({ error: 'binaryId required' }, { status: 400 })
      const floor = Number(b.minMembership) > 0 ? Math.floor(Number(b.minMembership)) : null
      const db = supabaseServer()
      const { error } = await db
        .from('container_contents')
        .update({ min_membership: floor })
        .eq('container_id', containerId)
        .in('content_type', ['resource', 'recording'])
        .eq('content_ref', b.binaryId)
      if (error) return NextResponse.json({ error: 'Could not update access' }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
