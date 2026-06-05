'use client'

interface Participation {
  id: string
  event_year: number | null
  event_location: string | null
  team_name: string | null
  award: string | null
}

interface Props {
  participations: Participation[]
}

export function EventHistory({ participations }: Props) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-4">Event History</h2>

      {participations.length === 0 ? (
        <p className="text-sm text-gray-500">No events recorded yet.</p>
      ) : (
        <div className="space-y-3">
          {participations
            .sort((a, b) => (b.event_year ?? 0) - (a.event_year ?? 0))
            .map((p) => (
              <div
                key={p.id}
                className="flex items-start justify-between py-3 border-b border-gray-100 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {p.event_year ?? '—'}
                    {p.event_location ? ` · ${p.event_location}` : ''}
                  </p>
                  {p.team_name && (
                    <p className="text-xs text-gray-500 mt-0.5">Company: {p.team_name}</p>
                  )}
                </div>
                {p.award && (
                  <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full font-medium shrink-0">
                    {p.award}
                  </span>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
