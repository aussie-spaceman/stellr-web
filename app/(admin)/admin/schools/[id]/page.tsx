import { supabaseServer } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { DeleteEntityButton } from '@/components/admin/DeleteEntityButton'
import { SchoolEditForm } from '@/components/admin/SchoolEditForm'
import { requireAdminPage } from '@/lib/admin-auth'

export const metadata = { title: 'Admin — School Detail' }

const TH = 'whitespace-nowrap border-b border-line-light px-4 py-3 font-medium text-content-muted text-xs uppercase tracking-wide'
const TD = 'border-b border-line-light px-4 py-3 group-last:border-b-0'
const STICKY = 'sticky left-0 z-10 border-r border-line-light'

const TIER_TOOLTIPS: Record<string, string> = {
  'Explorer': 'Free tier — public content, competition listings, and basic community access.',
  'Pathfinder': 'Paid tier ($59/yr) — full community access and event registration. Also awarded free for one year to event participants.',
  'Scholar': 'Award winner tier ($119/yr) — all Pathfinder benefits plus exclusive content. Awarded to competition winners.',
}

export default async function AdminSchoolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminPage()
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js types the joined `members` row as an array; it is one object here
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
          <h1 className="font-heading text-ds-h2 text-brand-blue-dark">{school.name}</h1>
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
        {(school.address_line1 || school.city || school.state) && (
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

      <SchoolEditForm school={school} />

      <div className="bg-white rounded-xl border border-brand-border overflow-hidden">
        <div className="px-5 py-4 border-b border-brand-hairline flex items-center justify-between">
          <h2 className="text-sm font-semibold text-brand-muted">Members</h2>
          <span className="text-xs text-brand-muted-soft">{allMembers.length} active</span>
        </div>

        {allMembers.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-brand-muted-soft">No members linked to this school.</div>
        ) : (
          // Scrolls sideways on a phone; the name (the link to the member) stays
          // at the left edge. border-separate keeps the sticky cell's borders on it.
          <div
            role="region"
            aria-label={`Members of ${school.name}`}
            tabIndex={0}
            className="relative overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          >
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead className="bg-surface">
                <tr className="text-left">
                  <th scope="col" className={`${TH} ${STICKY} bg-surface`}>Name</th>
                  <th scope="col" className={TH}>Email</th>
                  <th scope="col" className={TH}>Role</th>
                  <th scope="col" className={TH}>Tier</th>
                  <th scope="col" className={TH}>Current</th>
                </tr>
              </thead>
              <tbody>
                {allMembers.map((m) => {
                  const memberships = m.member_memberships as Array<{ renewal_status: string; membership_tiers: { name: string } }> | null
                  const activeTier = memberships?.find((mm) => mm.renewal_status === 'active')?.membership_tiers.name
                  return (
                    <tr key={m.id as string} className="group hover:bg-surface">
                      <td className={`${TD} ${STICKY} bg-white group-hover:bg-surface`}>
                        <Link
                          href={`/admin/members/${m.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {m.last_name as string}, {m.first_name as string}
                        </Link>
                      </td>
                      <td className={`${TD} whitespace-nowrap text-content-muted`}>{m.email as string}</td>
                      <td className={`${TD} whitespace-nowrap text-content-body capitalize`}>{label(m.event_role as string)}</td>
                      <td className={`${TD} whitespace-nowrap`}>
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
                      <td className={`${TD} whitespace-nowrap`}>
                        {m.is_current_school ? (
                          <span className="text-xs text-green-600 font-medium" title="This is the member's current school.">Current</span>
                        ) : (
                          <span className="text-xs text-content-muted" title="This was a previous school for this member.">Previous</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
