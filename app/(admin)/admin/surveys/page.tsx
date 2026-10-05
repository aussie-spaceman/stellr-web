import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { loadLongRows } from '@/lib/survey/export'
import { computeStats, type InvitationCount, type Nps, type Pct } from '@/lib/survey/analytics'
import { logSurveyAccess } from '@/lib/survey/audit'
import { formatInZone } from '@/lib/survey/timezone'
import { WithdrawQuoteForm } from '@/components/admin/surveys/WithdrawQuoteForm'
import { usableDefinition } from '@/lib/survey/distributions'
import { normaliseDefinition, questionsFor, ROLES } from '@/lib/survey/definition'

// /admin/surveys — every event's post-event survey, the fundraising headline
// numbers (handover §8) filterable by event and year, the exports (A3) and
// quote withdrawal (V2.3 §2). Admins only.
export const metadata = { title: 'Admin — Surveys' }
export const dynamic = 'force-dynamic'

const fmt = (p: Pct) => (p.pct === null ? '—' : `${p.pct}%`)
const fmtNps = (n: Nps | undefined) => (n && n.score !== null ? `${n.score} (n=${n.n})` : '—')

const INTEREST_LABEL: Record<string, string> = {
  interests: 'Students',
  interests_parent: 'Parents',
  interests_teacher: 'Teachers',
  employer_support: 'Mentors’ employers',
  recurring_mentoring: 'Mentors: year-round mentoring',
}

export default async function AdminSurveysPage({ searchParams }: { searchParams: Promise<{ event?: string; year?: string }> }) {
  const { userId, sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) redirect('/admin')
  const sp = await searchParams
  const eventSlug = sp.event || null
  const year = Number(sp.year) > 2000 ? Number(sp.year) : null

  const db = supabaseServer()
  const { data: dists } = await db
    .from('survey_distributions')
    .select('id, event_slug, event_title, event_date, event_time_zone, status, opens_at, closes_at, survey_definitions(key, version)')
    .order('event_date', { ascending: false })
  const distributions = (dists ?? []) as unknown as {
    id: string
    event_slug: string
    event_title: string | null
    event_date: string
    event_time_zone: string
    status: string
    opens_at: string
    closes_at: string
    survey_definitions: { key: string; version: number } | null
  }[]

  // Invitation counts by event and role (response rates).
  const { data: invs } = await db.from('survey_invitations').select('distribution_id, respondent_role, status')
  const slugOf = new Map(distributions.map((d) => [d.id, d]))
  const counts = new Map<string, InvitationCount>()
  for (const i of invs ?? []) {
    const d = slugOf.get(i.distribution_id as string)
    if (!d) continue
    if (eventSlug && d.event_slug !== eventSlug) continue
    if (year && Number(d.event_date.slice(0, 4)) !== year) continue
    const key = `${d.event_slug}:${i.respondent_role}`
    const c = counts.get(key) ?? { event_slug: d.event_slug, respondent_role: i.respondent_role as string, invited: 0, submitted: 0 }
    c.invited++
    if (i.status === 'submitted') c.submitted++
    counts.set(key, c)
  }

  // Option keys (int_mentoring) → the wording respondents saw.
  const defRow = await usableDefinition(db)
  const optionLabel = new Map<string, string>()
  if (defRow) {
    const def = normaliseDefinition(defRow.definition)
    for (const role of ROLES) for (const qn of questionsFor(def, role)) for (const o of qn.options ?? []) optionLabel.set(o.key, o.label)
  }
  const label = (k: string) => optionLabel.get(k) ?? k

  const rows = await loadLongRows(db, { eventSlug, year })
  const stats = computeStats(rows, [...counts.values()])
  await logSurveyAccess(db, { actor: userId ?? 'admin', action: 'view', eventSlug, rowCount: stats.responses.total, detail: { what: 'aggregate_stats', year } })

  const years = [...new Set(distributions.map((d) => Number(d.event_date.slice(0, 4))))].sort((a, b) => b - a)
  const q = (o: Record<string, string | number | null>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(o)) if (v) p.set(k, String(v))
    const s = p.toString()
    return s ? `?${s}` : ''
  }
  const filterQs = q({ event: eventSlug, year })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">Surveys</h1>
        <p className="mt-0.5 text-sm text-brand-muted-soft">
          Post-event surveys for every event. Numbers below are app responses only; legacy Google Forms imports are in the exports under their own keys.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 text-sm" method="get">
        <label className="text-brand-muted">
          <span className="block text-xs">Event</span>
          <select name="event" defaultValue={eventSlug ?? ''} className="mt-1 rounded-lg border border-brand-border bg-white px-2 py-1.5">
            <option value="">All events</option>
            {distributions.map((d) => (
              <option key={d.id} value={d.event_slug}>
                {d.event_title ?? d.event_slug}
              </option>
            ))}
          </select>
        </label>
        <label className="text-brand-muted">
          <span className="block text-xs">Year</span>
          <select name="year" defaultValue={year ?? ''} className="mt-1 rounded-lg border border-brand-border bg-white px-2 py-1.5">
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-lg bg-brand-blue px-3 py-1.5 font-medium text-white">Apply</button>
        <span className="ml-auto flex flex-wrap gap-2">
          <a className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-brand-muted" href={`/api/admin/surveys/export${q({ format: 'long', event: eventSlug, year })}`}>CSV (long)</a>
          <a className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-brand-muted" href={`/api/admin/surveys/export${q({ format: 'wide', event: eventSlug, year })}`}>CSV (wide)</a>
          <a className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-brand-muted" href={`/api/admin/surveys/testimonials${filterQs}`}>Quotable answers</a>
        </span>
      </form>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Responses" value={String(stats.responses.total)} sub={Object.entries(stats.responses.byRole).map(([k, v]) => `${k} ${v}`).join(' · ')} />
        <Stat label="Response rate" value={fmt(stats.responseRate.overall)} sub={`${stats.responseRate.overall.n} of ${stats.responseRate.overall.of} invited`} />
        <Stat label="STEM intent rose" value={fmt(stats.stemIntent.rose)} sub={stats.stemIntent.meanShift === null ? 'no pairs yet' : `mean shift ${stats.stemIntent.meanShift > 0 ? '+' : ''}${stats.stemIntent.meanShift} (n=${stats.stemIntent.pairs})`} />
        <Stat label="First STEM professional" value={fmt(stats.firstStemPro)} sub={`of ${stats.firstStemPro.of} who answered yes/no`} />
        <Stat label="First-generation" value={fmt(stats.firstGen.overall)} sub="students, excl. prefer not to say" />
        <Stat label="Via dashboard" value={fmt(stats.responses.viaDashboard)} sub="app adoption" />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Table title="NPS by role" rows={Object.entries(stats.nps.byRole).map(([k, v]) => [k, fmtNps(v)])} />
        <Table title="NPS by event" rows={Object.entries(stats.nps.byEvent).map(([k, v]) => [k, fmtNps(v)])} />
        <Table title="First-gen by gender" rows={Object.entries(stats.firstGen.byGender).map(([k, v]) => [k, `${fmt(v)} (n=${v.of})`])} />
        <Table title="First-gen by ethnicity" rows={Object.entries(stats.firstGen.byEthnicity).map(([k, v]) => [k, `${fmt(v)} (n=${v.of})`])} />
        <Table
          title="Mentor volunteer hours"
          rows={Object.entries(stats.mentorHours.byEvent).map(([k, v]) => [k, `${v.total} h (${v.prep} prep + ${v.event} event, ${v.mentors} mentors)`])}
        />
        <Table title="Parents: fair monthly mentoring price" rows={Object.entries(stats.priceBand).map(([k, v]) => [k, String(v)])} />
        {Object.entries(stats.interests).map(([key, counts]) => (
          <Table key={key} title={`Interest: ${INTEREST_LABEL[key] ?? key}`} rows={Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => [label(k), String(v)])} />
        ))}
        <Table
          title="Response rate by event and role"
          rows={stats.responseRate.byEventRole.map((r) => [`${r.event_slug} · ${r.role}`, `${fmt(r.rate)} (${r.rate.n}/${r.rate.of})`])}
        />
      </section>
      <p className="text-xs text-brand-muted-soft">Title I breakdown needs NCES school IDs on schools — a follow-up (not yet collected).</p>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-muted">Event surveys</h2>
        <div className="overflow-x-auto rounded-xl border border-brand-border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-brand-muted-soft">
              <tr>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Goes live</th>
                <th className="px-3 py-2">Closes</th>
                <th className="px-3 py-2">Survey</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-hairline">
              {distributions.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-brand-muted-soft">No surveys scheduled yet.</td>
                </tr>
              )}
              {distributions.map((d) => (
                <tr key={d.id}>
                  <td className="px-3 py-2">
                    <Link className="font-medium text-brand-blue" href={`/admin/competitions/${d.event_slug}?tab=survey`}>
                      {d.event_title ?? d.event_slug}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-brand-muted">{d.status}</td>
                  <td className="px-3 py-2 text-xs text-brand-muted-soft">{formatInZone(d.opens_at, d.event_time_zone)}</td>
                  <td className="px-3 py-2 text-xs text-brand-muted-soft">{formatInZone(d.closes_at, d.event_time_zone)}</td>
                  <td className="px-3 py-2 text-xs text-brand-muted-soft">
                    {d.survey_definitions ? `${d.survey_definitions.key} v${d.survey_definitions.version}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-muted">Withdraw a quote</h2>
        <p className="text-sm text-brand-muted-soft">
          On a request from a student, parent or school: paste the response ID from the quotable-answers export. The quote is excluded from every later export. This can’t be undone, and it is logged.
        </p>
        <WithdrawQuoteForm />
      </section>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-brand-border bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-muted-soft">{label}</p>
      <p className="mt-1 text-2xl font-bold text-brand-blue-dark">{value}</p>
      {sub && <p className="mt-1 text-xs text-brand-muted-soft">{sub}</p>}
    </div>
  )
}

function Table({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-xl border border-brand-border bg-white p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-muted">{title}</h3>
      {rows.length ? (
        <dl className="mt-2 divide-y divide-brand-hairline text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 py-1.5">
              <dt className="text-brand-muted">{k}</dt>
              <dd className="text-right font-medium text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-brand-muted-soft">No answers yet.</p>
      )}
    </div>
  )
}
