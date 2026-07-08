import Link from 'next/link'
import { Button } from '@stellr/web-ui'
import type { StellarEvent } from '@/lib/sanity'
import {
  themeFromType,
  seasonLabel,
  deadlineInfo,
  getCampaignDates,
} from '@/lib/campaigns'
import { CardPills } from '@/components/ui/CardPills'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.stellreducation.org'

interface Props {
  campaign: StellarEvent
  membership?: { schoolName?: string | null; roleLabel?: string | null } | null
  registered?: boolean
}

const STEPS = [
  {
    title: 'Run the workshops with your group',
    body: 'Use the theme workshop slides and starter pack from your campaign workspace to get your students up to speed.',
  },
  {
    title: 'Develop your design and write it up',
    body: 'Groups work at their own pace across the season, turning their ideas into a structured proposal.',
  },
  {
    title: 'Submit a proposal before the deadline',
    body: 'Upload the finished proposal from your campaign workspace. You can replace it any time until the deadline.',
  },
]

// Public campaign detail page body (rendered inside /events/[slug] when the
// document is a campaign). Dark hero + two-column body with a sticky, membership-
// aware register card. Amber = Campaign; the theme keeps its violet/green coding.
export function CampaignDetail({ campaign, membership, registered }: Props) {
  const theme = themeFromType(campaign.type)
  const season = seasonLabel(campaign.season, campaign.campaignYear)
  const dl = deadlineInfo(campaign.deadline)
  const dates =
    campaign.season && campaign.campaignYear
      ? getCampaignDates(campaign.season, campaign.campaignYear)
      : null

  // One CTA for campaigns — Group Registration (or straight to the portal if the
  // member has already registered).
  const competeHref = registered ? `${APP_URL}/events` : `/register/${campaign.slug.current}/group`
  const competeLabel = registered ? 'Access Campaign →' : 'Compete Now →'

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="bg-midnight px-8 py-14 text-white">
        <div className="mx-auto max-w-content">
          <Link href="/events" className="text-sm text-hero-dim hover:text-white">
            ← All events &amp; campaigns
          </Link>

          <CardPills
            kind="campaign"
            gradeLevel={campaign.gradeLevel}
            theme={theme}
            size="md"
            className="mt-6"
          />

          <h1 className="mt-5 font-heading text-4xl font-bold sm:text-5xl">{campaign.title}</h1>
          {campaign.tagline && (
            <p className="mt-4 max-w-2xl text-lg text-hero-lead">{campaign.tagline}</p>
          )}

          <dl className="mt-8 flex flex-wrap gap-x-12 gap-y-4">
            <Stat label="Runs" value={dates ? `${dates.startDate.slice(5)} – ${dates.endDate.slice(5)}, ${campaign.campaignYear}` : season} />
            <Stat label="Deadline" value={dl?.label ?? 'TBC'} valueClassName="text-star-gold" />
            <Stat label="Cost" value="Free with membership" />
          </dl>

          <div className="mt-8">
            <Button href={competeHref} variant="primary">{competeLabel}</Button>
          </div>
        </div>
      </section>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div className="mx-auto grid max-w-content gap-10 px-8 py-14 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <h2 className="font-heading text-ds-h2 font-bold text-ink">What your group will do</h2>
          <ol className="mt-6 space-y-4">
            {STEPS.map((s, i) => (
              <li key={i} className="flex gap-4 rounded-ds-card border border-line bg-white p-5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-primary-soft font-heading font-bold text-primary">
                  {i + 1}
                </span>
                <div>
                  <p className="font-heading font-bold text-ink">{s.title}</p>
                  <p className="mt-1 text-sm text-content-secondary">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Sticky info card — the single Compete Now CTA lives in the hero. */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="overflow-hidden rounded-panel border border-line border-t-4 border-t-pathway-amber bg-white p-6 shadow-card-lift">
            <p className="font-heading text-ds-h3 font-bold text-ink">Register your group</p>
            <p className="mt-2 text-sm text-content-secondary">
              {campaign.deliverable ?? 'A written proposal'} · due {dl?.label ?? 'the deadline'}.
            </p>

            {membership?.schoolName ? (
              <p className="mt-4 rounded-ds-card bg-enviro-green-bg px-4 py-3 text-sm text-enviro-green-text">
                Signed in as <strong>{membership.schoolName}</strong>
                {membership.roleLabel ? ` · ${membership.roleLabel}` : ''} — no payment needed.
              </p>
            ) : (
              <p className="mt-4 rounded-ds-card bg-enviro-green-bg px-4 py-3 text-sm text-enviro-green-text">
                Free — no payment required for Campaigns.
              </p>
            )}

            <div className="mt-5">
              <Button href={competeHref} variant="primary" className="w-full justify-center">
                {competeLabel}
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </>
  )
}

function Stat({
  label,
  value,
  valueClassName = '',
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div>
      <dt className="text-ds-eyebrow uppercase tracking-widest text-hero-dim">{label}</dt>
      <dd className={`mt-1 font-heading text-lg font-bold ${valueClassName}`}>{value}</dd>
    </div>
  )
}
