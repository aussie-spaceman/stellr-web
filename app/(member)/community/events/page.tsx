import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CalendarDays, Repeat, ArrowUpRight } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getMemberEventCatalog, type CatalogEvent } from '@/lib/event-portal'

export const metadata = { title: 'Events & Campaigns' }

const WWW = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

function StatusBadge({ status }: { status: CatalogEvent['status'] }) {
  const map = {
    open: { label: 'Registration open', cls: 'bg-green-100 text-green-700' },
    'coming-soon': { label: 'Opening soon', cls: 'bg-amber-100 text-amber-700' },
    closed: { label: 'Registration closed', cls: 'bg-gray-100 text-gray-500' },
  }[status]
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${map.cls}`}>
      {map.label}
    </span>
  )
}

function EventCard({ e }: { e: CatalogEvent }) {
  const isCampaign = e.activityType === 'campaign'
  const Icon = isCampaign ? Repeat : CalendarDays

  // Registered events open the in-app materials portal; everything else sends
  // the member to the public website to learn more / register.
  const href = e.registered ? `/community/events/${e.slug}` : `${WWW}/events/${e.slug}`
  const external = !e.registered

  const inner = (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-gray-900">{e.title}</h3>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              isCampaign ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
            }`}
          >
            {isCampaign ? 'Campaign' : 'Live Event'}
          </span>
          {external && <ArrowUpRight className="h-3.5 w-3.5 text-gray-400" />}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {e.date && (
            <p className="text-sm text-gray-500">
              {new Date(e.date).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
              {e.city ? ` · ${e.city}${e.state ? `, ${e.state}` : ''}` : ''}
            </p>
          )}
          {e.registered ? (
            <span className="rounded-full bg-brand-blue/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-blue">
              Registered
            </span>
          ) : (
            <StatusBadge status={e.status} />
          )}
        </div>
      </div>
    </div>
  )

  const className =
    'block rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300'

  return external ? (
    <a href={href} className={className}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={className}>
      {inner}
    </Link>
  )
}

// FR-COM-13 — Event & Campaign catalog (served in-app at /events).
// Shows the events/campaigns the member is registered for AND everything else
// available in the next 12 months. Selecting an unregistered item redirects to
// the public website; registered items open the in-app materials portal.
export default async function EventsPortalPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const catalog = await getMemberEventCatalog(member)
  const registered = catalog.filter((e) => e.registered)
  const available = catalog.filter((e) => !e.registered)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Events &amp; Campaigns</h1>
        <p className="mt-1 text-sm text-gray-500">
          Your registrations, plus everything coming up in the next 12 months.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Your events &amp; campaigns
        </h2>
        {registered.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {registered.map((e) => (
              <EventCard key={e.slug} e={e} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            You&apos;re not registered for anything yet — browse what&apos;s coming up below.
          </p>
        )}
      </section>

      {available.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Browse events &amp; campaigns
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {available.map((e) => (
              <EventCard key={e.slug} e={e} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
