import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { Orbit, Environment, Document, Team } from '@stellr/icons'
import { Button } from '@stellr/web-ui'
import { getCurrentMember } from '@/lib/community'
import { getEventBySlug } from '@/lib/sanity'
import { getMemberCampaignRegistration } from '@/lib/campaign-registrations'
import { themeFromType, THEME_META, deadlineInfo, deadlinePhrase } from '@/lib/campaigns'

interface PageProps {
  params: Promise<{ slug: string }>
}

// A registered group's workspace for one campaign: deadline, materials, and the
// proposal submission entry point. Reached from the dashboard / My competitions.
export default async function RegisteredCampaignPage({ params }: PageProps) {
  const { slug } = await params
  const member = await getCurrentMember()
  if (!member) redirect('/sign-in')

  const [campaign, reg] = await Promise.all([
    getEventBySlug(slug).catch(() => null),
    getMemberCampaignRegistration(member.id, slug),
  ])
  if (!campaign || campaign.activityType !== 'campaign') notFound()
  // Not registered → send them to the public detail page to register first.
  if (!reg) redirect(`/events/${slug}`)

  const theme = themeFromType(campaign.type)
  const meta = THEME_META[theme]
  const ThemeIcon = theme === 'enviro' ? Environment : Orbit
  const dl = deadlineInfo(campaign.deadline)
  const submitted = !!reg.proposal_submitted_at
  const groupLine = [
    reg.group_name,
    reg.student_count != null ? `${reg.student_count} students` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="space-y-6">
      <Link href="/campaigns" className="text-sm text-content-muted hover:text-content">
        ← My competitions
      </Link>

      {/* Header card */}
      <section className="overflow-hidden rounded-panel border border-line border-t-4 border-t-pathway-amber bg-white p-6 shadow-card-lift">
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-pill bg-pathway-amber-bg px-3 py-1 text-xs font-bold uppercase tracking-[0.05em] text-pathway-amber">
            ✦ Campaign · Async
          </span>
          <span className={`inline-flex items-center gap-1 rounded-pill px-3 py-1 text-xs font-bold uppercase tracking-[0.05em] ${meta.chip}`}>
            ✦ {meta.label}
          </span>
        </div>

        <h1 className="mt-4 font-heading text-ds-h2 font-bold text-ink">{campaign.title}</h1>
        {groupLine && <p className="mt-1 text-sm text-content-secondary">{groupLine}</p>}

        {/* Deadline banner */}
        <div className="mt-5 flex items-center gap-4 rounded-ds-card bg-pathway-amber-bg px-5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-pathway-amber text-white">
            <Document className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <p className="text-ds-eyebrow uppercase tracking-widest text-pathway-amber">
              Proposal deadline
            </p>
            <p className="font-heading text-lg font-bold text-ink">
              {dl?.label ?? 'TBC'}
              {dl && !submitted && (
                <span className="font-sans font-normal text-content-secondary"> · {deadlinePhrase(dl)}</span>
              )}
            </p>
          </div>
          {submitted && (
            <span className="rounded-pill bg-enviro-green-bg px-3 py-1 text-xs font-semibold text-enviro-green-text">
              Submitted
            </span>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Materials & workspace */}
        <section className="rounded-panel border border-line bg-white p-6">
          <h2 className="font-heading text-ds-h3 font-bold text-ink">Materials &amp; workspace</h2>
          <ul className="mt-4 divide-y divide-line-light">
            <MaterialRow icon={<Document className="h-4 w-4" />} label="Brief & deliverables" href={`/events/${slug}`} tint="bg-primary-soft text-primary" />
            <MaterialRow icon={<ThemeIcon className="h-4 w-4" />} label="Workshop slides · 4 parts" href="/community/educator-commons" tint={meta.chip} />
            <MaterialRow icon={<Team className="h-4 w-4" />} label="Team space & chat" href="/community/educator-commons/c/general" tint="bg-enviro-green-chip text-enviro-green-text" />
          </ul>
        </section>

        {/* Your proposal */}
        <section className="rounded-panel border border-line bg-white p-6">
          <h2 className="font-heading text-ds-h3 font-bold text-ink">Your proposal</h2>
          {submitted ? (
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-3 rounded-ds-card bg-enviro-green-bg px-4 py-3">
                <Document className="h-5 w-5 text-enviro-green-text" />
                <div className="min-w-0 text-sm">
                  <p className="truncate font-semibold text-enviro-green-text">{reg.proposal_file_name}</p>
                  <p className="text-xs text-enviro-green-text/80">
                    Submitted{reg.proposal_submitted_at ? ` ${deadlineInfo(reg.proposal_submitted_at.slice(0, 10))?.label ?? ''}` : ''} · confirmation emailed
                  </p>
                </div>
              </div>
              <Button href={`/campaigns/${slug}/submit`} variant="softBlue" className="w-full justify-center">
                Replace submission
              </Button>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <p className="text-sm text-content-secondary">
                Upload your design deck and notes before the deadline. You can replace it any time
                until {dl?.label ?? 'the deadline'}.
              </p>
              <Button href={`/campaigns/${slug}/submit`} variant="primary" className="w-full justify-center">
                Submit proposal
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function MaterialRow({
  icon,
  label,
  href,
  tint,
}: {
  icon: React.ReactNode
  label: string
  href: string
  tint: string
}) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 py-3 hover:opacity-80">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control ${tint}`}>
          {icon}
        </span>
        <span className="flex-1 text-sm font-semibold text-content">{label}</span>
        <span className="text-sm font-semibold text-primary">Open</span>
      </Link>
    </li>
  )
}
