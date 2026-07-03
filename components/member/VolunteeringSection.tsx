import Link from 'next/link'
import { HandHeart } from 'lucide-react'
import type { VolunteerStatus, VolunteerTrainingProgress } from '@/lib/volunteer'

interface Assignment {
  event_slug: string | null
  event_title: string | null
  event_year: number | null
}

interface Interest {
  event_slug: string
  event_title: string
  created_at: string
}

interface Props {
  assignments: Assignment[]
  interests: Interest[]
  status: VolunteerStatus
  training: VolunteerTrainingProgress
}

function Pill({ tone, label }: { tone: 'green' | 'amber' | 'red' | 'grey'; label: string }) {
  const cls = {
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
    grey: 'bg-brand-hairline text-brand-muted-soft',
  }[tone]
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  )
}

// "My volunteering" card on /account (PRD §15): the member's volunteer standing
// (agreement + training), events they're assigned to, and open offers to help.
export function VolunteeringSection({ assignments, interests, status, training }: Props) {
  return (
    <div className="rounded-xl border border-brand-border bg-white p-5">
      <div className="mb-1 flex items-center gap-2">
        <HandHeart className="h-4 w-4 text-brand-blue" />
        <h2 className="text-base font-semibold text-brand-blue-dark">My volunteering</h2>
      </div>
      <p className="mb-4 text-xs text-brand-muted-soft">
        Your volunteer standing, assignments, and open offers.{' '}
        <Link href="/community/events" className="text-brand-blue hover:underline">
          Browse events you can support →
        </Link>
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand-muted">Agreement</span>
        {status.agreement === 'complete' && <Pill tone="green" label="Signed" />}
        {status.agreement === 'in_flight' && <Pill tone="amber" label="Awaiting your signature" />}
        {status.agreement === 'missing' && <Pill tone="red" label="Not signed" />}

        <span className="ml-3 text-xs font-semibold uppercase tracking-wide text-brand-muted">Training</span>
        {training.total === 0 ? (
          <Pill tone="grey" label="Not assigned yet" />
        ) : training.completed >= training.total ? (
          <Pill tone="green" label="Complete" />
        ) : (
          <Link href="/community/training" title="Continue your volunteer training">
            <Pill tone="amber" label={`${training.completed}/${training.total} lessons — continue`} />
          </Link>
        )}
      </div>

      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand-muted">
        Assigned events
      </h3>
      {assignments.length === 0 ? (
        <p className="mb-3 text-sm text-brand-muted-soft">
          No assignments yet — once an admin confirms you for an event it appears here.
        </p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {assignments.map((a) => (
            <li
              key={`${a.event_slug}-${a.event_year}`}
              className="flex items-center justify-between rounded-lg border border-brand-hairline px-3 py-1.5 text-sm"
            >
              <span className="font-medium text-brand-blue-dark">
                {a.event_slug ? (
                  <Link href={`/community/events/${a.event_slug}`} className="hover:underline">
                    {a.event_title ?? a.event_slug}
                  </Link>
                ) : (
                  a.event_title
                )}
              </span>
              {a.event_year && <span className="text-xs text-brand-muted-soft">{a.event_year}</span>}
            </li>
          ))}
        </ul>
      )}

      {interests.length > 0 && (
        <>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand-muted">
            Open offers
          </h3>
          <ul className="space-y-1.5">
            {interests.map((i) => (
              <li key={i.event_slug} className="flex items-center justify-between rounded-lg border border-brand-hairline px-3 py-1.5 text-sm">
                <span className="text-brand-muted">{i.event_title}</span>
                <Pill tone="amber" label="Awaiting confirmation" />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
