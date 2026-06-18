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
    <div className="rounded-xl border border-brand-border bg-white p-5">
      <h2 className="mb-4 text-base font-semibold text-brand-blue-dark">My Event Registrations</h2>
      <ul className="divide-y divide-brand-hairline">
        {registrations.map((r) => (
          <li key={r.id} className="py-3 flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-48">
              <p className="font-medium text-brand-blue-dark">{r.eventTitle}</p>
              <p className="text-xs text-brand-muted-soft capitalize">{r.type} registration</p>
            </div>
            {r.company && (
              <span className="inline-flex text-xs px-2 py-0.5 rounded-full font-medium bg-brand-blue/10 text-brand-blue">
                {r.company.name ? `Company ${r.company.number} — ${r.company.name}` : `Company ${r.company.number}`}
              </span>
            )}
            <span
              className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${
                r.checkedInAt
                  ? 'bg-green-100 text-green-700'
                  : r.status === 'confirmed'
                    ? 'bg-orange-100 text-orange-700'
                    : 'bg-brand-hairline text-brand-muted-soft'
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
