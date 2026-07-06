import { notFound, redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { getSpaceForMember, type SpaceRole } from '@/lib/spaces'
import { getActiveTierNames } from '@/lib/tiers-server'
import { supabaseServer } from '@/lib/supabase'
import { Avatar } from '@/components/ui/Avatar'
import { SpaceShell } from '@/components/community/spaces/SpaceShell'
import { LockedSpaceGate } from '@/components/community/spaces/LockedSpaceGate'
import { TierPill, RolePill } from '@/components/community/spaces/badges'

export const dynamic = 'force-dynamic'

const ROLE_ORDER: Record<SpaceRole, number> = { admin: 0, moderator: 1, member: 2 }

export default async function SpaceMembersPage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>
}) {
  const { spaceSlug } = await params
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const space = await getSpaceForMember(member, spaceSlug)
  if (!space) notFound()
  if (!space.access.canAccess) return <LockedSpaceGate space={space} />

  const db = supabaseServer()
  const { data } = await db
    .from('community_space_members')
    .select('member_id, role, members:member_id(first_name, last_name)')
    .eq('space_id', space.id)
    .eq('status', 'active')

  type Rel = { first_name: string | null; last_name: string | null }
  type Row = { member_id: string; role: SpaceRole; members: Rel | Rel[] | null }
  const rows = ((data ?? []) as unknown as Row[]).map((r) => {
    const m = Array.isArray(r.members) ? r.members[0] ?? null : r.members
    return {
      id: r.member_id,
      role: r.role,
      name: m ? [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Member' : 'Member',
    }
  })

  const tierNames = await getActiveTierNames(rows.map((r) => r.id))
  rows.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name))

  return (
    <SpaceShell space={space} activeKey="members">
      <div className="mx-auto max-w-[760px]">
        <h1 className="mb-4 font-heading text-[21px] text-brand-blue-dark">
          Members <span className="text-brand-muted-soft">· {rows.length}</span>
        </h1>
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-brand-muted-soft">No members yet.</p>
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-[14px] border border-brand-border bg-white p-3">
                <Avatar id={r.id} name={r.name} size="md" ring={false} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-subheading font-semibold text-brand-blue-dark">{r.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {tierNames.get(r.id) && <TierPill name={tierNames.get(r.id)!} />}
                    {r.role !== 'member' && <RolePill role={r.role} />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SpaceShell>
  )
}
