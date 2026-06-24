import { createHash } from 'crypto'
import { supabaseServer } from '@/lib/supabase'
import { RESOURCES_BUCKET, type CommunityMember } from '@/lib/community'

// Resources Catalogue — contribution + dedup (PR2). A manager of a container
// uploads a file or adds a link; we hash / normalise it, look for an existing
// binary they can already reach, and either soft-warn (offer attach-by-reference)
// or create + attach. Attach is ALWAYS by reference — a new container_contents
// row pointing at the binary, never a byte copy (handover §0.3, §5).

/** sha256 hex of a file's bytes — the file dedup key. */
export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

// Tracking params stripped before comparing URLs (handover edge case §7).
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'ref_src', 'igshid',
])

/**
 * Canonicalise a URL for dedup: lowercase scheme + host, drop default ports,
 * strip tracking params (sorted remainder), drop the fragment and a trailing
 * slash. Returns null for an unparseable URL.
 */
export function normaliseUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    u.protocol = u.protocol.toLowerCase()
    u.hostname = u.hostname.toLowerCase()
    u.hash = ''
    if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
      u.port = ''
    }
    const kept = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b))
    u.search = ''
    for (const [k, v] of kept) u.searchParams.append(k, v)
    let out = u.toString()
    // Strip a single trailing slash on the path (but keep "https://host/").
    if (out.endsWith('/') && new URL(out).pathname !== '/') out = out.slice(0, -1)
    return out
  } catch {
    return null
  }
}

/** Container ids the member manages (mentor/coach of, or an object_roles grant). */
export async function managedContainerIds(member: CommunityMember): Promise<Set<string>> {
  const db = supabaseServer()
  const [mentored, granted] = await Promise.all([
    db.from('mentoring_cohorts').select('id').eq('mentor_member_id', member.id),
    db.from('object_roles').select('object_id').eq('member_id', member.id).eq('object_type', 'container'),
  ])
  const ids = new Set<string>()
  for (const r of mentored.data ?? []) ids.add(r.id as string)
  for (const r of granted.data ?? []) ids.add(r.object_id as string)
  return ids
}

/** Whether the member may contribute resources to a specific container. */
export async function memberManagesContainer(member: CommunityMember, containerId: string): Promise<boolean> {
  if (member.isAdmin) return true
  const ids = await managedContainerIds(member)
  return ids.has(containerId)
}

export interface DuplicateMatch {
  binaryId: string
  title: string
  fileType: string | null
}

/**
 * An existing binary the member can already reach that matches this hash / URL,
 * or null. "Can reach" = uploaded by them, attached to a container they manage,
 * or admin. We never surface a binary the contributor couldn't otherwise see.
 */
export async function findAccessibleDuplicate(
  member: CommunityMember,
  key: { contentHash?: string; normalisedUrl?: string },
): Promise<DuplicateMatch | null> {
  const db = supabaseServer()
  let query = db.from('community_resources').select('id, title, file_type, uploaded_by')
  if (key.contentHash) query = query.eq('content_hash', key.contentHash)
  else if (key.normalisedUrl) query = query.eq('normalised_url', key.normalisedUrl)
  else return null

  const { data: candidates } = await query
  if (!candidates || candidates.length === 0) return null

  type Cand = { id: string; title: string; file_type: string | null; uploaded_by: string | null }
  const toMatch = (c: Cand): DuplicateMatch => ({ binaryId: c.id, title: c.title, fileType: c.file_type })

  if (member.isAdmin) return toMatch(candidates[0] as Cand)

  const own = (candidates as Cand[]).find((c) => c.uploaded_by === member.id)
  if (own) return toMatch(own)

  // Attached to a container the member manages?
  const managed = await managedContainerIds(member)
  if (managed.size > 0) {
    const ids = (candidates as Cand[]).map((c) => c.id)
    const { data: links } = await db
      .from('container_contents')
      .select('content_ref, container_id')
      .in('content_ref', ids)
      .in('container_id', [...managed])
    const reachable = new Set((links ?? []).map((l) => l.content_ref as string))
    const hit = (candidates as Cand[]).find((c) => reachable.has(c.id))
    if (hit) return toMatch(hit)
  }
  return null
}

/** Attach an existing binary to a container by reference (idempotent). */
export async function attachBinary(
  containerId: string,
  binaryId: string,
  displayName: string | null,
): Promise<void> {
  const db = supabaseServer()
  await db.from('container_contents').upsert(
    {
      container_id: containerId,
      content_type: 'resource',
      content_ref: binaryId,
      display_name: displayName,
    },
    { onConflict: 'container_id,content_type,content_ref' },
  )
}

/** Create a file binary (storage + row), returning its id. */
export async function createFileBinary(opts: {
  file: File
  buffer: Buffer
  title: string
  contentHash: string
  uploadedBy: string
}): Promise<{ binaryId: string } | { error: string }> {
  const db = supabaseServer()
  const safeName = opts.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `resources/${Date.now()}-${safeName}`

  const { error: uploadError } = await db.storage.from(RESOURCES_BUCKET).upload(storagePath, opts.buffer, {
    contentType: opts.file.type || 'application/octet-stream',
    upsert: false,
  })
  if (uploadError) {
    console.error('[resource-upload] storage error:', uploadError)
    return { error: 'Upload failed' }
  }

  const { data, error } = await db
    .from('community_resources')
    .insert({
      title: opts.title,
      storage_path: storagePath,
      file_type: opts.file.type || null,
      file_size_bytes: opts.file.size,
      content_hash: opts.contentHash,
      uploaded_by: opts.uploadedBy,
    })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[resource-upload] insert error:', error)
    return { error: 'Could not save resource' }
  }
  return { binaryId: data.id as string }
}

/** Create a link binary (no storage), returning its id. */
export async function createLinkBinary(opts: {
  url: string
  normalisedUrl: string
  title: string
  uploadedBy: string
}): Promise<{ binaryId: string } | { error: string }> {
  const db = supabaseServer()
  const { data, error } = await db
    .from('community_resources')
    .insert({
      title: opts.title,
      source_url: opts.url,
      normalised_url: opts.normalisedUrl,
      file_type: 'link',
      uploaded_by: opts.uploadedBy,
    })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[resource-upload] link insert error:', error)
    return { error: 'Could not save link' }
  }
  return { binaryId: data.id as string }
}
