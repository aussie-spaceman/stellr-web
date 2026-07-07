import { supabaseServer } from '@/lib/supabase'
import { memberMeetsTier, type CommunityMember } from '@/lib/community'
import { managedContainerIds } from '@/lib/resource-upload'
import { accessGatesEnforced, eventAccessGates } from '@/lib/access-gates'

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
  /**
   * 'catalogue' = a container_contents attachment (full detail/rename/flag).
   * 'training'  = a read-only lesson resource/recording resolved live from the
   * training tables (opens in-context; no catalogue detail/rename/flag).
   */
  source: 'catalogue' | 'training'
  /**
   * For catalogue rows: container_contents.id (the /resources/:id route param +
   * download ref). For training rows: an open token ('tr:<id>' | 'rec:<itemId>').
   */
  attachmentId: string
  /** content_ref — the stored binary (community_resources.id). Empty for training. */
  binaryId: string
  contentType: 'resource' | 'recording'
  kind: ResourceKind
  /** COALESCE(container_contents.display_name, community_resources.title). */
  name: string
  /**
   * Where the row's name links. Catalogue rows have a detail page
   * (/resources/:id) so this is null and the caller uses the attachment route.
   * Training rows have no detail page — this deep-links to the exact lesson
   * (/community/training/:module?lesson=:item) so opening a lesson recording /
   * resource lands on the RIGHT lesson, not the course's first-incomplete one.
   */
  openHref: string | null
  description: string | null
  fileType: string | null
  fileSizeBytes: number | null
  uploadedById: string | null
  uploadedByName: string | null
  addedAt: string
  downloadCount: number
  /** True when the current member uploaded the binary (drives the rename pencil). */
  ownedByMe: boolean
  /** Whether the member may rename this attachment (uploader, or manages its container). */
  canRename: boolean
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

  // Spaces resolve their roster via community_space_members, NOT cohort_members,
  // so they're added separately. The container's visibility comes from the space
  // (community_spaces.access_type), not the auto-created container row.
  await addSpaceContainers(db, memberId, map)

  return map
}

/** Add the member's active Spaces (community_space_members) to the container map. */
async function addSpaceContainers(
  db: ReturnType<typeof supabaseServer>,
  memberId: string,
  map: Map<string, ContainerMeta>,
): Promise<void> {
  const { data: rows } = await db
    .from('community_space_members')
    .select('community_spaces!inner(slug, name, access_type, is_archived)')
    .eq('member_id', memberId)
    .eq('status', 'active')

  type Space = { slug: string; name: string; access_type: string | null; is_archived: boolean }
  const spaceBySlug = new Map<string, Space>()
  for (const r of rows ?? []) {
    const s = (Array.isArray(r.community_spaces) ? r.community_spaces[0] : r.community_spaces) as Space | null
    if (s && !s.is_archived) spaceBySlug.set(s.slug, s)
  }
  if (spaceBySlug.size === 0) return

  // Map each space (by slug = campaign_ref) to its container row.
  const { data: containers } = await db
    .from('mentoring_cohorts')
    .select('id, name, campaign_ref, lifecycle')
    .eq('container_type', 'space')
    .in('campaign_ref', [...spaceBySlug.keys()])

  for (const c of containers ?? []) {
    const space = spaceBySlug.get(c.campaign_ref as string)
    if (!space) continue
    map.set(c.id as string, {
      id: c.id as string,
      name: space.name,
      type: 'space',
      campaignRef: c.campaign_ref as string,
      visibility: normaliseVisibility(space.access_type),
      lifecycle: (c.lifecycle as string | null) ?? 'active',
    })
  }
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
  downloadCount: number
}

/** Resolve binary metadata (community_resources) for a set of content_refs. */
async function binariesFor(refs: string[]): Promise<Map<string, BinaryMeta>> {
  const map = new Map<string, BinaryMeta>()
  if (refs.length === 0) return map
  const db = supabaseServer()
  const { data } = await db
    .from('community_resources')
    .select('id, title, description, file_type, file_size_bytes, uploaded_by, created_at, download_count')
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
      downloadCount: (r.download_count as number | null) ?? 0,
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

/**
 * Container ids the member is LOCKED out of by the payment ∧ DocuSign gate, when
 * enforcement is on (handover §0.2/§3; convergence P4). Returns empty when the
 * flag is off (report-only) so the catalogue stays roster+min_membership only.
 * Only competition containers carry a real gate today; other types auto-pass.
 */
async function lockedContainerIds(
  member: CommunityMember,
  containers: Map<string, ContainerMeta>,
): Promise<Set<string>> {
  const locked = new Set<string>()
  if (!accessGatesEnforced()) return locked

  const bySlug = new Map<string, string[]>()
  for (const c of containers.values()) {
    if ((c.type === 'event_participation' || c.type === 'campaign_participation') && c.campaignRef) {
      bySlug.set(c.campaignRef, [...(bySlug.get(c.campaignRef) ?? []), c.id])
    }
  }
  for (const [slug, ids] of bySlug) {
    const gate = await eventAccessGates(member, slug)
    if (!gate.unlocked) ids.forEach((id) => locked.add(id))
  }
  return locked
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
  // Containers the member manages → may rename attachments in them (#6 fast-follow).
  const managed = await managedContainerIds(member)
  // Gate-locked containers (only when ACCESS_GATES_ENFORCE is on).
  const locked = await lockedContainerIds(member, containers)

  let rows: CatalogueRow[] = []
  for (const a of attachments) {
    const container = containers.get(a.containerId)
    const binary = binaries.get(a.contentRef)
    // Drop rows whose binary no longer resolves (e.g. deleted), that the
    // attachment-level membership floor excludes, or whose container is gate-locked.
    if (!container || !binary) continue
    if (locked.has(container.id)) continue
    if (!passesMinMembership(member, a.minMembership)) continue

    const ownedByMe = !!binary.uploadedBy && binary.uploadedBy === member.id
    rows.push({
      source: 'catalogue',
      attachmentId: a.id,
      binaryId: binary.id,
      contentType: a.contentType,
      kind: resourceKind(a.contentType, binary.fileType),
      name: a.displayName ?? binary.title,
      openHref: null,
      description: binary.description,
      fileType: binary.fileType,
      fileSizeBytes: binary.fileSizeBytes,
      uploadedById: binary.uploadedBy,
      uploadedByName: binary.uploadedBy ? names.get(binary.uploadedBy) ?? null : null,
      addedAt: a.addedAt,
      downloadCount: binary.downloadCount,
      ownedByMe,
      canRename: member.isAdmin || ownedByMe || managed.has(container.id),
      provenance: {
        containerId: container.id,
        containerType: container.type,
        label: containerLabel(container.name),
        href: containerHref(container),
        visibility: container.visibility,
      },
    })
  }

  // Read-only training source: lesson resources + recordings for enrolled courses.
  rows.push(...(await listTrainingCatalogueRows(member)))

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

  // Sort.
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
      rows.sort((a, b) => b.downloadCount - a.downloadCount || +new Date(b.addedAt) - +new Date(a.addedAt))
      break
    case 'recent':
    default:
      rows.sort((a, b) => +new Date(b.addedAt) - +new Date(a.addedAt))
      break
  }

  return rows
}

/**
 * Read-only catalogue rows for the member's training courses (decision: training
 * is a separate content model — training_item_resources + lesson recordings — not
 * community_resources). Scoped to courses the member is ENROLLED in
 * (training_enrollments = the training "roster"). These rows open in-context and
 * carry no catalogue detail / rename / flag.
 */
async function listTrainingCatalogueRows(member: CommunityMember): Promise<CatalogueRow[]> {
  const db = supabaseServer()

  const { data: enrollments } = await db
    .from('training_enrollments')
    .select('module_id')
    .eq('member_id', member.id)
  const moduleIds = [...new Set((enrollments ?? []).map((e) => e.module_id as string))]
  if (moduleIds.length === 0) return []

  const [{ data: modules }, { data: items }] = await Promise.all([
    db.from('training_modules').select('id, title').in('id', moduleIds),
    db
      .from('training_items')
      .select('id, module_id, title, status, recording_path, recording_status, created_at')
      .in('module_id', moduleIds),
  ])
  const moduleTitle = new Map((modules ?? []).map((m) => [m.id as string, m.title as string]))
  const publishedItems = (items ?? []).filter((i) => (i.status as string | null) !== 'draft')
  const itemModule = new Map(publishedItems.map((i) => [i.id as string, i.module_id as string]))
  const itemIds = publishedItems.map((i) => i.id as string)

  const prov = (moduleId: string): CatalogueProvenance => ({
    containerId: moduleId,
    containerType: 'training',
    label: moduleTitle.get(moduleId) ?? 'Training course',
    href: `/community/training/${moduleId}`,
    visibility: 'open',
  })
  const base = {
    binaryId: '',
    description: null,
    fileSizeBytes: null,
    uploadedById: null,
    uploadedByName: null,
    downloadCount: 0,
    ownedByMe: false,
    canRename: false,
  }

  const rows: CatalogueRow[] = []

  // Lesson file/link resources.
  if (itemIds.length > 0) {
    const { data: res } = await db
      .from('training_item_resources')
      .select('id, item_id, kind, title, created_at')
      .in('item_id', itemIds)
    for (const r of res ?? []) {
      const moduleId = itemModule.get(r.item_id as string)
      if (!moduleId) continue
      const kind = (r.kind as string) === 'link' ? 'link' : 'file'
      rows.push({
        ...base,
        source: 'training',
        attachmentId: `tr:${r.id as string}`,
        contentType: 'resource',
        kind,
        name: r.title as string,
        openHref: `/community/training/${moduleId}?lesson=${r.item_id as string}`,
        fileType: kind === 'link' ? 'link' : null,
        addedAt: r.created_at as string,
        provenance: prov(moduleId),
      })
    }
  }

  // Lesson recordings (live lessons whose replay is available).
  for (const i of publishedItems) {
    if (!i.recording_path || (i.recording_status as string | null) !== 'available') continue
    rows.push({
      ...base,
      source: 'training',
      attachmentId: `rec:${i.id as string}`,
      contentType: 'recording',
      kind: 'video',
      name: `${i.title as string} (recording)`,
      openHref: `/community/training/${i.module_id as string}?lesson=${i.id as string}`,
      fileType: 'video/mp4',
      addedAt: i.created_at as string,
      provenance: prov(i.module_id as string),
    })
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
  downloadCount: number
  ownedByMe: boolean
  /** Whether the member may rename this attachment (uploader, or manages its container). */
  canRename: boolean
  /** The container the clicked attachment lives in — flag context (PR3). */
  viewedInContainerId: string
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
  const ownedByMe = !!binary.uploadedBy && binary.uploadedBy === member.id
  const managed = await managedContainerIds(member)

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
    downloadCount: binary.downloadCount,
    ownedByMe,
    canRename: member.isAdmin || ownedByMe || managed.has(clicked.container_id as string),
    viewedInContainerId: clicked.container_id as string,
    attachments,
  }
}

/**
 * What a resolved attachment opens to: a stored file (needs a signed URL) or a
 * link (the destination URL is returned directly).
 */
export type DownloadableResolution =
  | { kind: 'file'; storagePath: string; title: string; binaryId: string }
  | { kind: 'link'; url: string; title: string; binaryId: string }

/**
 * Resolve an attachment to its binary for open/download, re-checking access at
 * request time (handover §4.2 "Open/Download re-checks the gate"). Access is the
 * CONTAINER's — being on the roster of the attachment's container + clearing its
 * membership floor — NOT the legacy per-binary gates. Handles both files and link
 * resources (and recordings, which resolve to whichever the binary holds).
 * Returns null when the member can't reach it.
 */
export async function resolveDownloadableAttachment(
  member: CommunityMember,
  attachmentId: string,
): Promise<DownloadableResolution | null> {
  const db = supabaseServer()
  const { data: att } = await db
    .from('container_contents')
    .select('container_id, content_type, content_ref, min_membership')
    .eq('id', attachmentId)
    .in('content_type', ['resource', 'recording'])
    .maybeSingle()
  if (!att) return null

  const containers = await memberContainers(member.id)
  const container = containers.get(att.container_id as string)
  if (!container || !passesMinMembership(member, (att.min_membership as number | null) ?? null)) {
    return null
  }
  // Gate-locked containers deny the open at request time (when enforced).
  if (accessGatesEnforced() && (await lockedContainerIds(member, new Map([[container.id, container]]))).has(container.id)) {
    return null
  }

  const { data: binary } = await db
    .from('community_resources')
    .select('storage_path, source_url, file_type, title')
    .eq('id', att.content_ref as string)
    .maybeSingle()
  if (!binary) return null

  const title = binary.title as string
  const binaryId = att.content_ref as string
  // A link resource (or any binary with no stored file) opens to its URL.
  if ((binary.file_type as string | null) === 'link' || !binary.storage_path) {
    const url = binary.source_url as string | null
    return url ? { kind: 'link', url, title, binaryId } : null
  }
  return { kind: 'file', storagePath: binary.storage_path as string, title, binaryId }
}

/**
 * Resolve a training open-token ('tr:<resourceId>' | 'rec:<itemId>') to a file
 * (sign in the caller) or a link, re-checking access at request time. Access =
 * enrolled in the lesson's module (the training roster) or admin. Returns null
 * when not reachable.
 */
export async function resolveTrainingOpen(
  member: CommunityMember,
  ref: string,
): Promise<{ kind: 'file' | 'recording'; storagePath: string; title: string } | { kind: 'link'; url: string; title: string } | null> {
  const db = supabaseServer()

  const enrolledIn = async (moduleId: string): Promise<boolean> => {
    if (member.isAdmin) return true
    const { data } = await db
      .from('training_enrollments')
      .select('id')
      .eq('member_id', member.id)
      .eq('module_id', moduleId)
      .maybeSingle()
    return !!data
  }

  if (ref.startsWith('tr:')) {
    const { data: r } = await db
      .from('training_item_resources')
      .select('kind, title, storage_path, external_url, training_items!inner(module_id)')
      .eq('id', ref.slice(3))
      .maybeSingle()
    if (!r) return null
    const item = Array.isArray(r.training_items) ? r.training_items[0] : r.training_items
    const moduleId = (item as { module_id?: string } | null)?.module_id
    if (!moduleId || !(await enrolledIn(moduleId))) return null
    if ((r.kind as string) === 'link') {
      return r.external_url ? { kind: 'link', url: r.external_url as string, title: r.title as string } : null
    }
    return r.storage_path ? { kind: 'file', storagePath: r.storage_path as string, title: r.title as string } : null
  }

  if (ref.startsWith('rec:')) {
    const { data: item } = await db
      .from('training_items')
      .select('title, module_id, recording_path, recording_status')
      .eq('id', ref.slice(4))
      .maybeSingle()
    if (!item || !item.recording_path || (item.recording_status as string | null) !== 'available') return null
    if (!(await enrolledIn(item.module_id as string))) return null
    return { kind: 'recording', storagePath: item.recording_path as string, title: item.title as string }
  }

  return null
}

/**
 * Whether `member` may rename `attachmentId`. Allowed for the binary's uploader
 * (handover §4.4), a manager of the attachment's container (#6 fast-follow), or a
 * platform admin. Returns the binary id on success; null otherwise.
 */
export async function canRenameAttachment(
  member: CommunityMember,
  attachmentId: string,
): Promise<{ binaryId: string } | null> {
  const db = supabaseServer()
  const { data: att } = await db
    .from('container_contents')
    .select('content_ref, content_type, container_id')
    .eq('id', attachmentId)
    .in('content_type', ['resource', 'recording'])
    .maybeSingle()
  if (!att) return null

  const { data: binary } = await db
    .from('community_resources')
    .select('id, uploaded_by')
    .eq('id', att.content_ref as string)
    .maybeSingle()
  if (!binary) return null

  if (!member.isAdmin && binary.uploaded_by !== member.id) {
    const managed = await managedContainerIds(member)
    if (!managed.has(att.container_id as string)) return null
  }
  return { binaryId: binary.id as string }
}
