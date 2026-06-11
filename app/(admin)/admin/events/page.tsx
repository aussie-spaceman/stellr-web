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

import { formatDate as formatEventDate } from '@/lib/utils'

function formatDate(date?: string) {
  return date ? formatEventDate(date) : '—'
}

export default async function AdminEventsPage() {
  const access = await requireEventAccess()
  if (!access.ok) redirect(access.status === 401 ? '/sign-in' : '/account')

  const [events, campaigns] = await Promise.all([
    getAllEvents() as Promise<StellarEvent[] | null>,
    getAllCampaigns() as Promise<CampaignEvent[] | null>,
  ])

  // Event Managers only see events they've been assigned to
  const visible = (list: { slug: { current: string } }[] | null) =>
    (list ?? []).filter(
      (e) => access.assignedSlugs === null || access.assignedSlugs.includes(e.slug.current)
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
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Events</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {access.isAdmin
            ? 'All events and campaigns from the CMS'
            : 'Events you are assigned to manage'}
        </p>
      </div>

      {sections.map(({ label, items, isCampaign }) => (
        <section key={label} className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{label}</h2>
          {items.length === 0 ? (
            <p className="text-sm text-gray-400 bg-white rounded-xl border border-gray-200 px-4 py-6">
              {access.isAdmin
                ? `No ${label.toLowerCase()} found in the CMS.`
                : `No assigned ${label.toLowerCase()}. Ask an administrator to assign you.`}
            </p>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left">
                    <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Event</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">
                      {isCampaign ? 'Season' : 'Date'}
                    </th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Location</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Registration</th>
                    <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide text-right">Participants</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((event) => {
                    const slug = event.slug.current
                    const campaign = event as unknown as CampaignEvent
                    return (
                      <tr key={event._id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">
                          <Link href={`/admin/events/${slug}`} className="text-indigo-600 hover:text-indigo-800">
                            {event.title}
                          </Link>
                          <span
                            className={`ml-2 inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${
                              isCampaign ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                            }`}
                          >
                            {isCampaign ? 'Campaign' : 'Live Event'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {isCampaign
                            ? [campaign.season, campaign.campaignYear].filter(Boolean).join(' ') || '—'
                            : formatDate(event.date)}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {[event.venue, event.city, event.state].filter(Boolean).join(', ') || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${
                              event.registrationOpen
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {event.registrationOpen ? 'Open' : 'Closed'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-900 font-medium tabular-nums">
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
