import { supabaseServer } from '@/lib/supabase'
import { listSpaceResources, type SpaceResource } from '@/lib/space-resources'
import { resolveTierMap } from '@/lib/tiers-server'
import { getEventsBySlugs } from '@/lib/sanity'
import { resolveSpaceAudience, type SpaceAudienceMember } from '@/lib/spaces'
import { ROLE_LABELS, type MemberRole } from '@/lib/member-roles'
import type { SpaceAccessType, SpaceTheme } from '@/lib/spaces'
import type { BracketRequirements } from '@/lib/space-training'

// Loads everything the admin single-space config screen needs (screens 11–17).

export interface AdminSpaceConfig {
  space: {
    id: string
    slug: string
    name: string
    description: string | null
    access_type: SpaceAccessType
    theme: SpaceTheme
    posting_policy: 'all' | 'moderators'
    allow_member_uploads: boolean
  }
  channels: { id: string; slug: string; name: string }[]
  assignedTierIds: string[]
  // Web-app roles granted access to this space (Access Convergence).
  assignedRoles: string[]
  // Objects (Event/Training/Mentoring/Coaching) whose members inherit this space.
  sources: { id: string; objectType: string; objectRef: string; label: string }[]
  /**
   * The DERIVED audience, not the roster table. Tier and role grants write no
   * community_space_members row, so reading that table alone showed every tier
   * and role Space as empty while its member count (already derived) disagreed.
   * `grantLabel` is the resolved, human-readable form of grantRef.
   */
  members: (SpaceAudienceMember & { grantLabel: string | null })[]
  /** True when the audience was trimmed to exceptions (open spaces). */
  membersAreExceptions: boolean
  /** Live-member total for an open space, whose audience is everyone. */
  audienceTotal: number
  // `attachmentId` is set for files linked from the Global Resources Catalogue
  // (detach removes the link only); null for files uploaded to this space (remove
  // deletes the binary).
  resources: SpaceResource[]
  assignedTraining: { moduleId: string; title: string; mandatory: boolean; bracketRequirements: BracketRequirements }[]
  trainingCatalogue: { id: string; title: string }[]
  announcements: { id: string; title: string; body: string | null; createdAt: string }[]
  moderation: {
    flagId: string
    contentType: string
    reason: string | null
    createdAt: string
    reporterName: string
    quoted: string
    where: string
  }[]
}

function rel<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? v[0] ?? null : v
}
function nameOf(m: { first_name: string | null; last_name: string | null } | null, fallback = 'Member'): string {
  if (!m) return fallback
  return [m.first_name, m.last_name].filter(Boolean).join(' ') || fallback
}

export async function loadSpaceAdmin(spaceId: string): Promise<AdminSpaceConfig | null> {
  const db = supabaseServer()
  const { data: s } = await db
    .from('community_spaces')
    .select('id, slug, name, description, access_type, theme, posting_policy, allow_member_uploads')
    .eq('id', spaceId)
    .maybeSingle()
  if (!s) return null

  const [
    { data: channels },
    { data: tierRows },
    { data: roleRows },
    { data: sourceRows },
    { data: trainRows },
    { data: catalogue },
    { data: annRows },
  ] = await Promise.all([
    db.from('community_channels').select('id, slug, name, display_order').eq('space_id', spaceId).eq('is_archived', false).order('display_order'),
    db.from('community_space_tiers').select('tier_id').eq('space_id', spaceId),
    db.from('community_space_roles').select('role').eq('space_id', spaceId),
    db.from('community_space_sources').select('id, object_type, object_ref').eq('space_id', spaceId).order('created_at'),
    db.from('community_space_training').select('training_module_id, is_mandatory, bracket_requirements, display_order, training_modules(title)').eq('space_id', spaceId).order('display_order'),
    db.from('training_modules').select('id, title').eq('is_published', true).order('display_order'),
    db.from('community_announcements').select('id, title, body, created_at').eq('space_id', spaceId).order('created_at', { ascending: false }),
  ])

  // An open Space's audience is every live member, so list only the exceptions
  // (roster rows, role holders, blocked people) rather than the whole platform.
  const isOpen = (s as { access_type: SpaceAccessType }).access_type === 'open'
  const audience = await resolveSpaceAudience(spaceId, { exceptionsOnly: isOpen })
  const audienceTotal = isOpen
    ? (await db
        .from('members')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .is('deleted_at', null)).count ?? audience.length
    : audience.length

  // Resolve friendly labels for the linked-object list (raw refs are slugs/uuids).
  const srcRows = (sourceRows ?? []) as Array<{ id: string; object_type: string; object_ref: string }>
  const labelByKey = await buildSourceLabels(db, srcRows)
  const members = await applyGrantLabels(audience, labelByKey)

  // Direct uploads + files linked from the Global Resources Catalogue, read
  // through the same helper the member-facing Space page uses so the two can
  // never disagree about what is in a Space.
  const resources = await listSpaceResources(spaceId, (s as { slug: string }).slug)

  return {
    space: s as AdminSpaceConfig['space'],
    channels: (channels ?? []).map((c) => ({ id: (c as { id: string }).id, slug: (c as { slug: string }).slug, name: (c as { name: string }).name })),
    assignedTierIds: (tierRows ?? []).map((t) => (t as { tier_id: string }).tier_id),
    assignedRoles: (roleRows ?? []).map((r) => (r as { role: string }).role),
    sources: srcRows.map((x) => ({
      id: x.id,
      objectType: x.object_type,
      objectRef: x.object_ref,
      label: labelByKey.get(`${x.object_type}:${x.object_ref}`) ?? x.object_ref,
    })),
    members,
    membersAreExceptions: isOpen,
    audienceTotal,
    resources,
    assignedTraining: (trainRows ?? []).map((t) => {
      const x = t as { training_module_id: string; is_mandatory: boolean; bracket_requirements: BracketRequirements | null; training_modules: { title: string } | { title: string }[] | null }
      return {
        moduleId: x.training_module_id,
        title: rel(x.training_modules)?.title ?? 'Course',
        mandatory: !!x.is_mandatory,
        bracketRequirements: x.bracket_requirements ?? {},
      }
    }),
    trainingCatalogue: (catalogue ?? []).map((c) => ({ id: (c as { id: string }).id, title: (c as { title: string }).title })),
    announcements: (annRows ?? []).map((a) => {
      const x = a as { id: string; title: string; body: string | null; created_at: string }
      return { id: x.id, title: x.title, body: x.body, createdAt: x.created_at }
    }),
    moderation: await loadModeration(db, spaceId, resources),
  }
}

async function loadModeration(
  db: ReturnType<typeof supabaseServer>,
  spaceId: string,
  resources: SpaceResource[]
): Promise<AdminSpaceConfig['moderation']> {
  // Resolve which posts / comments / resources belong to this space, then pull
  // pending flags against them.
  const { data: posts } = await db
    .from('community_posts')
    .select('id, title, body_text, community_channels(name)')
    .eq('space_id', spaceId)
  const postMap = new Map<string, { quoted: string; where: string }>()
  const postIds: string[] = []
  for (const p of (posts ?? []) as Array<{ id: string; title: string | null; body_text: string | null; community_channels: { name: string } | { name: string }[] | null }>) {
    postIds.push(p.id)
    postMap.set(p.id, { quoted: p.title || p.body_text || '(post)', where: `# ${rel(p.community_channels)?.name ?? 'channel'}` })
  }

  const commentMap = new Map<string, { quoted: string; where: string }>()
  let commentIds: string[] = []
  if (postIds.length) {
    const { data: comments } = await db.from('community_comments').select('id, body_text, post_id').in('post_id', postIds)
    for (const c of (comments ?? []) as Array<{ id: string; body_text: string | null }>) {
      commentMap.set(c.id, { quoted: c.body_text || '(reply)', where: 'Reply' })
    }
    commentIds = [...commentMap.keys()]
  }

  // Every resource IN the space, not just those uploaded to it — a member can
  // flag a catalogue-linked file too, and reading community_resources.space_id
  // alone would drop that flag out of the queue silently.
  const resourceMap = new Map<string, { quoted: string; where: string }>()
  for (const r of resources) {
    resourceMap.set(r.id, { quoted: r.title, where: 'Resource' })
  }

  const allIds = [...postIds, ...commentIds, ...resourceMap.keys()]
  if (allIds.length === 0) return []

  const { data: flags } = await db
    .from('community_flags')
    .select('id, content_type, content_id, reason, created_at, members:flagged_by(first_name, last_name)')
    .eq('status', 'pending')
    .in('content_id', allIds)
    .order('created_at', { ascending: false })

  return ((flags ?? []) as Array<{
    id: string; content_type: string; content_id: string; reason: string | null; created_at: string
    members: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null
  }>)
    .map((f) => {
      const ctx =
        f.content_type === 'post' ? postMap.get(f.content_id)
        : f.content_type === 'comment' ? commentMap.get(f.content_id)
        : resourceMap.get(f.content_id)
      if (!ctx) return null
      return {
        flagId: f.id,
        contentType: f.content_type,
        reason: f.reason,
        createdAt: f.created_at,
        reporterName: nameOf(rel(f.members), 'A member'),
        quoted: ctx.quoted,
        where: ctx.where,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}


// ─── Grant labelling (shared with the paginated members API) ─────────────────

type SourceRow = { object_type: string; object_ref: string }

/** `objectType:objectRef` → the human name of that Event / Course / Cohort. */
async function buildSourceLabels(
  db: ReturnType<typeof supabaseServer>,
  srcRows: SourceRow[],
): Promise<Map<string, string>> {
  const labelByKey = new Map<string, string>()
  if (!srcRows.length) return labelByKey

  const eventSlugs = srcRows.filter((r) => r.object_type === 'event').map((r) => r.object_ref)
  const trainIds = srcRows.filter((r) => r.object_type === 'training').map((r) => r.object_ref)
  const cohortIds = srcRows.filter((r) => r.object_type === 'mentoring' || r.object_type === 'coaching').map((r) => r.object_ref)
  const [events, { data: mods }, { data: cohorts }] = await Promise.all([
    eventSlugs.length ? getEventsBySlugs(eventSlugs) : Promise.resolve([]),
    trainIds.length ? db.from('training_modules').select('id, title').in('id', trainIds) : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    cohortIds.length ? db.from('mentoring_cohorts').select('id, name').in('id', cohortIds) : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
  ])
  for (const e of events as Array<{ title?: string; slug?: { current?: string } }>) {
    const slug = e.slug?.current
    if (slug) labelByKey.set(`event:${slug}`, e.title ?? slug)
  }
  for (const m of (mods ?? []) as Array<{ id: string; title: string }>) labelByKey.set(`training:${m.id}`, m.title)
  for (const c of (cohorts ?? []) as Array<{ id: string; name: string | null }>) {
    labelByKey.set(`mentoring:${c.id}`, c.name ?? c.id)
    labelByKey.set(`coaching:${c.id}`, c.name ?? c.id)
  }
  return labelByKey
}

/**
 * Turn each member's machine-readable grantRef into the badge the admin reads.
 * This is what makes revoke comprehensible: "you can't remove them, their
 * Pathfinder tier lets them in" is only obvious once the tier is named.
 */
async function applyGrantLabels(
  audience: SpaceAudienceMember[],
  labelByKey: Map<string, string>,
): Promise<(SpaceAudienceMember & { grantLabel: string | null })[]> {
  const tierMap = audience.some((m) => m.reason === 'tier') ? await resolveTierMap() : null
  return audience.map((m) => {
    let grantLabel: string | null = null
    if (m.grantRef) {
      if (m.reason === 'tier') grantLabel = tierMap?.nameById[m.grantRef] ?? null
      else if (m.reason === 'role') grantLabel = ROLE_LABELS[m.grantRef as MemberRole] ?? m.grantRef
      else grantLabel = labelByKey.get(m.grantRef) ?? m.grantRef
    }
    return { ...m, grantLabel }
  })
}

export interface SpaceMembersPage {
  members: (SpaceAudienceMember & { grantLabel: string | null })[]
  /** Rows matching the filters, before paging. */
  total: number
  /** Everyone who can enter, however the list was filtered. */
  audienceTotal: number
  exceptionsOnly: boolean
}

/**
 * The Space members roster, filtered, searched and paged — what the Members tab
 * calls once an admin types or turns a page. Reads the same resolver as
 * loadSpaceAdmin, so the first page and the searched page can't disagree.
 */
export async function loadSpaceMembersPage(
  spaceId: string,
  opts: {
    q?: string
    reason?: string
    status?: 'blocked' | 'invited' | 'active'
    page?: number
    pageSize?: number
    /** Force the full audience of an open space rather than just its exceptions. */
    includeEveryone?: boolean
  } = {},
): Promise<SpaceMembersPage> {
  const db = supabaseServer()
  const { data: s } = await db
    .from('community_spaces')
    .select('access_type')
    .eq('id', spaceId)
    .maybeSingle()
  const isOpen = (s as { access_type: SpaceAccessType } | null)?.access_type === 'open'
  const exceptionsOnly = isOpen && !opts.includeEveryone && !opts.q

  const audience = await resolveSpaceAudience(spaceId, { exceptionsOnly })

  const q = opts.q?.trim().toLowerCase()
  const filtered = audience.filter((m) => {
    if (q && !`${m.name} ${m.email ?? ''}`.toLowerCase().includes(q)) return false
    if (opts.reason && m.reason !== opts.reason) return false
    if (opts.status === 'blocked' && !m.revoked && !m.postingSuspended) return false
    if (opts.status === 'invited' && m.status !== 'invited') return false
    if (opts.status === 'active' && (m.status !== 'active' || m.revoked)) return false
    return true
  })

  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50))
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize)

  const { data: sourceRows } = await db
    .from('community_space_sources')
    .select('object_type, object_ref')
    .eq('space_id', spaceId)
  const labelByKey = await buildSourceLabels(db, (sourceRows ?? []) as SourceRow[])

  const audienceTotal = isOpen
    ? (await db
        .from('members')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .is('deleted_at', null)).count ?? filtered.length
    : audience.length

  return {
    members: await applyGrantLabels(slice, labelByKey),
    total: filtered.length,
    audienceTotal,
    exceptionsOnly,
  }
}
