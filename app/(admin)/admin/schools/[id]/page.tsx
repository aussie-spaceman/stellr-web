import { supabaseServer } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { DeleteEntityButton } from '@/components/admin/DeleteEntityButton'

export const metadata = { title: 'Admin — School Detail' }

const TIER_TOOLTIPS: Record<string, string> = {
  'Explorer': 'Free tier — public content, competition listings, and basic community access.',
  'Pathfinder': 'Paid tier ($60/yr) — full community access and event registration. Also awarded free for one year to event participants.',
  'Scholar': 'Award winner tier ($120/yr) — all Pathfinder benefits plus exclusive content. Awarded to competition winners.',
}

export default async function AdminSchoolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const db = supabaseServer()

  const [{ data: school }, { data: members }] = await Promise.all([
    db
      .from('schools')
      .select('id, name, city, state, postcode, address_line1, address_line2, is_active')
      .eq('id', id)
      .maybeSingle(),
    db
      .from('member_schools')
      .select(`
        is_current,
        members(id, first_name, last_name, email, age_bracket, event_role, is_active,
          member_memberships(renewal_status, membership_tiers(name))
        )
      `)
      .eq('school_id', id),
  ])

  if (!school) notFound()

  const allMembers = (members ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((ms) => ({ ...(ms.members as any), is_current_school: ms.is_current }))
    .filter((m) => m.is_active !== false)
    .sort((a, b) =>
      `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)
    )

  function label(val: string) {
    return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/schools" className="text-sm text-brand-muted-soft hover:text-brand-muted mb-1 inline-block">
          ← All schools
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="font-heading uppercase text-title text-brand-blue-dark">{school.name}</h1>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              school.is_active !== false ? 'bg-green-100 text-green-700' : 'bg-brand-hairline text-brand-muted-soft'
            }`}
            title={
              school.is_active !== false
                ? 'Active — this school is visible in search and can be selected for new registrations.'
                : 'Inactive — this school is hidden from search and cannot be selected for new registrations.'
            }
          >
            {school.is_active !== false ? 'Active' : 'Inactive'}
          </span>
        </div>
        {(school.city || school.state) && (
          <p className="text-sm text-brand-muted-soft mt-0.5">
            {[school.address_line1, school.address_line2, school.city, school.state, school.postcode]
              .filter(Boolean)
              .join(', ')}
          </p>
        )}
        <div className="mt-3">
          <DeleteEntityButton entity="school" id={school.id} name={school.name} redirectTo="/admin/schools" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-brand-border overflow-hidden">
        <div className="px-5 py-4 border-b border-brand-hairline flex items-center justify-between">
          <h2 className="text-sm font-semibold text-brand-muted">Members</h2>
          <span className="text-xs text-brand-muted-soft">{allMembers.length} active</span>
        </div>

        {allMembers.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-brand-muted-soft">No members linked to this school.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-hairline bg-brand-canvas text-left">
                <th className="px-4 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Name</th>
                <th className="px-4 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Email</th>
                <th className="px-4 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Role</th>
                <th className="px-4 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Tier</th>
                <th className="px-4 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Current</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-hairline">
              {allMembers.map((m) => {
                const memberships = m.member_memberships as Array<{ renewal_status: string; membership_tiers: { name: string } }> | null
                const activeTier = memberships?.find((mm) => mm.renewal_status === 'active')?.membership_tiers.name
                return (
                  <tr key={m.id as string} className="hover:bg-brand-canvas">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/members/${m.id}`}
                        className="font-medium text-brand-blue hover:text-brand-blue"
                      >
                        {m.last_name as string}, {m.first_name as string}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-brand-muted-soft">{m.email as string}</td>
                    <td className="px-4 py-3 text-brand-muted capitalize">{label(m.event_role as string)}</td>
                    <td className="px-4 py-3">
                      {activeTier ? (
                        <span
                          className="text-xs bg-brand-blue/5 text-brand-blue px-2 py-0.5 rounded-full font-medium"
                          title={TIER_TOOLTIPS[activeTier] ?? `Active membership tier: ${activeTier}`}
                        >
                          {activeTier}
                        </span>
                      ) : (
                        <span className="text-xs text-brand-muted-soft">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {m.is_current_school ? (
                        <span className="text-xs text-green-600 font-medium" title="This is the member's current school.">Current</span>
                      ) : (
                        <span className="text-xs text-brand-muted-soft" title="This was a previous school for this member.">Previous</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
