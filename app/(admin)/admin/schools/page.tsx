import { supabaseServer } from '@/lib/supabase'
import Link from 'next/link'

export const metadata = { title: 'Admin — Schools' }

export default async function AdminSchoolsPage() {
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

      <div className="bg-white rounded-xl border border-brand-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-brand-hairline bg-brand-canvas text-left">
              <th className="px-4 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Name</th>
              <th className="px-4 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">City</th>
              <th className="px-4 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">State</th>
              <th className="px-4 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Postcode</th>
              <th className="px-4 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-hairline">
            {[...active, ...inactive].map((school) => (
              <tr key={school.id} className="hover:bg-brand-canvas">
                <td className="px-4 py-3 font-medium text-brand-blue-dark">
                  <Link href={`/admin/schools/${school.id}`} className="text-brand-blue hover:text-brand-blue">
                    {school.name}
                  </Link>
                  {school.address_line1 && (
                    <p className="text-xs text-brand-muted-soft font-normal mt-0.5">
                      {[school.address_line1, school.address_line2].filter(Boolean).join(', ')}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-brand-muted">{school.city ?? '—'}</td>
                <td className="px-4 py-3 text-brand-muted">{school.state ?? '—'}</td>
                <td className="px-4 py-3 text-brand-muted">{school.postcode ?? '—'}</td>
                <td className="px-4 py-3">
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
