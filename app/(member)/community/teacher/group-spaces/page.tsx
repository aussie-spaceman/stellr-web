import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { getTeacherGroups, getGroupSpaceAccess } from '@/lib/teacher-spaces'
import { resolveTierMap } from '@/lib/tiers-server'
import { Avatar, AvatarStack } from '@/components/ui/Avatar'
import { EmptyState } from '@/components/ui/EmptyState'
import { AccessBadge, ThemeDot, TierPill } from '@/components/community/spaces/badges'
import { GroupSwitcher } from '@/components/community/spaces/GroupSwitcher'

export const metadata = { title: 'Teacher Tools · Group spaces' }
export const dynamic = 'force-dynamic'

export default async function GroupSpacesPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>
}) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const groups = await getTeacherGroups(member)

  // Only teachers / group owners reach this surface.
  if (groups.length === 0 && member.event_role !== 'teacher') redirect('/community')

  const { group } = await searchParams
  const active = groups.find((g) => g.id === group) ?? groups[0] ?? null
  const tierMap = await resolveTierMap()
  const rows = active ? await getGroupSpaceAccess(active, tierMap.nameById) : []

  return (
    <div className="mx-auto max-w-[1080px]">
      <header className="mb-6">
        <p className="eyebrow flex items-center gap-2" style={{ color: '#7C5CFC' }}>
          <span className="h-2 w-2 rounded-full" style={{ background: '#7C5CFC' }} /> Teacher Tools
        </p>
        <h1 className="mt-1 font-heading text-title text-brand-blue-dark">Spaces my group can access</h1>
        <p className="mt-1 text-sm text-brand-muted-soft">
          Access is automatic by each student&apos;s membership tier. This view is read-only.
        </p>
      </header>

      {!active ? (
        <EmptyState title="No group registrations found yet." />
      ) : (
        <>
          {/* Group card */}
          <div className="mb-6 rounded-[16px] border border-brand-border bg-white p-[18px]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-heading text-[17px] text-brand-blue-dark">{active.name}</h2>
                <p className="text-xs text-brand-muted-soft">
                  {active.students.length} student{active.students.length === 1 ? '' : 's'}
                </p>
              </div>
              <GroupSwitcher groups={groups.map((g) => ({ id: g.id, name: g.name }))} current={active.id} />
            </div>
            {active.students.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {active.students.map((s) => (
                  <span
                    key={s.participantId}
                    className="flex items-center gap-2 rounded-full border border-brand-border bg-white py-1 pl-1 pr-2.5"
                  >
                    <Avatar id={s.memberId ?? s.participantId} name={s.name} size="sm" ring={false} />
                    <span className="text-xs font-subheading font-semibold text-brand-blue-dark">{s.name}</span>
                    {s.tierName && <TierPill name={s.tierName} />}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Access table */}
          <div className="overflow-hidden rounded-[16px] border border-brand-border bg-white">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-brand-hairline text-xs uppercase tracking-[0.05em] text-brand-muted-soft">
                  <th className="px-4 py-3 font-subheading font-semibold">Space</th>
                  <th className="px-4 py-3 font-subheading font-semibold">Access</th>
                  <th className="px-4 py-3 font-subheading font-semibold">Required tier</th>
                  <th className="px-4 py-3 font-subheading font-semibold">Group access</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-brand-hairline last:border-0">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        <ThemeDot theme={r.theme} size={14} />
                        <span className="font-subheading font-semibold text-brand-blue-dark">{r.name}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <AccessBadge type={r.access_type} size="sm" />
                    </td>
                    <td className="px-4 py-3 text-brand-muted">{r.requiredTierText}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-brand-muted">
                          {r.qualifying.length}/{r.total}
                        </span>
                        {r.qualifying.length > 0 && (
                          <AvatarStack
                            people={r.qualifying.slice(0, 5).map((q) => ({ id: q.id, name: q.name }))}
                            extra={Math.max(0, r.qualifying.length - 5)}
                            label="students"
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-brand-muted-soft">
                      No spaces to show.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
