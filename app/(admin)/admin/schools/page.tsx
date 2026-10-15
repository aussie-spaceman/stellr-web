import { supabaseServer } from '@/lib/supabase'
import Link from 'next/link'
import { requireAdminPage } from '@/lib/admin-auth'

export const metadata = { title: 'Admin — Schools' }

// On a phone the table scrolls sideways inside its card instead of being
// clipped, with the school name (the link into it) held at the left edge.
// border-separate: a sticky cell in a collapsed table leaves its borders
// behind when it moves, so row lines live on the cells.
const TH = 'whitespace-nowrap border-b border-line-light px-4 py-3 font-medium text-content-muted text-xs uppercase tracking-wide'
const TD = 'border-b border-line-light px-4 py-3 group-last:border-b-0'
const STICKY = 'sticky left-0 z-10 border-r border-line-light'

export default async function AdminSchoolsPage() {
  await requireAdminPage()
  const db = supabaseServer()

  const { data: schools } = await db
    .from('schools')
    .select('id, name, city, state, postcode, address_line1, address_line2, is_active')
    .order('name')

  const active = (schools ?? []).filter((s) => s.is_active !== false)
  const inactive = (schools ?? []).filter((s) => s.is_active === false)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading uppercase text-title text-brand-blue-dark">Schools</h1>
          <p className="text-sm text-brand-muted-soft mt-0.5">{active.length} active</p>
        </div>
      </div>

      <div
        role="region"
        aria-label="Schools"
        tabIndex={0}
        className="relative overflow-x-auto rounded-ds-card border border-line bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead className="bg-surface">
            <tr className="text-left">
              <th scope="col" className={`${TH} ${STICKY} bg-surface`}>Name</th>
              <th scope="col" className={TH}>City</th>
              <th scope="col" className={TH}>State</th>
              <th scope="col" className={TH}>Postcode</th>
              <th scope="col" className={TH}>Status</th>
            </tr>
          </thead>
          <tbody>
            {[...active, ...inactive].map((school) => (
              <tr key={school.id} className="group hover:bg-surface">
                <td className={`${TD} ${STICKY} min-w-40 bg-white font-medium group-hover:bg-surface`}>
                  <Link href={`/admin/schools/${school.id}`} className="text-primary hover:underline">
                    {school.name}
                  </Link>
                  {school.address_line1 && (
                    <p className="text-xs text-content-muted font-normal mt-0.5">
                      {[school.address_line1, school.address_line2].filter(Boolean).join(', ')}
                    </p>
                  )}
                </td>
                <td className={`${TD} whitespace-nowrap text-content-body`}>{school.city ?? '—'}</td>
                <td className={`${TD} whitespace-nowrap text-content-body`}>{school.state ?? '—'}</td>
                <td className={`${TD} whitespace-nowrap text-content-body`}>{school.postcode ?? '—'}</td>
                <td className={`${TD} whitespace-nowrap`}>
                  <span
                    className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${
                      school.is_active !== false
                        ? 'bg-green-100 text-green-700'
                        : 'bg-brand-hairline text-brand-muted-soft'
                    }`}
                    title={
                      school.is_active !== false
                        ? 'Active — this school is visible in search and can be selected for new registrations.'
                        : 'Inactive — this school is hidden from search and cannot be selected for new registrations.'
                    }
                  >
                    {school.is_active !== false ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {(schools ?? []).length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-brand-muted-soft">No schools found.</div>
        )}
      </div>
    </div>
  )
}
