import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { communityWriteBlock, getCurrentMember } from '@/lib/community'
import { searchAttachableResources } from '@/lib/mentoring'
import {
  attachBinary,
  createLinkBinary,
  findAccessibleDuplicate,
  memberManagesContainer,
  normaliseUrl,
  sha256Hex,
} from '@/lib/resource-upload'
import { assertNotImpersonating } from '@/lib/impersonation'
import { claimUpload, contributionPrefix, discardUpload } from '@/lib/uploads'
import { finaliseStoredUpload } from '@/lib/resource-finalise'

// Claiming a stored upload re-reads and may rewrite it (watermark).
export const maxDuration = 60

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
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // Decision 24: age and guardian-consent restrictions (lib/community).
  const restricted = await communityWriteBlock(member, 'contribute')
  if (restricted) return restricted

  // ── File upload (already in storage) ──────────────────────────────────────
  // The bytes went browser → storage via /api/uploads/sign; only the path
  // arrives here. Dedup hashes the STORED object, not what the browser claimed.
  const body = (await req.json().catch(() => ({}))) as {
    containerId?: string
    action?: string
    url?: string
    binaryId?: string
    displayName?: string
    minMembership?: number | null
    storagePath?: string
    fileName?: string
    fileType?: string
  }

  if (body.storagePath) {
    const containerId = body.containerId ?? ''
    if (!containerId) return NextResponse.json({ error: 'containerId required' }, { status: 400 })
    if (!(await memberManagesContainer(member, containerId))) {
      return NextResponse.json({ error: 'You do not manage this object.' }, { status: 403 })
    }

    // deep review MEM-13: a container-contribution object is issued under this
    // member's own folder (lib/uploads contributionPrefix). Pin the claim to it
    // so a manager cannot post back a path in another namespace (a training
    // video, the admin catalogue's resources/<time>-<name>) and have this route
    // adopt it — or delete it, by a refused claim or as a "duplicate".
    const CONTRIBUTION_PREFIX = contributionPrefix(member.id)
    const claimed = await claimUpload({
      purpose: 'container-contribution',
      storagePath: body.storagePath,
      expectedPrefix: CONTRIBUTION_PREFIX,
    })
    if ('error' in claimed) {
      return NextResponse.json({ error: claimed.error }, { status: claimed.status })
    }

    const contentHash = sha256Hex(Buffer.from(claimed.bytes))
    const dup = await findAccessibleDuplicate(member, { contentHash })
    if (dup) {
      // Nothing is recorded, so the object would be orphaned — drop it.
      await discardUpload(claimed.bucket, body.storagePath)
      return NextResponse.json({ duplicate: dup })
    }

    const displayName = (body.displayName ?? '').trim()
    const fileType = body.fileType || null
    // Finalising watermarks a PDF (the old multipart path stored member
    // contributions unstamped) and records it. It takes the claim made above,
    // pinned to the member's folder, rather than downloading, sniffing and
    // stamping the same object a second time.
    const created = await finaliseStoredUpload({
      purpose: 'container-contribution',
      storagePath: body.storagePath,
      title: displayName || body.fileName || 'Untitled',
      fileType,
      uploadedBy: member.id,
      contentHash,
      expectedPrefix: CONTRIBUTION_PREFIX,
      claimed,
    })
    if ('error' in created) {
      return NextResponse.json({ error: created.error }, { status: created.status })
    }
    await attachBinary(containerId, created.id, null)
    return NextResponse.json({ ok: true, binaryId: created.id })
  }

  // ── Link / attach-existing / detach (JSON) ─────────────────────────────────
  const b = body
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
