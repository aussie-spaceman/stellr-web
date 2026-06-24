import { supabaseServer } from '@/lib/supabase'
import { resolveTierMap } from '@/lib/tiers-server'
import { SpacesAdminList, type AdminSpaceRow } from '@/components/admin/community/spaces/SpacesAdminList'
import type { SpaceAccessType, SpaceTheme } from '@/lib/spaces'

export const metadata = { title: 'Admin — Manage Spaces' }
export const dynamic = 'force-dynamic'

export default async function AdminSpacesPage() {
  const db = supabaseServer()
  const [{ data: spaces }, { data: tierRows }, { data: activeRows }, tierMap] = await Promise.all([
    db
      .from('community_spaces')
      .select('id, slug, name, access_type, theme, posting_policy, is_archived')
      .eq('is_archived', false)
      .order('display_order', { ascending: true }),
    db.from('community_space_tiers').select('space_id, tier_id'),
    db.from('community_space_members').select('space_id').eq('status', 'active'),
    resolveTierMap(),
  ])

  const tierNamesBySpace = new Map<string, string[]>()
  for (const t of (tierRows ?? []) as { space_id: string; tier_id: string }[]) {
    const name = tierMap.nameById[t.tier_id]
    if (!name) continue
    const arr = tierNamesBySpace.get(t.space_id) ?? []
    arr.push(name)
    tierNamesBySpace.set(t.space_id, arr)
  }
  const memberCounts = new Map<string, number>()
  for (const r of (activeRows ?? []) as { space_id: string }[]) {
    memberCounts.set(r.space_id, (memberCounts.get(r.space_id) ?? 0) + 1)
  }

  const rows: AdminSpaceRow[] = ((spaces ?? []) as Array<{
    id: string; slug: string; name: string; access_type: SpaceAccessType; theme: SpaceTheme; posting_policy: 'all' | 'moderators'
  }>).map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    access_type: s.access_type,
    theme: s.theme,
    postingPolicy: s.posting_policy,
    memberCount: memberCounts.get(s.id) ?? 0,
    tierNames: tierNamesBySpace.get(s.id) ?? [],
  }))

  return (
    <div>
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow text-brand-muted-soft">Admin · Community</p>
          <h1 className="font-heading uppercase text-title text-brand-blue-dark">Manage Spaces</h1>
        </div>
      </div>
      <p className="mb-5 text-sm text-brand-muted-soft">
        Create and configure community spaces — channels, access, members, resources, training and moderation.
      </p>
      <SpacesAdminList initial={rows} />
    </div>
  )
}
