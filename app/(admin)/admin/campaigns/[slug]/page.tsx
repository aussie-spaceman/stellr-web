import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { themeFromType, THEME_META, deadlineInfo, seasonLabel } from '@/lib/campaigns'
import { CampaignEmailComposer } from '@/components/admin/campaigns/CampaignEmailComposer'

interface PageProps {
  params: Promise<{ slug: string }>
}

interface RegRow {
  id: string
  group_name: string | null
  teacher_first_name: string | null
  teacher_last_name: string | null
  student_count: number | null
  proposal_submitted_at: string | null
}

export default async function AdminCampaignPage({ params }: PageProps) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) redirect('/account')

  const campaign = await getEventBySlug(slug).catch(() => null)
  if (!campaign || campaign.activityType !== 'campaign') notFound()

  const db = supabaseServer()
  const { data } = await db
    .from('registrations')
    .select('id, group_name, teacher_first_name, teacher_last_name, student_count, proposal_submitted_at')
    .eq('type', 'campaign')
    .eq('event_slug', slug)
    .order('created_at', { ascending: true })
  const rows = (data as RegRow[] | null) ?? []

  const theme = themeFromType(campaign.type)
  const meta = THEME_META[theme]
  const dl = deadlineInfo(campaign.deadline)
  const submittedCount = rows.filter((r) => r.proposal_submitted_at).length
  const studentTotal = rows.reduce((sum, r) => sum + (r.student_count ?? 0), 0)

  const visible = rows

  return (
    <div className="space-y-6">
      {/* Breadcrumb + header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-content-muted">
            <Link href="/admin/competitions" className="hover:text-content">Admin</Link> / Campaigns
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-pill bg-pathway-amber-bg px-3 py-1 text-xs font-bold uppercase tracking-[0.05em] text-pathway-amber">
              ✦ Campaign · Async
            </span>
            <span className={`inline-flex items-center rounded-pill px-3 py-1 text-xs font-bold uppercase tracking-[0.05em] ${meta.chip}`}>
              ✦ {meta.label}
            </span>
          </div>
          <h1 className="mt-3 font-heading text-ds-h2 font-bold text-ink">{campaign.title}</h1>
          <p className="mt-1 text-sm text-content-secondary">
            {seasonLabel(campaign.season, campaign.campaignYear)}
            {dl ? ` · deadline ${dl.label}` : ''}
          </p>
        </div>
        <CampaignEmailComposer slug={slug} campaignTitle={campaign.title} recipientCount={rows.length} />
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        <StatCard value={rows.length} label="Registered groups" />
        <StatCard value={submittedCount} label="Proposals submitted" valueClassName="text-enviro-green" />
        <StatCard value={dl?.daysLeft ?? 0} label="Days to deadline" valueClassName="text-danger" />
        <StatCard value={studentTotal} label="Students" />
      </div>

      {/* Registered teams */}
      <section className="overflow-hidden rounded-panel border border-line bg-white">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-heading text-ds-h3 font-bold text-ink">Registered teams</h2>
          <span className="text-xs text-content-muted">{rows.length} groups</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ds-eyebrow uppercase tracking-widest text-content-faint">
                <th className="px-5 py-3 font-semibold">Group</th>
                <th className="px-5 py-3 font-semibold">Teacher</th>
                <th className="px-5 py-3 font-semibold">Students</th>
                <th className="px-5 py-3 font-semibold">Submission</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-light">
              {visible.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-3 font-semibold text-content">{r.group_name ?? '—'}</td>
                  <td className="px-5 py-3 text-content-secondary">
                    {[r.teacher_first_name, r.teacher_last_name].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-5 py-3 text-content-secondary">{r.student_count ?? '—'}</td>
                  <td className="px-5 py-3">
                    {r.proposal_submitted_at ? (
                      <span className="rounded-pill bg-enviro-green-bg px-2.5 py-1 text-xs font-semibold text-enviro-green-text">
                        Submitted
                      </span>
                    ) : (
                      <span className="rounded-pill bg-surface px-2.5 py-1 text-xs font-semibold text-content-muted">
                        In progress
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-content-muted">
                    No groups have registered yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > visible.length && (
          <div className="border-t border-line px-5 py-3 text-sm">
            <span className="text-content-muted">Showing {visible.length} of {rows.length} groups</span>
          </div>
        )}
      </section>
    </div>
  )
}

function StatCard({
  value,
  label,
  valueClassName = 'text-ink',
}: {
  value: number
  label: string
  valueClassName?: string
}) {
  return (
    <div className="rounded-ds-card border border-line bg-white p-5">
      <p className={`font-heading text-3xl font-bold ${valueClassName}`}>{value}</p>
      <p className="mt-1 text-sm text-content-secondary">{label}</p>
    </div>
  )
}
