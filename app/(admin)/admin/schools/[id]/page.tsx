import { supabaseServer } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import Link from 'next/link'

export const metadata = { title: 'Admin — School Detail' }

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
    .map((ms) => ({ ...(ms.members as Record<string, unknown>), is_current_school: ms.is_current }))
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
        <Link href="/admin/schools" className="text-sm text-gray-500 hover:text-gray-700 mb-1 inline-block">
          ← All schools
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{school.name}</h1>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              school.is_active !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
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
          <p className="text-sm text-gray-500 mt-0.5">
            {[school.address_line1, school.address_line2, school.city, school.state, school.postcode]
              .filter(Boolean)
              .join(', ')}
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Members</h2>
          <span className="text-xs text-gray-400">{allMembers.length} active</span>
        </div>

        {allMembers.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400">No members linked to this school.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Name</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Email</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Role</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Tier</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Current</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {allMembers.map((m) => {
                const memberships = m.member_memberships as Array<{ renewal_status: string; membership_tiers: { name: string } }> | null
                const activeTier = memberships?.find((mm) => mm.renewal_status === 'active')?.membership_tiers.name
                return (
                  <tr key={m.id as string} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/members/${m.id}`}
                        className="font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        {m.last_name as string}, {m.first_name as string}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{m.email as string}</td>
                    <td className="px-4 py-3 text-gray-600 capitalize">{label(m.event_role as string)}</td>
                    <td className="px-4 py-3">
                      {activeTier ? (
                        <span
                          className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium"
                          title={TIER_TOOLTIPS[activeTier] ?? `Active membership tier: ${activeTier}`}
                        >
                          {activeTier}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {m.is_current_school ? (
                        <span className="text-xs text-green-600 font-medium" title="This is the member's current school.">Current</span>
                      ) : (
                        <span className="text-xs text-gray-400" title="This was a previous school for this member.">Previous</span>
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
