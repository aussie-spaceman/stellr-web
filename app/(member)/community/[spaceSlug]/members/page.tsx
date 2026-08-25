import { notFound, redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { getSpaceForMember, resolveSpaceAudiences, type SpaceRole } from '@/lib/spaces'
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

  // Everyone who can enter, not only the roster table — tier and role access is
  // resolved at read time and writes no roster row, so reading the table alone
  // showed "No members yet" on every tier and role Space.
  const audience = (await resolveSpaceAudiences([space.id])).get(space.id) ?? []

  const db = supabaseServer()
  const { data } = audience.length
    ? await db
        .from('members')
        .select('id, first_name, last_name')
        .in('id', audience.map((a) => a.memberId))
    : { data: [] }

  type Row = { id: string; first_name: string | null; last_name: string | null }
  const nameById = new Map(
    ((data ?? []) as Row[]).map((m) => [
      m.id,
      [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Member',
    ]),
  )
  const rows = audience.map((a) => ({
    id: a.memberId,
    role: a.role,
    name: nameById.get(a.memberId) ?? 'Member',
  }))

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
