import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Orbit, Environment } from '@stellr/icons'
import { getCurrentMember } from '@/lib/community'
import { getAllCampaigns, type StellarEvent } from '@/lib/sanity'
import { listMemberCampaignRegistrations } from '@/lib/campaign-registrations'
import { themeFromType, THEME_META, deadlineInfo, seasonLabel } from '@/lib/campaigns'

export const dynamic = 'force-dynamic'

// "My competitions" — every campaign the member's groups are registered in.
export default async function MyCampaignsPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-in')

  const [regs, rawCampaigns] = await Promise.all([
    listMemberCampaignRegistrations(member.id),
    getAllCampaigns().catch(() => []) as Promise<StellarEvent[]>,
  ])
  const bySlug = new Map((rawCampaigns ?? []).map((c) => [c.slug.current, c]))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-ds-h2 font-bold text-ink">My competitions</h1>
        <p className="mt-1 text-sm text-content-secondary">
          Campaigns your groups are registered in.
        </p>
      </div>

      <div className="space-y-3">
        {regs.map((reg) => {
          const c = bySlug.get(reg.event_slug)
          const theme = themeFromType(c?.type)
          const meta = THEME_META[theme]
          const ThemeIcon = theme === 'enviro' ? Environment : Orbit
          const dl = deadlineInfo(c?.deadline)
          const submitted = !!reg.proposal_submitted_at
          return (
            <Link
              key={reg.id}
              href={`/campaigns/${reg.event_slug}`}
              className="flex items-center gap-4 rounded-ds-card border border-line border-l-4 border-l-pathway-amber bg-white p-4 hover:shadow-card-lift"
            >
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-white ${theme === 'enviro' ? 'bg-enviro-green' : 'bg-space-violet'}`}>
                <ThemeIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-pill bg-pathway-amber-bg px-2 py-0.5 text-xs font-bold uppercase tracking-[0.05em] text-pathway-amber">
                    ✦ Campaign
                  </span>
                  <span className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${meta.chip}`}>{meta.label}</span>
                </div>
                <p className="mt-1 truncate font-heading font-bold text-ink">{c?.title ?? reg.event_title}</p>
                <p className="text-xs text-content-muted">
                  {[reg.group_name, seasonLabel(c?.season, c?.campaignYear)].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {submitted ? (
                  <span className="rounded-pill bg-enviro-green-bg px-3 py-1 text-xs font-semibold text-enviro-green-text">
                    Submitted
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-danger">Due {dl?.label ?? 'TBC'}</span>
                )}
              </div>
            </Link>
          )
        })}

        <Link
          href="/events"
          className="flex items-center justify-center rounded-ds-card border border-dashed border-line px-5 py-6 text-sm font-semibold text-content-muted hover:border-primary hover:text-primary"
        >
          Browse Campaigns →
        </Link>
      </div>
    </div>
  )
}
