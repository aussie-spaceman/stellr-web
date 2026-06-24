import { supabaseServer } from '@/lib/supabase'
import { memberMeetsTier, type CommunityMember } from '@/lib/community'

// Global Resources Catalogue — read path (Resources_Refactor handover, PR1).
//
// A resource is NEVER a top-level object. It exists only as a `container_contents`
// row (content_type ∈ resource|recording) attached to one of the five container
// families. The catalogue is a UNION VIEW over those rows, scoped to the
// containers the member is on the roster of. Access is inherited from the
// container — there is no per-resource ACL (the legacy min_tier_rank /
// community_resource_tiers gates are deliberately NOT read here; decision 6b
// re-homes that intent onto container_contents.min_membership).
//
// Three layers (handover §3):
//   • binary     = community_resources row (the one stored file)
//   • attachment = container_contents row pointing at it (content_ref = binary id)
//   • grant      = being on the container's roster (cohort_members)
// Rows ≠ binaries: one binary attached to three containers is THREE catalogue rows.
//
// Server-side filtering only — every row returned is one the member can open.

export type ResourceKind = 'file' | 'link' | 'video'
export type ContainerVisibility = 'open' | 'private' | 'secret'
export type CatalogueSort = 'recent' | 'downloads' | 'name' | 'source'

/** The five container families whose rosters grant resource access. */
const ROSTER_CONTAINER_TYPES = [
  'space',
  'mentoring',
  'coaching',
  'workshop',
  'training',
  'event_participation',
  'campaign_participation',
] as const

interface ContainerMeta {
  id: string
  name: string
  type: string
  campaignRef: string | null
  visibility: ContainerVisibility
  lifecycle: string
}

export interface CatalogueProvenance {
  containerId: string
  containerType: string
  /** Display name of the source object (group suffix trimmed). */
  label: string
  /** Deep link to the source object, or null when it has no detail route. */
  href: string | null
  visibility: ContainerVisibility
}

export interface CatalogueRow {
  /** container_contents.id — the attachment, and the /resources/:id route param. */
  attachmentId: string
  /** content_ref — the stored binary (community_resources.id). */
  binaryId: string
  contentType: 'resource' | 'recording'
  kind: ResourceKind
  /** COALESCE(container_contents.display_name, community_resources.title). */
  name: string
  description: string | null
  fileType: string | null
  fileSizeBytes: number | null
  uploadedById: string | null
  uploadedByName: string | null
  addedAt: string
  /** True when the current member uploaded the binary (drives the rename pencil). */
  ownedByMe: boolean
  provenance: CatalogueProvenance
}

/** Deep link to a container's member-facing detail page, or null. */
function containerHref(c: ContainerMeta): string | null {
  switch (c.type) {
    case 'space':
      return c.campaignRef ? `/community/${c.campaignRef}` : null
    case 'mentoring':
      return `/community/mentoring/${c.id}`
    case 'workshop':
      return `/community/workshops/${c.id}`
    case 'coaching':
      return '/community/coaching'
    case 'training':
      return c.campaignRef ? `/community/training/${c.campaignRef}` : null
    case 'event_participation':
    case 'campaign_participation':
      return c.campaignRef ? `/community/events/${c.campaignRef}` : null
    default:
      return null
  }
}

/** Strip the " — {group}" suffix the event backfill appends to container names. */
function containerLabel(name: string): string {
  return name.split(' — ')[0]
}

function normaliseVisibility(v: unknown): ContainerVisibility {
  return v === 'private' || v === 'secret' ? v : 'open'
}

/** file → 'file', recording / video mime → 'video', explicit link → 'link'. */
function resourceKind(contentType: 'resource' | 'recording', fileType: string | null): ResourceKind {
  if (contentType === 'recording') return 'video'
  if (fileType?.startsWith('video/')) return 'video'
  if (fileType === 'link' || fileType === 'url') return 'link'
  return 'file'
}

/** Every container the member is an active roster member of, keyed by id. */
async function memberContainers(memberId: string): Promise<Map<string, ContainerMeta>> {
  const db = supabaseServer()
  const { data } = await db
    .from('cohort_members')
    .select('mentoring_cohorts!inner(id, name, container_type, campaign_ref, access_type, lifecycle)')
    .eq('member_id', memberId)
    .eq('status', 'active')

  type Cont = {
    id: string
    name: string
    container_type: string
    campaign_ref: string | null
    access_type: string | null
    lifecycle: string | null
  }
  const map = new Map<string, ContainerMeta>()
  for (const r of data ?? []) {
    const c = (Array.isArray(r.mentoring_cohorts) ? r.mentoring_cohorts[0] : r.mentoring_cohorts) as Cont | null
    if (!c) continue
    if (!ROSTER_CONTAINER_TYPES.includes(c.container_type as (typeof ROSTER_CONTAINER_TYPES)[number])) continue
    map.set(c.id, {
      id: c.id,
      name: c.name,
      type: c.container_type,
      campaignRef: c.campaign_ref,
      visibility: normaliseVisibility(c.access_type),
      lifecycle: c.lifecycle ?? 'active',
    })
  }
  return map
}

interface RawAttachment {
  id: string
  containerId: string
  contentType: 'resource' | 'recording'
  contentRef: string
  displayName: string | null
  minMembership: number | null
  addedAt: string
}

/** container_contents resource|recording rows for the given containers. */
async function attachmentsFor(containerIds: string[]): Promise<RawAttachment[]> {
  if (containerIds.length === 0) return []
  const db = supabaseServer()
  const { data } = await db
    .from('container_contents')
    .select('id, container_id, content_type, content_ref, display_name, min_membership, created_at, display_order')
    .in('container_id', containerIds)
    .in('content_type', ['resource', 'recording'])
    .order('display_order')
  return (data ?? []).map((r) => ({
    id: r.id as string,
    containerId: r.container_id as string,
    contentType: r.content_type as 'resource' | 'recording',
    contentRef: r.content_ref as string,
    displayName: (r.display_name as string | null) ?? null,
    minMembership: (r.min_membership as number | null) ?? null,
    addedAt: r.created_at as string,
  }))
}

interface BinaryMeta {
  id: string
  title: string
  description: string | null
  fileType: string | null
  fileSizeBytes: number | null
  uploadedBy: string | null
  createdAt: string
}

/** Resolve binary metadata (community_resources) for a set of content_refs. */
async function binariesFor(refs: string[]): Promise<Map<string, BinaryMeta>> {
  const map = new Map<string, BinaryMeta>()
  if (refs.length === 0) return map
  const db = supabaseServer()
  const { data } = await db
    .from('community_resources')
    .select('id, title, description, file_type, file_size_bytes, uploaded_by, created_at')
    .in('id', refs)
  for (const r of data ?? []) {
    map.set(r.id as string, {
      id: r.id as string,
      title: r.title as string,
      description: (r.description as string | null) ?? null,
      fileType: (r.file_type as string | null) ?? null,
      fileSizeBytes: (r.file_size_bytes as number | null) ?? null,
      uploadedBy: (r.uploaded_by as string | null) ?? null,
      createdAt: r.created_at as string,
    })
  }
  return map
}

/** Display names for a set of member ids (the resource uploaders). */
async function uploaderNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return map
  const db = supabaseServer()
  const { data } = await db.from('members').select('id, first_name, last_name').in('id', unique)
  for (const m of data ?? []) {
    const name = [m.first_name, m.last_name].filter(Boolean).join(' ').trim()
    map.set(m.id as string, name || 'Unknown')
  }
  return map
}

/**
 * Whether an attachment's per-attachment membership floor (decision 6b) admits
 * the member. NULL / ≤0 inherits the container (always allowed for a roster
 * member); >0 requires a paid tier. Admins bypass. This is the ONLY tier gate the
 * catalogue applies — legacy per-binary gates are not read.
 */
function passesMinMembership(member: CommunityMember, minMembership: number | null): boolean {
  if (member.isAdmin) return true
  if (minMembership == null || minMembership <= 0) return true
  return memberMeetsTier(member, minMembership)
}

export interface CatalogueQuery {
  search?: string
  /** Type filter; 'all' (default) returns every kind. */
  kind?: ResourceKind | 'all'
  sort?: CatalogueSort
}

/**
 * The member's resource catalogue: every resource|recording attached to a
 * container they're rostered on and can open. One row per attachment. Filtered
 * and sorted server-side.
 */
export async function listMemberResources(
  member: CommunityMember,
  query: CatalogueQuery = {},
): Promise<CatalogueRow[]> {
  const containers = await memberContainers(member.id)
  const attachments = await attachmentsFor([...containers.keys()])
  if (attachments.length === 0) return []

  const binaries = await binariesFor([...new Set(attachments.map((a) => a.contentRef))])
  const names = await uploaderNames([...binaries.values()].map((b) => b.uploadedBy).filter((x): x is string => !!x))

  let rows: CatalogueRow[] = []
  for (const a of attachments) {
    const container = containers.get(a.containerId)
    const binary = binaries.get(a.contentRef)
    // Drop rows whose binary no longer resolves (e.g. deleted) or that the
    // attachment-level membership floor excludes.
    if (!container || !binary) continue
    if (!passesMinMembership(member, a.minMembership)) continue

    rows.push({
      attachmentId: a.id,
      binaryId: binary.id,
      contentType: a.contentType,
      kind: resourceKind(a.contentType, binary.fileType),
      name: a.displayName ?? binary.title,
      description: binary.description,
      fileType: binary.fileType,
      fileSizeBytes: binary.fileSizeBytes,
      uploadedById: binary.uploadedBy,
      uploadedByName: binary.uploadedBy ? names.get(binary.uploadedBy) ?? null : null,
      addedAt: a.addedAt,
      ownedByMe: !!binary.uploadedBy && binary.uploadedBy === member.id,
      provenance: {
        containerId: container.id,
        containerType: container.type,
        label: containerLabel(container.name),
        href: containerHref(container),
        visibility: container.visibility,
      },
    })
  }

  // Type filter.
  if (query.kind && query.kind !== 'all') {
    rows = rows.filter((r) => r.kind === query.kind)
  }

  // Search: name + source object (handover §4.1, decision 2).
  const q = query.search?.trim().toLowerCase()
  if (q) {
    rows = rows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.provenance.label.toLowerCase().includes(q),
    )
  }

  // Sort. 'downloads' falls back to recency until the binary counter lands (PR4).
  switch (query.sort ?? 'recent') {
    case 'name':
      rows.sort((a, b) => a.name.localeCompare(b.name))
      break
    case 'source':
      rows.sort(
        (a, b) =>
          a.provenance.label.localeCompare(b.provenance.label) || a.name.localeCompare(b.name),
      )
      break
    case 'downloads':
    case 'recent':
    default:
      rows.sort((a, b) => +new Date(b.addedAt) - +new Date(a.addedAt))
      break
  }

  return rows
}

export interface ResourceDetail {
  binaryId: string
  /** The clicked attachment's resolved name. */
  name: string
  contentType: 'resource' | 'recording'
  kind: ResourceKind
  description: string | null
  fileType: string | null
  fileSizeBytes: number | null
  uploadedById: string | null
  uploadedByName: string | null
  addedAt: string
  ownedByMe: boolean
  /** Every container this member can reach the binary through ("How you have access"). */
  attachments: {
    attachmentId: string
    name: string
    provenance: CatalogueProvenance
  }[]
}

/**
 * Resource detail for /resources/:id, where :id is a container_contents.id the
 * member can see. Resolves the binary plus EVERY attachment of that binary the
 * member can open (the provenance / "how you have access" story). Returns null
 * when the member can't reach this attachment (404).
 */
export async function getResourceDetail(
  member: CommunityMember,
  attachmentId: string,
): Promise<ResourceDetail | null> {
  const db = supabaseServer()

  // The clicked attachment — and the binary it points at.
  const { data: clicked } = await db
    .from('container_contents')
    .select('id, container_id, content_type, content_ref, display_name, min_membership')
    .eq('id', attachmentId)
    .in('content_type', ['resource', 'recording'])
    .maybeSingle()
  if (!clicked) return null

  const containers = await memberContainers(member.id)
  const clickedContainer = containers.get(clicked.container_id as string)
  // Member must be able to open the clicked attachment.
  if (!clickedContainer || !passesMinMembership(member, (clicked.min_membership as number | null) ?? null)) {
    return null
  }

  const binaryId = clicked.content_ref as string
  const binaries = await binariesFor([binaryId])
  const binary = binaries.get(binaryId)
  if (!binary) return null

  // All sibling attachments of the same binary the member can reach.
  const { data: siblings } = await db
    .from('container_contents')
    .select('id, container_id, content_type, display_name, min_membership')
    .eq('content_ref', binaryId)
    .in('content_type', ['resource', 'recording'])

  const attachments: ResourceDetail['attachments'] = []
  for (const s of siblings ?? []) {
    const container = containers.get(s.container_id as string)
    if (!container) continue
    if (!passesMinMembership(member, (s.min_membership as number | null) ?? null)) continue
    attachments.push({
      attachmentId: s.id as string,
      name: (s.display_name as string | null) ?? binary.title,
      provenance: {
        containerId: container.id,
        containerType: container.type,
        label: containerLabel(container.name),
        href: containerHref(container),
        visibility: container.visibility,
      },
    })
  }

  const names = binary.uploadedBy ? await uploaderNames([binary.uploadedBy]) : new Map<string, string>()

  return {
    binaryId,
    name: (clicked.display_name as string | null) ?? binary.title,
    contentType: clicked.content_type as 'resource' | 'recording',
    kind: resourceKind(clicked.content_type as 'resource' | 'recording', binary.fileType),
    description: binary.description,
    fileType: binary.fileType,
    fileSizeBytes: binary.fileSizeBytes,
    uploadedById: binary.uploadedBy,
    uploadedByName: binary.uploadedBy ? names.get(binary.uploadedBy) ?? null : null,
    addedAt: binary.createdAt,
    ownedByMe: !!binary.uploadedBy && binary.uploadedBy === member.id,
    attachments,
  }
}
