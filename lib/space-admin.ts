import { supabaseServer } from '@/lib/supabase'
import { getActiveTierNames } from '@/lib/tiers-server'
import { getEventsBySlugs } from '@/lib/sanity'
import type { SpaceAccessType, SpaceRole, SpaceTheme } from '@/lib/spaces'

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
  members: { memberId: string; name: string; tierName: string | null; role: SpaceRole; status: 'invited' | 'active'; muted: boolean }[]
  // `attachmentId` is set for files linked from the Global Resources Catalogue
  // (detach removes the link only); null for files uploaded to this space (remove
  // deletes the binary).
  resources: { id: string; title: string; fileType: string | null; fromChat: boolean; createdAt: string; attachmentId: string | null }[]
  assignedTraining: { moduleId: string; title: string; mandatory: boolean }[]
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
    { data: memberRows },
    { data: resourceRows },
    { data: trainRows },
    { data: catalogue },
    { data: annRows },
  ] = await Promise.all([
    db.from('community_channels').select('id, slug, name, display_order').eq('space_id', spaceId).eq('is_archived', false).order('display_order'),
    db.from('community_space_tiers').select('tier_id').eq('space_id', spaceId),
    db.from('community_space_roles').select('role').eq('space_id', spaceId),
    db.from('community_space_sources').select('id, object_type, object_ref').eq('space_id', spaceId).order('created_at'),
    db.from('community_space_members').select('member_id, role, status, muted, members:member_id(first_name, last_name)').eq('space_id', spaceId),
    db.from('community_resources').select('id, title, file_type, from_chat, created_at').eq('space_id', spaceId).order('created_at', { ascending: false }),
    db.from('community_space_training').select('training_module_id, is_mandatory, display_order, training_modules(title)').eq('space_id', spaceId).order('display_order'),
    db.from('training_modules').select('id, title').eq('is_published', true).order('display_order'),
    db.from('community_announcements').select('id, title, body, created_at').eq('space_id', spaceId).order('created_at', { ascending: false }),
  ])

  type MRow = { member_id: string; role: SpaceRole; status: 'invited' | 'active'; muted: boolean | null; members: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null }
  const mrows = (memberRows ?? []) as unknown as MRow[]
  const tierNames = await getActiveTierNames(mrows.map((m) => m.member_id))
  const members = mrows.map((m) => ({
    memberId: m.member_id,
    name: nameOf(rel(m.members)),
    tierName: tierNames.get(m.member_id) ?? null,
    role: m.role,
    status: m.status,
    muted: !!m.muted,
  }))

  // Resolve friendly labels for the linked-object list (raw refs are slugs/uuids).
  const srcRows = (sourceRows ?? []) as Array<{ id: string; object_type: string; object_ref: string }>
  const labelByKey = new Map<string, string>()
  if (srcRows.length) {
    const eventSlugs = srcRows.filter((r) => r.object_type === 'event').map((r) => r.object_ref)
    const trainIds = srcRows.filter((r) => r.object_type === 'training').map((r) => r.object_ref)
    const cohortIds = srcRows.filter((r) => r.object_type === 'mentoring' || r.object_type === 'coaching').map((r) => r.object_ref)
    const [events, { data: mods }, { data: cohorts }] = await Promise.all([
      eventSlugs.length ? getEventsBySlugs(eventSlugs) : Promise.resolve([]),
      trainIds.length ? db.from('training_modules').select('id, title').in('id', trainIds) : Promise.resolve({ data: [] as { id: string; title: string }[] }),
      cohortIds.length ? db.from('mentoring_cohorts').select('id, name').in('id', cohortIds) : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
    ])
    for (const e of events as Array<{ title?: string; slug?: { current?: string } }>) {
      const s = e.slug?.current
      if (s) labelByKey.set(`event:${s}`, e.title ?? s)
    }
    for (const m of (mods ?? []) as Array<{ id: string; title: string }>) labelByKey.set(`training:${m.id}`, m.title)
    for (const c of (cohorts ?? []) as Array<{ id: string; name: string | null }>) {
      labelByKey.set(`mentoring:${c.id}`, c.name ?? c.id)
      labelByKey.set(`coaching:${c.id}`, c.name ?? c.id)
    }
  }

  // Files linked from the Global Resources Catalogue live on the space's container
  // (container_contents), not on community_resources.space_id. Surface those too so
  // catalogue-attached files show alongside direct uploads. content_ref has no FK,
  // so resolve the binaries in a second query rather than an embedded join.
  const catalogueResources: AdminSpaceConfig['resources'] = []
  const { data: containerRow } = await db
    .from('mentoring_cohorts')
    .select('id')
    .eq('container_type', 'space')
    .eq('campaign_ref', (s as { slug: string }).slug)
    .maybeSingle()
  const containerId = (containerRow as { id: string } | null)?.id ?? null
  if (containerId) {
    const { data: cc } = await db
      .from('container_contents')
      .select('id, content_ref, display_name, created_at')
      .eq('container_id', containerId)
      .eq('content_type', 'resource')
    const ccRows = (cc ?? []) as Array<{ id: string; content_ref: string; display_name: string | null; created_at: string }>
    const refs = ccRows.map((r) => r.content_ref)
    if (refs.length) {
      const { data: bins } = await db
        .from('community_resources')
        .select('id, title, file_type, space_id')
        .in('id', refs)
      const binById = new Map(
        ((bins ?? []) as Array<{ id: string; title: string; file_type: string | null; space_id: string | null }>).map((x) => [x.id, x]),
      )
      for (const row of ccRows) {
        const bin = binById.get(row.content_ref)
        if (!bin) continue
        // Files uploaded to THIS space already appear via the space_id query below
        // (with a delete-binary Remove action). Skip them here to avoid duplicates.
        if (bin.space_id === spaceId) continue
        catalogueResources.push({
          id: bin.id,
          title: row.display_name || bin.title,
          fileType: bin.file_type,
          fromChat: false,
          createdAt: row.created_at,
          attachmentId: row.id,
        })
      }
    }
  }

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
    resources: [
      ...(resourceRows ?? []).map((r) => {
        const x = r as { id: string; title: string; file_type: string | null; from_chat: boolean; created_at: string }
        return { id: x.id, title: x.title, fileType: x.file_type, fromChat: !!x.from_chat, createdAt: x.created_at, attachmentId: null }
      }),
      ...catalogueResources,
    ],
    assignedTraining: (trainRows ?? []).map((t) => {
      const x = t as { training_module_id: string; is_mandatory: boolean; training_modules: { title: string } | { title: string }[] | null }
      return { moduleId: x.training_module_id, title: rel(x.training_modules)?.title ?? 'Course', mandatory: !!x.is_mandatory }
    }),
    trainingCatalogue: (catalogue ?? []).map((c) => ({ id: (c as { id: string }).id, title: (c as { title: string }).title })),
    announcements: (annRows ?? []).map((a) => {
      const x = a as { id: string; title: string; body: string | null; created_at: string }
      return { id: x.id, title: x.title, body: x.body, createdAt: x.created_at }
    }),
    moderation: await loadModeration(db, spaceId),
  }
}

async function loadModeration(
  db: ReturnType<typeof supabaseServer>,
  spaceId: string
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

  const { data: resources } = await db.from('community_resources').select('id, title').eq('space_id', spaceId)
  const resourceMap = new Map<string, { quoted: string; where: string }>()
  for (const r of (resources ?? []) as Array<{ id: string; title: string }>) {
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
