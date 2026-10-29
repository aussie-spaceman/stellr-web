import Link from 'next/link'
import { vercelTarget } from '@/lib/env'
import { integrationEnvironments, isRealProductionApp, type IntegrationEnvironment } from '@/lib/env-guards'
import { requireAdminPage } from '@/lib/admin-auth'
import { DIGEST_PERIODS, loadMemberDigest, outstandingCount, roleLabel, type Metric, type PersonRef } from '@/lib/admin-digest'
import { localDate } from '@/lib/survey/timezone'
import { formatDateShort } from '@/lib/utils'
import { formatUsd } from '@/lib/mentoring-format'
import { MetricRow, Panel, PeopleList, StatTile, daysSince } from '@/components/admin/dashboard/DashboardParts'
import { SendDigestButton } from '@/components/admin/dashboard/SendDigestButton'

export const metadata = { title: 'Admin — Dashboard' }
// Always current: this is a live view of the member database.
export const dynamic = 'force-dynamic'

// Admin landing page: what changed in the member database over the last 7, 30
// or 90 days, and everything still waiting on staff. The same digest
// (lib/admin-digest) is emailed every Friday by app/api/cron/weekly-digest.

const ENV_STYLES: Record<IntegrationEnvironment, { label: string; cls: string }> = {
  production:   { label: 'Live',       cls: 'bg-green-100 text-green-700' },
  sandbox:      { label: 'Sandbox',    cls: 'bg-red-100 text-red-700' },
  unconfigured: { label: 'Not set up', cls: 'bg-brand-hairline text-brand-muted-soft' },
}

const INTEGRATION_LABELS: Record<string, string> = {
  docusign: 'DocuSign (e-signature)',
  stripe:   'Stripe (payments)',
  clerk:    'Clerk (accounts)',
}

// Which environment each integration is actually pointed at. Production issued
// real parental consent forms from the DocuSign DEMO account for three months
// and nothing surfaced it: `vercel env pull` redacts secret values, so this can
// only be answered from inside the deployment. See lib/env-guards.ts.
//
// deep review AUTH-8: this must use isRealProductionApp(), not
// isProductionDeployment(). The dev Vercel project builds `dev` as its own
// production (VERCEL_ENV=production) and is meant to be on sandboxes, so
// isProductionDeployment() flags every sandbox integration there as a "problem"
// and cries wolf — the exact effect the sibling API's comment warns against
// (app/api/admin/health/integrations/route.ts). isRealProductionApp() is the
// one that is still right once the dev project exists. Display-only; no guard
// keys off this panel.
function IntegrationHealth() {
  const environments = integrationEnvironments()
  const problems = isRealProductionApp()
    ? Object.entries(environments).filter(([, env]) => env !== 'production')
    : []

  return (
    <div className="app-card p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-heading text-brand-blue-dark">Integration environments</h2>
        <span className="text-xs text-brand-muted-soft">
          Deployment: {vercelTarget()}
        </span>
      </div>

      {problems.length > 0 && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>This is a production deployment using sandbox credentials.</strong> Anything issued
          through {problems.map(([name]) => INTEGRATION_LABELS[name] ?? name).join(', ')} is not real —
          DocuSign sandbox envelopes are stamped &ldquo;Demonstration document only&rdquo; and are not
          binding signatures. Fix the variables in Vercel (Production scope) and redeploy.
        </div>
      )}

      <dl className="mt-4 divide-y divide-brand-hairline text-sm">
        {Object.entries(environments).map(([name, env]) => (
          <div key={name} className="flex items-center justify-between py-2">
            <dt className="text-brand-muted">{INTEGRATION_LABELS[name] ?? name}</dt>
            <dd>
              <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${ENV_STYLES[env].cls}`}>
                {ENV_STYLES[env].label}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-xs text-brand-grey-dark">
        Environment only — never a key, hostname or account id.
      </p>
    </div>
  )
}

const GAP_REASONS: Record<string, string> = {
  not_issued: 'Never sent',
  issue_failed: 'Failed to send',
  voided: 'Voided or expired',
  declined: 'Declined',
  bounced: 'Email bounced',
}

const REVIEW_STATES: Record<string, string> = {
  awaiting_verification: 'Licence to verify',
  flagged: 'Background check to decide',
}

/** A row in one of the "waiting on you" lists. */
interface WaitingRow {
  key: string
  primary: string
  href?: string
  secondary?: string | null
  right?: string | null
}

function WaitingList({ rows, max = 6, empty }: { rows: WaitingRow[]; max?: number; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-content-muted">{empty}</p>
  return (
    <>
      <ul className="divide-y divide-line-light">
        {rows.slice(0, max).map((r) => (
          <li key={r.key} className="flex items-baseline justify-between gap-3 py-2 text-sm">
            <span className="min-w-0">
              {r.href ? (
                <Link prefetch={false} href={r.href} className="font-medium text-primary hover:underline">{r.primary}</Link>
              ) : (
                <span className="font-medium text-ink">{r.primary}</span>
              )}
              {r.secondary && <span className="block text-xs text-content-muted">{r.secondary}</span>}
            </span>
            {r.right && <span className="shrink-0 text-right text-xs text-content-muted">{r.right}</span>}
          </li>
        ))}
      </ul>
      {rows.length > max && <p className="mt-2 text-xs text-content-muted">and {rows.length - max} more</p>}
    </>
  )
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-1 mt-4 font-subheading text-xs font-semibold uppercase tracking-eyebrow text-content-muted first:mt-0">{children}</h4>
}

const sumMetrics = (...ms: Metric[]): Metric => ({
  current: ms.reduce((n, m) => n + m.current, 0),
  previous: ms.reduce((n, m) => n + m.previous, 0),
})

const withPrefix = (prefix: string, people: PersonRef[]): PersonRef[] =>
  people.map((p) => ({ ...p, detail: p.detail ? `${prefix} · ${p.detail}` : prefix }))

const byNewest = (a: PersonRef, b: PersonRef) => b.at.localeCompare(a.at)

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdminPage()
  const { days: rawDays } = await searchParams
  const days = (DIGEST_PERIODS as readonly number[]).includes(Number(rawDays)) ? Number(rawDays) : 7
  const digest = await loadMemberDigest(days)
  const { growth, left, engagement, mentoring, outstanding: o } = digest
  const now = new Date(digest.generatedAt)

  // The members list, filtered to people who joined in this window.
  const joinedSince = localDate(new Date(digest.window.start), 'America/Denver')
  const newMembersHref = `/admin/members?joinedFrom=${joinedSince}&sort=joined&dir=desc`

  const leftMetric = sumMetrics(left.deactivated, left.lapsed, left.unsubscribed, left.withdrew)
  const leftPeople = [
    ...withPrefix('Account closed', left.deactivated.people),
    ...withPrefix('Membership lapsed', left.lapsed.people),
    ...withPrefix('Unsubscribed', left.unsubscribed.people),
    ...withPrefix('Withdrew', left.withdrew.items),
  ].sort(byNewest)
  const mentoringMetric = sumMetrics(mentoring.coachingRequests, mentoring.cohortJoins, mentoring.volunteerSignups)
  const mentoringPeople = [
    ...withPrefix('Coaching', mentoring.coachingRequests.people),
    ...withPrefix('Mentoring group', mentoring.cohortJoins.people),
    ...withPrefix('Volunteering', mentoring.volunteerSignups.people),
    ...withPrefix('New mentor', mentoring.newMentors.people),
  ].sort(byNewest)
  const waiting = outstandingCount(o)
  const otherCount = o.queues.coaching.length + o.queues.scholarships.length + o.queues.privacy.length + o.queues.deletions.length

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-2 text-brand-blue">
            <span className="h-2 w-2 rounded-full bg-brand-blue-bright" /> Admin
          </p>
          <h1 className="mt-1 font-heading text-ds-h2 text-brand-blue-dark">Dashboard</h1>
          <p className="mt-0.5 text-sm text-content-muted">
            Member activity over the last {days} days, compared with the {days} days before.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <nav aria-label="Period" className="inline-flex rounded-control border border-line bg-white p-1">
            {DIGEST_PERIODS.map((d) => (
              <Link
                key={d}
                prefetch={false}
                href={d === 7 ? '/admin' : `/admin?days=${d}`}
                aria-current={d === days ? 'page' : undefined}
                className={`inline-flex min-h-9 items-center rounded-control px-3 text-sm font-medium ${
                  d === days ? 'bg-primary text-white' : 'text-content-body hover:bg-surface'
                }`}
              >
                {d} days
              </Link>
            ))}
          </nav>
          <SendDigestButton />
        </div>
      </div>

      {digest.errors.length > 0 && (
        <div role="alert" className="rounded-ds-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          Some sections didn&rsquo;t load, so their figures may read low: {digest.errors.join(', ')}. Reload to try again.
        </div>
      )}

      {/* Headline figures */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile label="New members" metric={growth.newMembers} days={days} accent="primary" href={newMembersHref} />
        <StatTile
          label="Registrations"
          metric={growth.registrations}
          days={days}
          accent="amber"
          caption={growth.registrations.participants ? `${growth.registrations.participants} participants` : undefined}
        />
        <StatTile label="Left or lapsed" metric={leftMetric} days={days} goodWhen="down" accent="danger" />
        <StatTile label="Active in spaces" metric={engagement.activeMembers} days={days} accent="violet" />
        <StatTile label="Mentoring & coaching" metric={mentoringMetric} days={days} accent="green" caption="Requests, groups, volunteering" />
        <a href="#waiting" className="app-card relative block overflow-hidden p-4 hover:shadow-card-lift focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary">
          <span className="absolute inset-y-0 left-0 w-1 bg-ink" aria-hidden="true" />
          <p className="font-subheading text-xs font-semibold uppercase tracking-eyebrow text-content-muted">Waiting on you</p>
          <p className="mt-2 font-display text-ds-h2 leading-none text-ink">{waiting.toLocaleString()}</p>
          <p className="mt-2 text-xs text-content-muted">Forms, checks, payments, requests</p>
        </a>
      </div>

      {/* What happened */}
      <section aria-labelledby="activity-heading" className="space-y-4">
        <h2 id="activity-heading" className="font-heading text-ds-h3 text-ink">Activity</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="New members" count={growth.newMembers.current} href={newMembersHref} hrefLabel="Open in Members">
            {Object.keys(growth.newMembers.byRole).length > 0 && (
              <p className="mb-2 flex flex-wrap gap-1.5">
                {Object.entries(growth.newMembers.byRole).sort(([, a], [, b]) => b - a).map(([role, n]) => (
                  <span key={role} className="rounded-pill bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">
                    {n} {roleLabel(role)}{n === 1 ? '' : 's'}
                  </span>
                ))}
              </p>
            )}
            <PeopleList people={growth.newMembers.people} moreHref={newMembersHref} empty="No one joined in this period." />
          </Panel>

          <Panel title="Left or lapsed" count={leftMetric.current}>
            <dl className="mb-2 divide-y divide-line-light">
              <MetricRow label="Accounts closed" metric={left.deactivated} days={days} goodWhen="down" />
              <MetricRow label="Memberships lapsed, not renewed" metric={left.lapsed} days={days} goodWhen="down" />
              <MetricRow label="Unsubscribed from email" metric={left.unsubscribed} days={days} goodWhen="down" />
              <MetricRow label="Withdrew from an event" metric={left.withdrew} days={days} goodWhen="down" />
            </dl>
            <PeopleList people={leftPeople} empty="No one left in this period." />
          </Panel>

          <Panel title="Community spaces" count={engagement.activeMembers.current} href="/admin/community/spaces" hrefLabel="Spaces">
            <dl className="divide-y divide-line-light">
              <MetricRow label="Members active in spaces" metric={engagement.activeMembers} days={days} />
              <MetricRow label="Posts" metric={engagement.posts} days={days} />
              <MetricRow label="Comments" metric={engagement.comments} days={days} />
              <MetricRow label="Reactions" metric={engagement.reactions} days={days} />
              <MetricRow label="Space chat messages" metric={engagement.chatMessages} days={days} />
              <MetricRow label="New space members" metric={engagement.spaceJoins} days={days} goodWhen="neutral" />
            </dl>
            {engagement.topSpaces.length > 0 && (
              <>
                <SubHeading>Busiest spaces</SubHeading>
                <ul className="divide-y divide-line-light">
                  {engagement.topSpaces.map((s) => (
                    <li key={s.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                      <span className="font-medium text-ink">{s.name}</span>
                      <span className="text-xs text-content-muted">
                        {[s.posts && `${s.posts} posts`, s.comments && `${s.comments} comments`, s.messages && `${s.messages} messages`].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel title="Mentoring and coaching" count={mentoringMetric.current} href="/admin/academy/mentoring" hrefLabel="Mentoring">
            <dl className="mb-2 divide-y divide-line-light">
              <MetricRow label="Coaching requests" metric={mentoring.coachingRequests} days={days} />
              <MetricRow label="Joined a mentoring group" metric={mentoring.cohortJoins} days={days} />
              <MetricRow label="Volunteered for an event" metric={mentoring.volunteerSignups} days={days} />
              <MetricRow label="New mentors" metric={mentoring.newMentors} days={days} />
            </dl>
            <PeopleList people={mentoringPeople} empty="No sign-ups in this period." />
          </Panel>

          <Panel title="Event registrations" count={growth.registrations.current} href="/admin/competitions" hrefLabel="Competitions" className="lg:col-span-2">
            <PeopleList people={growth.registrations.items} max={8} empty="No new registrations in this period." />
          </Panel>
        </div>
      </section>

      {/* What's waiting */}
      <section id="waiting" aria-labelledby="waiting-heading" className="scroll-mt-6 space-y-4">
        <h2 id="waiting-heading" className="font-heading text-ds-h3 text-ink">
          Waiting on you <span className="font-subheading text-base font-medium text-content-muted">{waiting}</span>
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Consent forms" count={o.awaitingSignature.length + o.paperworkGaps.length} href="/admin/docusigns" hrefLabel="Consent forms">
            <SubHeading>Needs action ({o.paperworkGaps.length})</SubHeading>
            <WaitingList
              empty="Every participant of an upcoming event has a form sent or signed."
              rows={o.paperworkGaps.map((g) => ({
                key: g.participantId,
                primary: g.name || 'Participant',
                secondary: `${g.eventTitle} · ${GAP_REASONS[g.reason] ?? g.reason}${g.detail ? ` · ${g.detail}` : ''}`,
                right: g.since ? formatDateShort(g.since) : null,
              }))}
            />
            <SubHeading>Awaiting signature ({o.awaitingSignature.length})</SubHeading>
            <WaitingList
              empty="No forms are out for signature."
              rows={o.awaitingSignature.map((a) => ({
                key: a.id,
                primary: a.signerName,
                href: a.memberId ? `/admin/members/${a.memberId}` : undefined,
                secondary: [a.minorName && `for ${a.minorName}`, a.eventTitle, a.reminders ? `${a.reminders} reminder${a.reminders === 1 ? '' : 's'}` : null].filter(Boolean).join(' · '),
                right: `${daysSince(a.sentAt, now)} days`,
              }))}
            />
          </Panel>

          <Panel title="Verifications" count={o.verifications.review.length} href="/admin/compliance" hrefLabel="Background checks">
            <SubHeading>Needs your decision ({o.verifications.review.length})</SubHeading>
            <WaitingList
              empty="No licences to verify or checks to decide."
              rows={o.verifications.review.map((r) => ({
                key: r.memberId,
                primary: r.name,
                href: `/admin/members/${r.memberId}`,
                secondary: [roleLabel(r.eventRole), REVIEW_STATES[r.state] ?? r.state, r.detail].filter(Boolean).join(' · '),
              }))}
            />
            <dl className="mt-3 divide-y divide-line-light border-t border-line-light">
              <div className="flex justify-between py-1.5 text-sm">
                <dt className="text-content-body">Background checks in progress</dt>
                <dd className="font-semibold text-ink">{o.verifications.inProcess}</dd>
              </div>
              <div className="flex justify-between py-1.5 text-sm">
                <dt className="text-content-body">Adults with no valid clearance on file</dt>
                <dd className="font-semibold text-ink">{o.verifications.missing}</dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Payments" count={o.payments.length}>
            {o.paymentsTotalCents > 0 && (
              <p className="mb-2 text-sm text-content-body">
                <span className="font-subheading text-lg font-semibold text-ink">{formatUsd(o.paymentsTotalCents)}</span> outstanding
              </p>
            )}
            <WaitingList
              max={8}
              empty="Nothing unpaid for upcoming events, and no open invoices."
              rows={o.payments.map((p) => ({
                key: p.key,
                primary: p.who,
                href: `/admin/competitions/${p.eventSlug}`,
                secondary: `${p.eventTitle} · ${p.detail}`,
                right: [p.amountCents ? formatUsd(p.amountCents) : null, `since ${formatDateShort(p.since)}`].filter(Boolean).join(' · '),
              }))}
            />
          </Panel>

          <Panel title="Other requests" count={otherCount}>
            {otherCount === 0 && <p className="text-sm text-content-muted">No coaching, scholarship, privacy or deletion requests waiting.</p>}
            {o.queues.coaching.length > 0 && (
              <>
                <SubHeading>Coaching requests waiting for a coach ({o.queues.coaching.length})</SubHeading>
                <WaitingList empty="" rows={o.queues.coaching.map((q) => ({ key: q.id, primary: q.label, href: q.href, secondary: q.detail, right: formatDateShort(q.at) }))} />
              </>
            )}
            {o.queues.scholarships.length > 0 && (
              <>
                <SubHeading>Scholarship applications to review ({o.queues.scholarships.length})</SubHeading>
                <WaitingList empty="" rows={o.queues.scholarships.map((q) => ({ key: q.id, primary: q.label, href: q.href, secondary: q.detail, right: formatDateShort(q.at) }))} />
              </>
            )}
            {o.queues.privacy.length > 0 && (
              <>
                <SubHeading>Privacy requests ({o.queues.privacy.length})</SubHeading>
                <WaitingList empty="" rows={o.queues.privacy.map((q) => ({ key: q.id, primary: q.label, href: q.href, secondary: q.detail, right: formatDateShort(q.at) }))} />
              </>
            )}
            {o.queues.deletions.length > 0 && (
              <>
                <SubHeading>Deletion requests ({o.queues.deletions.length})</SubHeading>
                <WaitingList empty="" rows={o.queues.deletions.map((q) => ({ key: q.id, primary: q.label, href: q.href, secondary: q.detail, right: formatDateShort(q.at) }))} />
              </>
            )}
          </Panel>
        </div>
      </section>

      <IntegrationHealth />

      <p className="text-xs text-content-muted">
        The weekly digest of this page is emailed every Friday at midday Mountain time to staff with the
        &ldquo;all&rdquo; scope (<Link prefetch={false} href="/admin/staff" className="text-primary hover:underline">Staff roles</Link>).
        {' '}<Link prefetch={false} href="/home" className="text-primary hover:underline">Return to the web app</Link>
      </p>
    </div>
  )
}
