import Link from 'next/link'
import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { getAllEvents, getAllCampaigns, type StellarEvent } from '@/lib/sanity'
import { requireEventAccess } from '@/lib/event-access'

export const metadata = { title: 'Admin — Events' }
export const dynamic = 'force-dynamic'

interface CampaignEvent {
  _id: string
  title: string
  slug: { current: string }
  season?: string
  campaignYear?: number
  registrationOpen?: boolean
}

import { formatDate as formatEventDate, registrationStatus } from '@/lib/utils'
import { campaignStatus, seasonLabel } from '@/lib/campaigns'

function formatDate(date?: string) {
  return date ? formatEventDate(date) : '—'
}

// On a phone each table scrolls sideways inside its card instead of being
// clipped, with the event (the link into it) held at the left edge. The table
// is border-separate because a sticky cell in a collapsed table leaves its
// borders behind when it moves; row lines therefore live on the cells.
const TH = 'whitespace-nowrap border-b border-line-light px-4 py-3 font-medium text-content-muted text-xs uppercase tracking-wide'
const TD = 'border-b border-line-light px-4 py-3 group-last:border-b-0'
const STICKY = 'sticky left-0 z-10 border-r border-line-light'

// Registration pill state.
//   • Campaigns  → campaignStatus(), the same resolver the public pages and the
//                  member portal use. This used to be an inline `registrationOpen
//                  ? Open : Closed`, which disagreed with /curriculum about an
//                  unset toggle: admin said Closed, the public page derived from
//                  dates and could say "Open now" at the same moment.
//   • Live events → derived from the Opens/Closes dates (both empty = open),
//                   matching the public event pages. The manual boolean is
//                   hidden for live events in the CMS, so it must NOT be used
//                   here — doing so made every live event read "Closed".
function registrationPill(event: StellarEvent, isCampaign: boolean): { label: string; className: string } {
  const OPEN = 'bg-green-100 text-green-700'
  const SOON = 'bg-amber-100 text-amber-700'
  const CLOSED = 'bg-brand-hairline text-brand-muted-soft'
  if (isCampaign) {
    switch (campaignStatus(event)) {
      case 'Open':
        return { label: 'Open', className: OPEN }
      case 'Coming soon':
        return { label: 'Coming soon', className: SOON }
      case 'Closed':
        return { label: 'Closed', className: CLOSED }
    }
  }
  switch (registrationStatus(event.registrationOpenDate, event.registrationCloseDate)) {
    case 'open':
      return { label: 'Open', className: OPEN }
    case 'coming-soon':
      return { label: 'Coming soon', className: SOON }
    case 'closed':
      return { label: 'Closed', className: CLOSED }
  }
}

export default async function AdminEventsPage() {
  const access = await requireEventAccess()
  if (!access.ok) redirect(access.status === 401 ? '/sign-in' : '/account')

  const [events, campaigns] = await Promise.all([
    getAllEvents() as Promise<StellarEvent[] | null>,
    getAllCampaigns() as Promise<CampaignEvent[] | null>,
  ])

  // Event Managers only see events they've been assigned to.
  // Documents without a slug (unfinished CMS drafts) are skipped entirely.
  const visible = (list: { slug?: { current?: string } | null }[] | null) =>
    (list ?? []).filter(
      (e) =>
        e.slug?.current &&
        (access.assignedSlugs === null || access.assignedSlugs.includes(e.slug.current))
    )
  const visibleEvents = visible(events) as StellarEvent[]
  const visibleCampaigns = visible(campaigns) as CampaignEvent[]

  // Participant counts per event slug
  const db = supabaseServer()
  const slugs = [...visibleEvents, ...visibleCampaigns].map((e) => e.slug.current)
  const counts = new Map<string, number>()
  if (slugs.length > 0) {
    const { data: regs } = await db
      .from('registrations')
      .select('event_slug, participants(count)')
      .in('event_slug', slugs)
      .neq('status', 'withdrawn')
    for (const reg of regs ?? []) {
      const n = (reg.participants as unknown as { count: number }[])?.[0]?.count ?? 0
      counts.set(reg.event_slug, (counts.get(reg.event_slug) ?? 0) + n)
    }
  }

  const sections = [
    { label: 'Live Events', items: visibleEvents, isCampaign: false },
    { label: 'Campaigns', items: visibleCampaigns as unknown as StellarEvent[], isCampaign: true },
  ]

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-2 text-gold-ink">
            <span className="h-2 w-2 rounded-full bg-brand-orange-alt" /> Competitions
          </p>
          <h1 className="mt-1 font-heading text-ds-h2 text-brand-blue-dark">Events</h1>
          <p className="text-sm text-brand-muted-soft mt-0.5">
            {access.isAdmin
              ? 'All events and campaigns from the CMS'
              : 'Events you are assigned to manage'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
          {access.isAdmin && (
            <Link
              href="/admin/competitions/artwork"
              className="rounded-lg border border-primary px-3 py-1.5 text-sm font-medium text-primary"
            >
              Default artwork
            </Link>
          )}
          <Link
            href="/admin/competitions/check-in-banner"
            className="rounded-lg border border-primary px-3 py-1.5 text-sm font-medium text-primary"
          >
            Check-in banner
          </Link>
        </div>
      </div>

      {sections.map(({ label, items, isCampaign }) => (
        <section key={label} className="space-y-3">
          <h2 className="text-sm font-semibold text-brand-muted">{label}</h2>
          {items.length === 0 ? (
            <p className="text-sm text-brand-muted-soft bg-white rounded-xl border border-brand-border px-4 py-6">
              {access.isAdmin
                ? `No ${label.toLowerCase()} found in the CMS.`
                : `No assigned ${label.toLowerCase()}. Ask an administrator to assign you.`}
            </p>
          ) : (
            <div
              role="region"
              aria-label={label}
              tabIndex={0}
              className="relative overflow-x-auto rounded-ds-card border border-line bg-white focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            >
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead className="bg-surface">
                  <tr className="text-left">
                    <th scope="col" className={`${TH} ${STICKY} bg-surface`}>Event</th>
                    <th scope="col" className={TH}>{isCampaign ? 'Season' : 'Date'}</th>
                    <th scope="col" className={TH}>Location</th>
                    <th scope="col" className={TH}>Registration</th>
                    <th scope="col" className={`${TH} text-right`}>Participants</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((event) => {
                    const slug = event.slug.current
                    const campaign = event as unknown as CampaignEvent
                    return (
                      <tr key={event._id} className="group hover:bg-surface">
                        <td className={`${TD} ${STICKY} min-w-40 bg-white font-medium group-hover:bg-surface`}>
                          <Link prefetch={false} href={`/admin/competitions/${slug}`} className="text-primary hover:underline">
                            {event.title}
                          </Link>
                          <span
                            className={`ml-2 inline-flex whitespace-nowrap text-xs px-2 py-0.5 rounded-full font-medium ${
                              isCampaign ? 'bg-purple-100 text-purple-700' : 'bg-primary/10 text-primary'
                            }`}
                          >
                            {isCampaign ? 'Campaign' : 'Live Event'}
                          </span>
                        </td>
                        <td className={`${TD} whitespace-nowrap text-content-body`}>
                          {isCampaign
                            ? seasonLabel(campaign.season, campaign.campaignYear) || '—'
                            : formatDate(event.date)}
                        </td>
                        <td className={`${TD} min-w-48 text-content-body`}>
                          {[event.venue, event.city, event.state].filter(Boolean).join(', ') || '—'}
                        </td>
                        <td className={`${TD} whitespace-nowrap`}>
                          {(() => {
                            const pill = registrationPill(event, isCampaign)
                            return (
                              <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${pill.className}`}>
                                {pill.label}
                              </span>
                            )
                          })()}
                        </td>
                        <td className={`${TD} text-right text-ink font-medium tabular-nums`}>
                          {counts.get(slug) ?? 0}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
