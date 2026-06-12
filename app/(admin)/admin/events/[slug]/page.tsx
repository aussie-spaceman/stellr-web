import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { clerkClient } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug, type StellarEvent } from '@/lib/sanity'
import { formatDate } from '@/lib/utils'
import { requireEventAccess } from '@/lib/event-access'
import { getEventRoster } from '@/lib/event-admin'
import EventRoster from '@/components/admin/EventRoster'
import EventManagerAssignments from '@/components/admin/EventManagerAssignments'
import EventCompanies, { type CompanyRow } from '@/components/admin/EventCompanies'
import EventBadges from '@/components/admin/EventBadges'
import { RefundPolicyEditor } from '@/components/admin/RefundPolicyEditor'
import { DEFAULT_TIERS, type RefundTier } from '@/lib/refunds/policy'

export const metadata = { title: 'Admin — Event' }
export const dynamic = 'force-dynamic'

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: 'red' | 'green' }) {
  const valueColor = accent === 'red' ? 'text-red-600' : accent === 'green' ? 'text-green-600' : 'text-gray-900'
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${valueColor}`}>{value}</p>
    </div>
  )
}

export default async function AdminEventDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const access = await requireEventAccess(slug)
  if (!access.ok) redirect(access.status === 401 ? '/sign-in' : '/admin/events')

  const event = (await getEventBySlug(slug)) as (StellarEvent & { activityType?: string }) | null
  if (!event) notFound()

  const roster = await getEventRoster(slug, event.date)
  const { summary } = roster

  const db = supabaseServer()
  const { data: eventSettings } = await db
    .from('event_settings')
    .select('badge_artwork_path, certificate_artwork_path, certificate_format')
    .eq('event_slug', slug)
    .maybeSingle()
  const { data: companyRows } = await db
    .from('event_companies')
    .select('id, number, name, participants(count)')
    .eq('event_slug', slug)
    .order('number')
  const companies: CompanyRow[] = (companyRows ?? []).map((c) => ({
    id: c.id,
    number: c.number,
    name: c.name,
    count: (c.participants as unknown as { count: number }[])?.[0]?.count ?? 0,
  }))
  const studentCount = roster.groups
    .flatMap((g) => g.participants)
    .filter((p) => p.event_role === 'school_student').length

  // Refund policy: global default + optional per-event override.
  const [{ data: globalPolicy }, { data: eventPolicy }] = await Promise.all([
    db.from('refund_policies').select('tiers').eq('scope', 'global').maybeSingle(),
    db.from('refund_policies').select('tiers').eq('scope', 'event').eq('event_slug', slug).maybeSingle(),
  ])
  const refundTiers = (eventPolicy?.tiers as RefundTier[]) ?? (globalPolicy?.tiers as RefundTier[]) ?? DEFAULT_TIERS

  // Assignment panel (admins only) — enrich Clerk ids with emails for display
  let assignments: { id: string; clerk_user_id: string; email: string | null }[] = []
  if (access.isAdmin) {
    const { data } = await db
      .from('event_manager_assignments')
      .select('id, clerk_user_id')
      .eq('event_slug', slug)
      .order('created_at', { ascending: true })
    const rows = data ?? []
    if (rows.length > 0) {
      const client = await clerkClient()
      const { data: users } = await client.users.getUserList({
        userId: rows.map((r) => r.clerk_user_id),
        limit: rows.length,
      })
      const emailById = new Map(users.map((u) => [u.id, u.primaryEmailAddress?.emailAddress ?? null]))
      assignments = rows.map((r) => ({ ...r, email: emailById.get(r.clerk_user_id) ?? null }))
    }
  }

  const isCampaign = event.activityType === 'campaign'

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin/events" className="text-sm text-indigo-600 hover:text-indigo-800">
          ← All events
        </Link>
        <div className="flex items-center gap-3 mt-1">
          <h1 className="text-2xl font-bold text-gray-900">{event.title}</h1>
          {!isCampaign && (
            <Link
              href={`/admin/events/${slug}/check-in`}
              className="ml-auto text-sm font-medium bg-indigo-600 text-white rounded-lg px-3 py-1.5"
            >
              Check-In Console
            </Link>
          )}
          <span
            className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${
              isCampaign ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
            }`}
          >
            {isCampaign ? 'Campaign' : 'Live Event'}
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-0.5">
          {[
            event.date && formatDate(event.date),
            [event.venue, event.city, event.state].filter(Boolean).join(', '),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      {/* Dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Participants" value={summary.totalParticipants} />
        <StatCard label="Via Groups" value={`${summary.groupParticipants} (${summary.groupRegistrations})`} />
        <StatCard label="Individual" value={`${summary.individualParticipants} (${summary.individualRegistrations})`} />
        <StatCard label="Checked In" value={summary.checkedIn} accent="green" />
        <StatCard
          label="Unpaid"
          value={summary.outstandingPayments}
          accent={summary.outstandingPayments > 0 ? 'red' : undefined}
        />
        <StatCard
          label="DocuSigns Open"
          value={summary.outstandingDocusigns}
          accent={summary.outstandingDocusigns > 0 ? 'red' : undefined}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Dietary Requirements</h3>
          {summary.dietary.length === 0 ? (
            <p className="text-sm text-gray-400">None reported.</p>
          ) : (
            <ul className="space-y-1">
              {summary.dietary.map((d) => (
                <li key={d.name} className="flex justify-between text-sm">
                  <span className="text-gray-700">{d.name}</span>
                  <span className="font-medium text-gray-900 tabular-nums">{d.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Health Issues</h3>
          {summary.healthIssues.length === 0 ? (
            <p className="text-sm text-gray-400">None reported.</p>
          ) : (
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {summary.healthIssues.map((h, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium text-gray-900">{h.name}:</span>{' '}
                  <span className="text-gray-600">{h.condition}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {access.isAdmin && <EventManagerAssignments eventSlug={slug} initialAssignments={assignments} />}

      {!isCampaign && <EventCompanies eventSlug={slug} companies={companies} studentCount={studentCount} />}

      {!isCampaign && (
        <EventBadges
          eventSlug={slug}
          hasBadgeArtwork={Boolean(eventSettings?.badge_artwork_path)}
          hasCertificateArtwork={Boolean(eventSettings?.certificate_artwork_path)}
          certificateFormat={(eventSettings?.certificate_format as 'us_letter' | 'a4') ?? 'us_letter'}
        />
      )}

      {!isCampaign && access.isAdmin && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Refund Policy</h2>
            <p className="text-xs text-gray-500 mt-1">
              {eventPolicy ? 'This event uses a custom override.' : 'Using the global default. Save below to override for this event only.'}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <RefundPolicyEditor scope="event" eventSlug={slug} initialTiers={refundTiers} hasOverride={Boolean(eventPolicy)} />
          </div>
        </section>
      )}

      {/* Roster */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Participants</h2>
        <EventRoster
          roster={roster}
          exportHref={`/api/admin/events/${slug}/export`}
          eventSlug={slug}
          companies={companies}
        />
      </section>
    </div>
  )
}
