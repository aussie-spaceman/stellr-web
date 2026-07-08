import Link from 'next/link'
import { Lock } from 'lucide-react'
import { Orbit, Environment } from '@stellr/icons'
import { Button } from '@stellr/web-ui'
import { getCurrentMember } from '@/lib/community'
import { getAllCampaigns, type StellarEvent } from '@/lib/sanity'
import { getMemberCampaignContext } from '@/lib/campaign-registrations'
import { themeFromType, THEME_META, deadlineInfo, deadlinePhrase, seasonLabel } from '@/lib/campaigns'

// Dashboard campaign block: registered campaigns with deadlines, the Educator
// Commons card, a "register another" prompt, and a higher-tier-gated material
// block. Self-contained so the home page only needs to drop it in.
export async function DashboardCampaigns() {
  const member = await getCurrentMember()
  if (!member) return null

  const [ctx, rawCampaigns] = await Promise.all([
    getMemberCampaignContext(),
    getAllCampaigns().catch(() => []) as Promise<StellarEvent[]>,
  ])
  const campaigns = rawCampaigns ?? []
  const registered = campaigns.filter((c) => ctx.registeredSlugs.has(c.slug.current))
  const another = campaigns.find((c) => !ctx.registeredSlugs.has(c.slug.current))

  // Nothing to show and no campaigns to register for — hide the whole block.
  if (registered.length === 0 && !another) return null

  return (
    <section className="space-y-4">
      <h2 className="text-ds-eyebrow font-bold uppercase tracking-widest text-pathway-amber">
        Your campaigns
      </h2>

      {registered.map((c) => {
        const theme = themeFromType(c.type)
        const meta = THEME_META[theme]
        const ThemeIcon = theme === 'enviro' ? Environment : Orbit
        const dl = deadlineInfo(c.deadline)
        return (
          <Link
            key={c._id}
            href={`/campaigns/${c.slug.current}`}
            className="flex items-center gap-4 rounded-ds-card border border-line border-l-4 border-l-pathway-amber bg-white p-4 hover:shadow-card-lift"
          >
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-white ${theme === 'enviro' ? 'bg-enviro-green' : 'bg-space-violet'}`}>
              <ThemeIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-heading font-bold text-ink">{c.title}</p>
              <p className="text-xs text-content-muted">
                ✦ {meta.label} Campaign · {seasonLabel(c.season, c.campaignYear)}
              </p>
            </div>
            {dl && (
              <div className="shrink-0 text-right">
                <p className="text-xs uppercase tracking-widest text-content-faint">Proposal due</p>
                <p className="text-sm font-semibold text-danger">{dl.label}</p>
                <p className="text-xs text-content-muted">{deadlinePhrase(dl)}</p>
              </div>
            )}
          </Link>
        )
      })}

      {/* Run another campaign */}
      {another && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-pathway-amber/30 bg-pathway-amber-bg p-5">
          <div>
            <p className="font-heading font-bold text-ink">Run another campaign this year</p>
            <p className="text-sm text-content-secondary">
              {another.title} · {seasonLabel(another.season, another.campaignYear)}
            </p>
          </div>
          <Button href={`/register/${another.slug.current}/group`} variant="primary">
            Register a group
          </Button>
        </div>
      )}

      {/* Higher-tier-gated material — everyone SEES more material exists. */}
      {!member.hasPaidTier && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-panel bg-ink p-5 text-white">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-control bg-white/10">
              <Lock className="h-4 w-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-heading font-bold">More campaign material</p>
                <span className="rounded-pill bg-star-gold/20 px-2 py-0.5 text-xs font-semibold text-star-gold">
                  Catalyst tier
                </span>
              </div>
              <p className="mt-1 text-sm text-hero-lead">
                Extended workshops, judging rubrics &amp; mentor sessions.
              </p>
            </div>
          </div>
          <Button href="/membership" variant="energy">
            Upgrade tier
          </Button>
        </div>
      )}
    </section>
  )
}
