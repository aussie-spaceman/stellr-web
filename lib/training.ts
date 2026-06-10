import { supabaseServer } from '@/lib/supabase'
import {
  type CommunityMember,
  memberCanAccess,
  signedDownloadUrl,
} from '@/lib/community'

// FR-COM-10 — Training section, gated by membership tier.
// Modules contain ordered items (video/document/google_doc/link). Progress is
// tracked per item so members see "1 of 4" and teachers/admins see completion.

export type MaterialKind = 'general' | 'event' | 'campaign' | 'cte'

export interface TrainingItem {
  id: string
  title: string
  content_kind: 'video' | 'document' | 'google_doc' | 'link'
  external_url: string | null
  estimated_minutes: number | null
  display_order: number
  completed: boolean
}

export interface TrainingModuleSummary {
  id: string
  title: string
  description: string | null
  material_kind: MaterialKind
  event_ref: string | null
  itemCount: number
  completedCount: number
  /** Set when surfaced via an event assignment. */
  isMandatory?: boolean
  dueAt?: string | null
  /** Whether the current member can access this module (entitlement-aware). */
  canAccess: boolean
}

/** Map of item_id → status for a member, for progress rollups. */
async function progressMap(memberId: string, itemIds: string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set()
  const db = supabaseServer()
  const { data } = await db
    .from('training_progress')
    .select('item_id, status')
    .eq('member_id', memberId)
    .in('item_id', itemIds)
    .eq('status', 'completed')
  return new Set((data ?? []).map((r) => r.item_id as string))
}

/**
 * Published modules visible to the member, optionally filtered by material_kind.
 * Each carries item/completed counts and an entitlement-aware canAccess flag.
 */
export async function listModules(
  member: CommunityMember,
  filter?: { materialKind?: MaterialKind; eventRef?: string }
): Promise<TrainingModuleSummary[]> {
  const db = supabaseServer()
  let q = db
    .from('training_modules')
    .select('id, title, description, material_kind, event_ref, min_tier_rank, training_items(id)')
    .eq('is_published', true)
    .order('display_order', { ascending: true })

  if (filter?.materialKind) q = q.eq('material_kind', filter.materialKind)
  if (filter?.eventRef) q = q.eq('event_ref', filter.eventRef)

  const { data: modules } = await q
  if (!modules) return []

  type Row = {
    id: string
    title: string
    description: string | null
    material_kind: MaterialKind
    event_ref: string | null
    min_tier_rank: number
    training_items: { id: string }[]
  }

  const rows = modules as unknown as Row[]
  const allItemIds = rows.flatMap((m) => m.training_items.map((i) => i.id))
  const completed = await progressMap(member.id, allItemIds)

  const out: TrainingModuleSummary[] = []
  for (const m of rows) {
    const itemIds = m.training_items.map((i) => i.id)
    const canAccess = await memberCanAccess(
      member,
      'training_module',
      m.id,
      m.min_tier_rank,
      'view'
    )
    out.push({
      id: m.id,
      title: m.title,
      description: m.description,
      material_kind: m.material_kind,
      event_ref: m.event_ref,
      itemCount: itemIds.length,
      completedCount: itemIds.filter((id) => completed.has(id)).length,
      canAccess,
    })
  }
  return out
}

export interface ModuleDetail extends TrainingModuleSummary {
  items: TrainingItem[]
}

/** Full module with ordered items + per-item completion for the member. */
export async function getModule(
  member: CommunityMember,
  moduleId: string
): Promise<ModuleDetail | null> {
  const db = supabaseServer()
  const { data: m } = await db
    .from('training_modules')
    .select('id, title, description, material_kind, event_ref, min_tier_rank, is_published')
    .eq('id', moduleId)
    .maybeSingle()
  if (!m || !m.is_published) return null

  const { data: items } = await db
    .from('training_items')
    .select('id, title, content_kind, external_url, estimated_minutes, display_order')
    .eq('module_id', moduleId)
    .order('display_order', { ascending: true })

  const itemRows = items ?? []
  const completed = await progressMap(member.id, itemRows.map((i) => i.id))
  const canAccess = await memberCanAccess(
    member,
    'training_module',
    m.id,
    m.min_tier_rank,
    'view'
  )

  return {
    id: m.id,
    title: m.title,
    description: m.description,
    material_kind: m.material_kind as MaterialKind,
    event_ref: m.event_ref,
    itemCount: itemRows.length,
    completedCount: itemRows.filter((i) => completed.has(i.id)).length,
    canAccess,
    items: itemRows.map((i) => ({
      id: i.id,
      title: i.title,
      content_kind: i.content_kind as TrainingItem['content_kind'],
      external_url: i.external_url,
      estimated_minutes: i.estimated_minutes,
      display_order: i.display_order,
      completed: completed.has(i.id),
    })),
  }
}

/**
 * Modules assigned to the member for events they're registered for, resolved by
 * their event_role against training_assignments. Surfaces mandatory items + due
 * dates for the "what must I complete before my event" view.
 */
export async function getAssignedModules(
  member: CommunityMember,
  opts: { eventRefs: string[]; eventRoles: string[] }
): Promise<TrainingModuleSummary[]> {
  if (opts.eventRefs.length === 0) return []
  const db = supabaseServer()

  const { data: assignments } = await db
    .from('training_assignments')
    .select('module_id, event_ref, event_role, is_mandatory, due_at')
    .in('event_ref', opts.eventRefs)
    .in('event_role', [...opts.eventRoles, 'all'])

  if (!assignments || assignments.length === 0) return []

  const moduleIds = [...new Set(assignments.map((a) => a.module_id as string))]
  const allModules = await listModules(member)
  const byId = new Map(allModules.map((m) => [m.id, m]))

  return assignments
    .map((a): TrainingModuleSummary | null => {
      const base = byId.get(a.module_id as string)
      if (!base) return null
      return { ...base, isMandatory: a.is_mandatory as boolean, dueAt: a.due_at as string | null }
    })
    .filter((m): m is TrainingModuleSummary => m !== null)
}

/** Resolve an item to a signed download URL after an access check. */
export async function getItemDownload(
  member: CommunityMember,
  itemId: string
): Promise<{ url: string; title: string } | { error: string; status: number }> {
  const db = supabaseServer()
  const { data: item } = await db
    .from('training_items')
    .select('id, title, storage_path, content_kind, module_id, training_modules(min_tier_rank)')
    .eq('id', itemId)
    .maybeSingle()

  if (!item || !item.storage_path) return { error: 'Not found', status: 404 }

  const mod = Array.isArray(item.training_modules) ? item.training_modules[0] : item.training_modules
  const minRank = (mod as { min_tier_rank?: number } | null)?.min_tier_rank ?? 0

  const ok = await memberCanAccess(
    member,
    'training_module',
    item.module_id as string,
    minRank,
    'view'
  )
  if (!ok) return { error: 'Upgrade required', status: 403 }

  const url = await signedDownloadUrl(item.storage_path)
  if (!url) return { error: 'Could not generate link', status: 500 }
  return { url, title: item.title }
}
