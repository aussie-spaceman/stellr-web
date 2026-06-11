export interface MyRegistrationRow {
  id: string
  eventTitle: string
  status: string
  type: string
  checkedInAt: string | null
  company: { number: number; name: string | null } | null
}

// Read-only list of the member's current event registrations, including the
// Company they've been assigned to once the Event Manager runs assignment.
export function MyRegistrations({ registrations }: { registrations: MyRegistrationRow[] }) {
  if (registrations.length === 0) return null

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-4 text-base font-semibold text-gray-900">My Event Registrations</h2>
      <ul className="divide-y divide-gray-100">
        {registrations.map((r) => (
          <li key={r.id} className="py-3 flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-48">
              <p className="font-medium text-gray-900">{r.eventTitle}</p>
              <p className="text-xs text-gray-400 capitalize">{r.type} registration</p>
            </div>
            {r.company && (
              <span className="inline-flex text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-100 text-indigo-700">
                {r.company.name ? `Company ${r.company.number} — ${r.company.name}` : `Company ${r.company.number}`}
              </span>
            )}
            <span
              className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${
                r.checkedInAt
                  ? 'bg-green-100 text-green-700'
                  : r.status === 'confirmed'
                    ? 'bg-orange-100 text-orange-700'
                    : 'bg-gray-100 text-gray-500'
              }`}
            >
              {r.checkedInAt ? 'Checked In' : r.status === 'confirmed' ? 'Registered' : 'Pending'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
