import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CalendarDays, Repeat } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getMemberEvents, type PortalEvent } from '@/lib/event-portal'

export const metadata = { title: 'Community · Events' }

function EventCard({ e }: { e: PortalEvent }) {
  const isCampaign = e.activityType === 'campaign'
  const Icon = isCampaign ? Repeat : CalendarDays
  return (
    <Link
      href={`/community/events/${e.slug}`}
      className="block rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300"
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">{e.title}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                isCampaign ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
              }`}
            >
              {isCampaign ? 'Campaign' : 'Live Event'}
            </span>
          </div>
          {e.date && (
            <p className="mt-0.5 text-sm text-gray-500">
              {new Date(e.date).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}

// FR-COM-13 — Event & Campaign portal.
// Lists the events/campaigns the member is registered for, so they can open each
// one and access the gated material attached to it.
export default async function EventsPortalPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const events = await getMemberEvents(member)
  const live = events.filter((e) => e.activityType !== 'campaign')
  const campaigns = events.filter((e) => e.activityType === 'campaign')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Events &amp; Campaigns</h1>
        <p className="mt-1 text-sm text-gray-500">
          Access materials and resources for the events and campaigns you&apos;re registered for.
        </p>
      </div>

      {events.length === 0 && (
        <p className="text-sm text-gray-500">
          You&apos;re not registered for any events yet.{' '}
          <Link href="/competitions" className="text-blue-600 underline">
            Browse competitions
          </Link>
          .
        </p>
      )}

      {live.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Live events
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {live.map((e) => (
              <EventCard key={e.slug} e={e} />
            ))}
          </div>
        </section>
      )}

      {campaigns.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Campaigns
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {campaigns.map((e) => (
              <EventCard key={e.slug} e={e} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
