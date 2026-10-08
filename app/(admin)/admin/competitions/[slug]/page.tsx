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
import { EventVolunteersPanel } from '@/components/admin/competitions/EventVolunteersPanel'
import { EventEmailsPanel } from '@/components/admin/competitions/EventEmailsPanel'
import { EventSurveyPanel } from '@/components/admin/competitions/EventSurveyPanel'
import { AUTH_APP_URL } from '@/lib/env'
import EventCompanies, { type CompanyRow } from '@/components/admin/EventCompanies'
import EventTeamProfiles from '@/components/admin/EventTeamProfiles'
import { loadCompanyPlan, type CompanyPlan } from '@/lib/team-profile/assign'
import EventBadges from '@/components/admin/EventBadges'
import EventCertificates from '@/components/admin/EventCertificates'
import EventAwards from '@/components/admin/EventAwards'
import EventCredentials from '@/components/admin/EventCredentials'
import EventEducatorPd from '@/components/admin/EventEducatorPd'
import { RefundPolicyEditor } from '@/components/admin/RefundPolicyEditor'
import { EventMerchandiseEditor } from '@/components/admin/EventMerchandiseEditor'
import { EventMerchBatch } from '@/components/admin/EventMerchBatch'
import { DEFAULT_TIERS, type RefundTier } from '@/lib/refunds/policy'
import { ContainerTraining, type ContentRow, type ModuleOption } from '@/components/admin/containers/ContainerTraining'

export const metadata = { title: 'Admin — Event' }
export const dynamic = 'force-dynamic'

type Tab = 'overview' | 'roster' | 'emails' | 'survey' | 'training' | 'settings'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'roster', label: 'Roster' },
  { id: 'emails', label: 'Email Reminders' },
  { id: 'survey', label: 'Survey' },
  { id: 'training', label: 'Training' },
  { id: 'settings', label: 'Settings' },
]

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: 'red' | 'green' }) {
  const valueColor = accent === 'red' ? 'text-red-600' : accent === 'green' ? 'text-green-600' : 'text-brand-blue-dark'
  return (
    <div className="bg-white rounded-xl border border-brand-border p-4">
      <p className="text-xs font-medium text-brand-muted-soft uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${valueColor}`}>{value}</p>
    </div>
  )
}

export default async function AdminEventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { slug } = await params
  const { tab: rawTab = 'overview' } = await searchParams
  const tab: Tab = TABS.some((t) => t.id === rawTab)
    ? (rawTab as Tab)
    : 'overview'

  const access = await requireEventAccess(slug)
  if (!access.ok) redirect(access.status === 401 ? '/sign-in' : '/admin/competitions')

  const event = (await getEventBySlug(slug)) as (StellarEvent & { activityType?: string }) | null
  if (!event) notFound()

  const isCampaign = event.activityType === 'campaign'
  const db = supabaseServer()

  // ── Roster (only fetched when needed — it involves Clerk lookups) ──────────
  const needsRoster = tab === 'overview' || tab === 'roster'
  const roster = needsRoster ? await getEventRoster(slug, event.date) : null
  const { summary } = roster ?? { summary: null }

  // ── Company rows (roster tab, live events only) ───────────────────────────
  let companies: CompanyRow[] = []
  let studentCount = 0
  if (tab === 'roster' && !isCampaign) {
    const { data: companyRows } = await db
      .from('event_companies')
      .select('id, number, name, participants(count)')
      .eq('event_slug', slug)
      .order('number')
    companies = (companyRows ?? []).map((c) => ({
      id: c.id,
      number: c.number,
      name: c.name,
      count: (c.participants as unknown as { count: number }[])?.[0]?.count ?? 0,
    }))
    studentCount = (roster?.groups ?? [])
      .flatMap((g) => g.participants)
      .filter((p) => p.event_role === 'participant' || p.event_role === 'school_student_manager').length
  }

  // ── Team profiles + best-fit suggestions (roster tab, live events only) ───
  let companyPlan: CompanyPlan | null = null
  if (tab === 'roster' && !isCampaign) {
    companyPlan = await loadCompanyPlan(db, slug, event.date ?? null).catch((err) => {
      console.error('[competitions] team profile plan failed:', err)
      return null
    })
  }

  // ── Admin assignments (overview, admins only) ─────────────────────────────
  let assignments: { id: string; clerk_user_id: string; email: string | null }[] = []
  if (tab === 'overview' && access.isAdmin) {
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

  // ── Settings (live events, settings tab) ──────────────────────────────────
  // Badges and certificates load their own templates; this is the refund
  // editor's, which only admins see.
  let refundTiers: RefundTier[] = DEFAULT_TIERS
  let hasRefundOverride = false
  if (tab === 'settings' && !isCampaign && access.isAdmin) {
    const [{ data: globalPolicy }, { data: eventPolicy }] = await Promise.all([
      db.from('refund_policies').select('tiers').eq('scope', 'global').maybeSingle(),
      db.from('refund_policies').select('tiers').eq('scope', 'event').eq('event_slug', slug).maybeSingle(),
    ])
    hasRefundOverride = Boolean(eventPolicy)
    refundTiers = (eventPolicy?.tiers as RefundTier[]) ?? (globalPolicy?.tiers as RefundTier[]) ?? DEFAULT_TIERS
  }

  // ── Training (training tab) ───────────────────────────────────────────────
  let containerId: string | null = null
  let containerContents: ContentRow[] = []
  let allModules: ModuleOption[] = []
  if (tab === 'training') {
    const [{ data: container }, { data: moduleRows }] = await Promise.all([
      db
        .from('mentoring_cohorts')
        .select('id')
        .eq('container_type', 'event_participation')
        .is('parent_container_id', null)
        .eq('campaign_ref', slug)
        .maybeSingle(),
      db.from('training_modules').select('id, title').eq('is_published', true).order('title'),
    ])
    containerId = (container?.id as string | undefined) ?? null
    allModules = (moduleRows ?? []).map((m) => ({ id: m.id as string, title: m.title as string }))

    if (containerId) {
      const { data: contents } = await db
        .from('container_contents')
        .select('id, content_ref, is_mandatory, due_at')
        .eq('container_id', containerId)
        .eq('content_type', 'training_module')
        .order('display_order')

      const moduleIds = (contents ?? []).map((r) => r.content_ref as string)
      if (moduleIds.length > 0) {
        const { data: modules } = await db.from('training_modules').select('id, title').in('id', moduleIds)
        const titleMap = Object.fromEntries((modules ?? []).map((m) => [m.id as string, m.title as string]))
        containerContents = (contents ?? []).map((r) => ({
          id: r.id as string,
          content_ref: r.content_ref as string,
          title: titleMap[r.content_ref as string] ?? (r.content_ref as string),
          is_mandatory: r.is_mandatory as boolean,
          due_at: r.due_at as string | null,
        }))
      }
    }
  }

  // ── Visible tabs (campaigns skip Settings, Email Reminders and Survey — a
  //    campaign has its own proposal emails, and no event day to count down to
  //    or survey after)
  const visibleTabs = isCampaign ? TABS.filter((t) => t.id !== 'settings' && t.id !== 'emails' && t.id !== 'survey') : TABS

  const baseHref = `/admin/competitions/${slug}`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link href="/admin/competitions" className="text-sm text-brand-blue hover:text-brand-blue">
          ← All events
        </Link>
        <div className="flex items-center gap-3 mt-1">
          <h1 className="font-heading uppercase text-title text-brand-blue-dark">{event.title}</h1>
          {!isCampaign && tab === 'overview' && (
            <Link
              href={`/admin/competitions/${slug}/check-in`}
              className="ml-auto text-sm font-medium bg-brand-blue text-white rounded-lg px-3 py-1.5"
            >
              Check-In Console
            </Link>
          )}
          {isCampaign && tab === 'overview' && (
            <Link
              href={`/admin/campaigns/${slug}`}
              className="ml-auto text-sm font-medium bg-brand-blue text-white rounded-lg px-3 py-1.5"
            >
              Proposals &amp; email
            </Link>
          )}
          <span
            className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${
              isCampaign ? 'bg-purple-100 text-purple-700' : 'bg-brand-blue/10 text-brand-blue'
            }`}
          >
            {isCampaign ? 'Campaign' : 'Live Event'}
          </span>
        </div>
        <p className="text-sm text-brand-muted-soft mt-0.5">
          {[
            event.date && formatDate(event.date),
            [event.venue, event.city, event.state].filter(Boolean).join(', '),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      {/* Tab nav */}
      <nav className="flex gap-1 border-b border-brand-border">
        {visibleTabs.map((t) => (
          <Link
            key={t.id}
            href={`${baseHref}?tab=${t.id}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-brand-blue text-brand-blue'
                : 'border-transparent text-brand-muted-soft hover:text-brand-muted'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {/* ── Overview ───────────────────────────────────────────────────────── */}
      {tab === 'overview' && summary && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Participants" value={summary.totalParticipants} />
            <StatCard label="Via Groups" value={`${summary.groupParticipants} (${summary.groupRegistrations})`} />
            <StatCard label="Individual" value={`${summary.individualParticipants} (${summary.individualRegistrations})`} />
            <StatCard label="Checked In" value={summary.checkedIn} accent="green" />
            <StatCard label="Unpaid" value={summary.outstandingPayments} accent={summary.outstandingPayments > 0 ? 'red' : undefined} />
            <StatCard label="DocuSigns Open" value={summary.outstandingDocusigns} accent={summary.outstandingDocusigns > 0 ? 'red' : undefined} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-brand-border p-4">
              <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide mb-2">Dietary Requirements</h3>
              {summary.dietary.length === 0 ? (
                <p className="text-sm text-brand-muted-soft">None reported.</p>
              ) : (
                <ul className="space-y-1">
                  {summary.dietary.map((d) => (
                    <li key={d.name} className="flex justify-between text-sm">
                      <span className="text-brand-muted">{d.name}</span>
                      <span className="font-medium text-brand-blue-dark tabular-nums">{d.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="bg-white rounded-xl border border-brand-border p-4">
              <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide mb-2">Health Issues</h3>
              {summary.healthIssues.length === 0 ? (
                <p className="text-sm text-brand-muted-soft">None reported.</p>
              ) : (
                <ul className="space-y-1 max-h-48 overflow-y-auto">
                  {summary.healthIssues.map((h, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium text-brand-blue-dark">{h.name}:</span>{' '}
                      <span className="text-brand-muted">{h.condition}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {access.isAdmin && <EventManagerAssignments eventSlug={slug} initialAssignments={assignments} />}
        </div>
      )}

      {/* ── Roster ─────────────────────────────────────────────────────────── */}
      {tab === 'roster' && (
        <div className="space-y-6">
          <EventVolunteersPanel slug={slug} isAdmin={access.isAdmin} />
          {!isCampaign && roster && (
            <EventCompanies eventSlug={slug} companies={companies} studentCount={studentCount} />
          )}
          {companyPlan && <EventTeamProfiles eventSlug={slug} plan={companyPlan} />}
          {roster && (
            <EventRoster
              roster={roster}
              exportHref={`/api/admin/events/${slug}/export`}
              eventSlug={slug}
              companies={companies}
              isAdmin={access.isAdmin}
            />
          )}
        </div>
      )}

      {/* ── Email Reminders (live events only) ─────────────────────────────── */}
      {tab === 'emails' && !isCampaign && (
        <EventEmailsPanel eventSlug={slug} eventDate={event.date ?? null} />
      )}

      {/* ── Post-event survey (live events only) ─────────────────────────────── */}
      {tab === 'survey' && !isCampaign && <EventSurveyPanel eventSlug={slug} appUrl={AUTH_APP_URL} />}

      {/* ── Training ───────────────────────────────────────────────────────── */}
      {tab === 'training' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-brand-muted uppercase tracking-wide">Assigned training courses</h2>
            <p className="text-xs text-brand-muted-soft mt-0.5">
              Modules assigned here appear for all participants of this event.
            </p>
          </div>
          {containerId ? (
            <ContainerTraining
              containerId={containerId}
              initialContents={containerContents}
              allModules={allModules}
            />
          ) : (
            <p className="text-sm text-brand-muted-soft">
              No container found for this event — register at least one participant first.
            </p>
          )}
        </div>
      )}

      {/* ── Settings (live events only) ────────────────────────────────────── */}
      {tab === 'settings' && !isCampaign && (
        <div className="space-y-8">
          {access.isAdmin && (
            <section className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-brand-muted uppercase tracking-wide">Refund Policy</h2>
                <p className="text-xs text-brand-muted-soft mt-1">
                  {hasRefundOverride ? 'This event uses a custom override.' : 'Using the global default. Save below to override for this event only.'}
                </p>
              </div>
              <div className="bg-white rounded-xl border border-brand-border p-5">
                <RefundPolicyEditor
                  scope="event"
                  eventSlug={slug}
                  initialTiers={refundTiers}
                  hasOverride={hasRefundOverride}
                />
              </div>
            </section>
          )}

          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-brand-muted uppercase tracking-wide">Merchandise</h2>
              <p className="text-xs text-brand-muted-soft mt-1">
                Included shirt (auto-allocated by size) and paid add-ons for this event.
              </p>
            </div>
            <EventMerchandiseEditor eventSlug={slug} />
            <EventMerchBatch
              eventSlug={slug}
              defaultShipTo={{
                name: (event as { venue?: string }).venue ?? event.title,
                city: (event as { city?: string }).city ?? '',
                state: (event as { state?: string }).state ?? '',
              }}
            />
          </section>

          <EventBadges eventSlug={slug} />

          <EventCertificates eventSlug={slug} />

          <EventAwards eventSlug={slug} />

          <EventCredentials eventSlug={slug} eventTitle={event.title} />

          <EventEducatorPd eventSlug={slug} />
        </div>
      )}
    </div>
  )
}
