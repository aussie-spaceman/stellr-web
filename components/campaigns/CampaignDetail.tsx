import Link from 'next/link'
import { Check } from 'lucide-react'
import { Button } from '@stellr/web-ui'
import type { StellarEvent } from '@/lib/sanity'
import {
  themeFromType,
  seasonLabel,
  deadlineInfo,
  getCampaignDates,
  campaignStatus,
} from '@/lib/campaigns'
import {
  CAMPAIGN_FAQS,
  CAMPAIGN_INCLUDED,
  CAMPAIGN_INCLUDED_NOTE,
  CAMPAIGN_INCLUDED_NOTE_HREF,
  CAMPAIGN_STEPS,
  campaignEligibilityCopy,
} from '@/lib/campaign-content'
import { CardPills } from '@/components/ui/CardPills'
import { EventFlyers } from '@/components/sections/EventFlyers'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.stellreducation.org'

interface Props {
  campaign: StellarEvent
  membership?: { schoolName?: string | null; roleLabel?: string | null } | null
  registered?: boolean
}

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

  // `campaignStatus()` is the one display resolver — the admin console, the
  // member portal and /curriculum all call it. This page did not, so a campaign
  // switched off in the CMS still showed a live "Compete Now" that only failed
  // once the visitor reached the registration API. Now it agrees with the gate.
  const status = campaignStatus(campaign)
  const isOpen = status === 'Open'

  // One CTA for campaigns — Group Registration (or straight to the portal if the
  // member has already registered). A member who is already in keeps their way
  // back in whatever the registration window is doing.
  const competeHref = registered ? `${APP_URL}/events` : `/register/${campaign.slug.current}/group`
  const competeLabel = registered ? 'Access Campaign →' : 'Compete Now →'
  const showCta = registered || isOpen
  const closedNote =
    status === 'Coming soon'
      ? 'Registration for this campaign opens closer to the season.'
      : 'Registration is closed for this campaign.'

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="bg-midnight px-8 py-14 text-white">
        <div className="mx-auto max-w-content">
          <Link href="/events" className="text-sm text-hero-dim hover:text-white">
            ← All events &amp; campaigns
          </Link>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <CardPills kind="campaign" gradeLevel={campaign.gradeLevel} theme={theme} size="md" />
            <span
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                isOpen
                  ? 'bg-enviro-green-chip text-enviro-green-text'
                  : status === 'Coming soon'
                    ? 'bg-star-gold/20 text-star-gold'
                    : 'bg-white/10 text-hero-dim'
              }`}
            >
              {isOpen ? 'Registration Open' : status === 'Coming soon' ? 'Coming Soon' : 'Registration Closed'}
            </span>
          </div>

          <h1 className="mt-5 font-heading text-4xl font-bold sm:text-5xl">{campaign.title}</h1>
          {campaign.tagline && (
            <p className="mt-4 max-w-2xl text-lg text-hero-lead">{campaign.tagline}</p>
          )}

          <dl className="mt-8 flex flex-wrap gap-x-12 gap-y-4">
            {/* Calendar year, not the school-year brand — Fall 2027 runs in 2026. */}
            <Stat label="Runs" value={dates ? `${dates.startDate.slice(5)} – ${dates.endDate.slice(5)}, ${dates.calendarYear}` : season} />
            <Stat label="Deadline" value={dl?.label ?? 'TBC'} valueClassName="text-star-gold" />
            <Stat label="Cost" value="Free with membership" />
          </dl>

          <div className="mt-8">
            {showCta ? (
              <Button href={competeHref} variant="primary">{competeLabel}</Button>
            ) : (
              <p className="text-sm text-hero-lead">{closedNote}</p>
            )}
          </div>
        </div>
      </section>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div className="mx-auto grid max-w-content gap-10 px-8 py-14 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <h2 className="font-heading text-ds-h2 font-bold text-ink">What your group will do</h2>
          <ol className="mt-6 space-y-4">
            {CAMPAIGN_STEPS.map((s, i) => (
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

          {/* What's Included — the free Educator tier, identical on every campaign */}
          <h2 className="mt-12 font-heading text-ds-h2 font-bold text-ink">What&rsquo;s Included</h2>
          <ul className="mt-6 space-y-3">
            {CAMPAIGN_INCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <Check size={18} className="mt-1 shrink-0 text-primary" />
                <span className="text-content-body">{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-content-secondary">
            {CAMPAIGN_INCLUDED_NOTE}{' '}
            <Link href={CAMPAIGN_INCLUDED_NOTE_HREF} className="underline text-primary-deep">Compare memberships</Link>.
          </p>

          {/* FAQ accordion — campaign-specific; the event set is venue-bound */}
          <h2 className="mt-12 font-heading text-ds-h2 font-bold text-ink">
            Frequently Asked Questions
          </h2>
          <div className="mt-6 space-y-3">
            {CAMPAIGN_FAQS.map((faq) => (
              <details key={faq.q} className="group rounded-ds-card border border-line bg-white">
                <summary className="flex cursor-pointer list-none items-center justify-between p-4 font-heading font-bold text-ink">
                  {faq.q}
                  <span className="ml-4 shrink-0 text-content-secondary transition-transform group-open:rotate-180">
                    ▾
                  </span>
                </summary>
                <p className="px-4 pb-4 text-sm text-content-secondary">{faq.a}</p>
              </details>
            ))}
          </div>
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

            <p className="mt-4 text-sm text-content-secondary">
              <span className="font-heading font-bold text-ink">Eligibility</span>
              <br />
              {campaignEligibilityCopy(campaign.gradeLevel)}
            </p>

            <div className="mt-5">
              {showCta ? (
                <Button href={competeHref} variant="primary" className="w-full justify-center">
                  {competeLabel}
                </Button>
              ) : (
                <p className="text-sm text-content-secondary">{closedNote}</p>
              )}
            </div>
          </div>

          {/* Flyers — renders nothing when the campaign has none in Sanity. */}
          <EventFlyers
            flyers={campaign.flyers}
            slug={campaign.slug.current}
            title={campaign.title}
            activityType="campaign"
            className="mt-6"
          />
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
