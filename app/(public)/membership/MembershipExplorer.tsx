'use client'

import * as React from 'react'
import { Team, Launch, Award, Document, Idea, Global, Orbit, Certificate } from '@stellr/icons'
import { TierCard, Button, bracketPalette, tierShade, tierGlow } from '@stellr/web-ui'
import type { TierId } from '@stellr/web-ui'
import {
  AUDIENCES, AUDIENCE_ORDER, VALUE_CARDS, FAQS,
  WATERFALL_CATEGORIES, WATERFALL_ITEMS, WATERFALL_TOTAL,
  tierBySlug, type AudienceId, type ValueIcon, type Tier,
} from './tier-data'

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

const ICONS: Record<ValueIcon, React.ComponentType<{ size?: number }>> = {
  team: Team, launch: Launch, award: Award, document: Document,
  idea: Idea, global: Global, orbit: Orbit, certificate: Certificate,
}

export default function MembershipExplorer({
  prices,
  monthly = {},
}: {
  prices: Record<string, string>
  /** slug → formatted monthly price; only the school/college paid tiers have one. */
  monthly?: Record<string, string>
}) {
  const [audienceId, setAudienceId] = React.useState<AudienceId>('school')
  const [selectedId, setSelectedId] = React.useState<TierId>('explorer')
  const [openFaq, setOpenFaq] = React.useState(0)
  const [interval, setBillingInterval] = React.useState<'annual' | 'monthly'>('annual')
  // Educator tiers feed a content waterfall below the cards; selecting a tier
  // scrolls it into view (the cards are otherwise static — Public Pages spec).
  const detailRef = React.useRef<HTMLDivElement>(null)

  const audience = AUDIENCES[audienceId]
  const pal = bracketPalette(audience.bracket)
  const isEducator = audienceId === 'educator'

  // Monthly billing exists only for the school/college paid tiers. The toggle is
  // shown for those audiences; teacher tiers (and free tiers) always show annual.
  const monthlyAvailable = audience.tiers.some((t) => monthly[t.id])
  const monthlyOn = (id: TierId) => interval === 'monthly' && !!monthly[id]
  const priceOf = (id: TierId) => (monthlyOn(id) ? monthly[id] : prices[id] ?? 'Free')
  const noteLabel = (t: { id: TierId; priceNote: string }) => (monthlyOn(t.id) ? 'per month' : t.priceNote)
  const joinHref = (id: TierId) => `${AUTH_URL}/join?tier=${id}${monthlyOn(id) ? '&interval=monthly' : ''}`

  function selectAudience(id: AudienceId) {
    setAudienceId(id)
    setSelectedId(AUDIENCES[id].tiers[0].id)
  }

  // Deep-link support: /membership#{tierSlug} (e.g. from a locked space's
  // upgrade CTA) opens with that tier's audience + card selected and the
  // explorer scrolled into view. Audience is client state, so the native
  // anchor jump can't do this on its own.
  React.useEffect(() => {
    const slug = window.location.hash.slice(1)
    if (!slug) return
    const resolved = tierBySlug(slug)
    if (!resolved) return
    setAudienceId(resolved.audience)
    setSelectedId(resolved.id)
    // Wait a frame so the resolved audience's cards are in the DOM.
    requestAnimationFrame(() => {
      ;(document.getElementById(resolved.id) ?? document.getElementById('explore'))?.scrollIntoView()
    })
  }, [])

  const selIdx = Math.max(0, audience.tiers.findIndex((t) => t.id === selectedId))
  const selected = audience.tiers[selIdx] ?? audience.tiers[0]

  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section
        className="text-white"
        style={{ background: 'radial-gradient(120% 150% at 82% -20%, #1C2552 0%, #0E1330 55%)', padding: '66px 24px 52px' }}
      >
        <div className="max-w-[1180px] mx-auto">
          <p className="font-bold text-[13px] tracking-[.13em] uppercase text-star-gold mb-4">Membership</p>
          <h1 className="font-display font-semibold text-[46px] leading-[1.05] tracking-[-0.025em] max-w-[720px] mb-3.5">
            You don&rsquo;t have to figure it out alone.
          </h1>
          <p className="text-[18px] leading-[1.55] text-[#B9C0D9] max-w-[640px] mb-[26px]">
            A professional community for school students, college students, and educators — built around
            real engineering challenges. Start free. Grow as you go.
          </p>

          <div className="flex flex-wrap gap-3 mb-9">
            <a href={`${AUTH_URL}/sign-up`} className="bg-primary text-white text-[15px] font-semibold rounded-[9px] px-6 py-[13px] hover:bg-primary-deep transition-colors">Join free</a>
            <a href="#explore" className="text-white text-[15px] font-semibold rounded-[9px] px-[22px] py-[11.5px] border-[1.5px] border-white/40 hover:bg-white/10 transition-colors">Explore tiers</a>
          </div>
        </div>
      </section>

      {/* ── "What you get" value cards (moved above the tiers) ────────── */}
      <section className="bg-white" style={{ padding: '54px 24px' }}>
        <div className="max-w-[1180px] mx-auto">
          <p className="font-bold text-[13px] tracking-[.13em] uppercase mb-2.5" style={{ color: pal.base }}>What you get</p>
          <h2 className="font-display font-semibold text-[30px] tracking-[-0.02em] text-ink mb-[26px] max-w-[640px]">
            Your Stellr Membership gets you access to all the tools you need to kickstart your career
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {VALUE_CARDS[audienceId].map((v) => {
              const Icon = ICONS[v.icon]
              return (
                <div key={v.title} className="bg-white border border-line-light rounded-2xl px-[26px] pt-[26px] pb-6" style={{ boxShadow: '0 18px 40px -32px rgba(20,26,61,.4)' }}>
                  <div className="w-[46px] h-[46px] rounded-[13px] flex items-center justify-center mb-[17px]" style={{ background: pal.tint, color: pal.base }}>
                    <Icon size={24} />
                  </div>
                  <p className="font-display font-semibold text-[18px] tracking-[-0.01em] text-ink mb-[7px]">{v.title}</p>
                  <p className="text-[14.5px] leading-[1.55] text-content-body">{v.body}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Explorer ──────────────────────────────────────────────────── */}
      <section id="explore" className="bg-surface" style={{ padding: '46px 24px 52px' }}>
        <div className="max-w-[1180px] mx-auto flex flex-col gap-6">

          {/* audience switcher (thematically coloured) + billing-interval toggle */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-2.5">
              {AUDIENCE_ORDER.map((id) => {
                const active = id === audienceId
                const ap = bracketPalette(AUDIENCES[id].bracket)
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => selectAudience(id)}
                    aria-pressed={active}
                    className="cursor-pointer rounded-full px-[18px] py-2.5 text-[13.5px] font-semibold transition-colors"
                    style={active
                      ? { background: ap.base, color: '#fff', border: '1px solid transparent' }
                      : { background: ap.tint, color: ap.base, border: '1px solid transparent' }}
                  >
                    {AUDIENCES[id].switchLabel}
                  </button>
                )
              })}
            </div>
            {monthlyAvailable && (
              <div className="inline-flex rounded-full border border-line bg-white p-1" role="group" aria-label="Billing interval">
                {(['annual', 'monthly'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setBillingInterval(opt)}
                    aria-pressed={interval === opt}
                    className={`cursor-pointer rounded-full px-4 py-1.5 text-[13px] font-semibold capitalize transition-colors ${
                      interval === opt ? 'bg-ink text-white' : 'text-content-secondary hover:text-ink'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>

          {isEducator ? (
            <>
              {/* educator: compact selectable cards feed the content waterfall */}
              <div className="flex flex-wrap gap-[13px]">
                {audience.tiers.map((t) => (
                  <div key={t.id} id={t.id} className="flex-1 basis-[200px] scroll-mt-24">
                    <TierCard
                      tier={t.id}
                      role={t.role}
                      name={t.name}
                      price={priceOf(t.id)}
                      priceNote={noteLabel(t)}
                      selected={t.id === selected.id}
                      onSelect={() => {
                        setSelectedId(t.id)
                        requestAnimationFrame(() =>
                          detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                        )
                      }}
                      cta={t.free
                        ? { label: 'Join Free', href: `${AUTH_URL}/sign-up?audience=${audienceId}` }
                        : { label: 'Sign up now', href: joinHref(t.id) }}
                    />
                  </div>
                ))}
              </div>
              <div ref={detailRef} className="scroll-mt-24">
                <Waterfall selIdx={selIdx} priceOf={priceOf} />
              </div>
            </>
          ) : (
            /* school / college: every tier is a full perk-clarity card (Academy → Community → Store) */
            <div className="flex flex-wrap items-start gap-4">
              {audience.tiers.map((t, i) => (
                <div key={t.id} id={t.id} className="flex-1 basis-[360px] max-w-[440px] scroll-mt-24">
                  <MembershipTierCard
                    tier={t}
                    audienceName={audience.name}
                    accent={pal.base}
                    accentTint={pal.tint}
                    lowerTierNames={audience.tiers.slice(0, i).map((x) => x.name).reverse()}
                    price={priceOf(t.id)}
                    priceNote={noteLabel(t)}
                    cta={t.free
                      ? { label: 'Join free', href: `${AUTH_URL}/sign-up?audience=${audienceId}` }
                      : { label: 'Sign up now', href: joinHref(t.id) }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Testimonials (kept) ───────────────────────────────────────── */}
      <section className="bg-surface">
        <div className="max-w-[1180px] mx-auto px-6 py-16">
          <p className="font-display font-bold text-[13px] tracking-[.13em] uppercase text-primary">From the community</p>
          <h2 className="font-display font-bold text-[32px] tracking-heading text-ink mt-[10px] mb-7">What members say</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="bg-white border border-line rounded-2xl py-7 px-7 pl-8 relative border-l-[3px] border-l-primary">
              <p className="text-[15px] leading-[1.65] text-ink italic mb-5">&ldquo;I competed in the 2017 and 2018 Johnson Space Center Space Design Competitions, and they remain among my fondest memories from high school.&rdquo;</p>
              <div className="flex items-center gap-2.5"><div className="w-9 h-9 rounded-full bg-primary-soft shrink-0" /><p className="font-semibold text-[14px] text-ink">Noah Swingle · 2017 &amp; 2018 Participant · Mechanical Engineering, University of South Carolina</p></div>
            </div>
            <div className="bg-white border border-line rounded-2xl py-7 px-7 pl-8 relative border-l-[3px] border-l-space-violet">
              <p className="text-[15px] leading-[1.65] text-ink italic mb-5">&ldquo;I&rsquo;ve seen kids blossom in areas we can&rsquo;t always teach in the classroom — public speaking, problem solving, working with others.&rdquo;</p>
              <div className="flex items-center gap-2.5"><div className="w-9 h-9 rounded-full bg-space-violet-bg shrink-0" /><p className="font-semibold text-[14px] text-ink">Linda Lamb · 2024 Volunteer · English Teacher, Willcox AZ</p></div>
            </div>
            <div className="bg-white border border-line rounded-2xl py-7 px-7 pl-8 relative border-l-[3px] border-l-enviro-green">
              <p className="text-[15px] leading-[1.65] text-ink italic mb-5">&ldquo;I participated in two regional and two international Space Design Competitions, and I can honestly say the experience changed my life.&rdquo;</p>
              <div className="flex items-center gap-2.5"><div className="w-9 h-9 rounded-full bg-enviro-green-bg shrink-0" /><p className="font-semibold text-[14px] text-ink">Allyson Rose · Multi-Year, Multi-Event Participant</p></div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────── */}
      <section className="bg-surface" style={{ padding: '54px 24px' }}>
        <div className="max-w-[860px] mx-auto">
          <p className="font-bold text-[13px] tracking-[.13em] uppercase text-space-violet mb-2.5">FAQ</p>
          <h2 className="font-display font-semibold text-[30px] tracking-[-0.02em] text-ink mb-6">Common questions</h2>
          <div className="flex flex-col gap-2.5">
            {FAQS.map((f, i) => {
              const open = openFaq === i
              return (
                <div key={f.q} className="bg-white border border-line rounded-[13px] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? -1 : i)}
                    aria-expanded={open}
                    className="w-full text-left cursor-pointer flex items-center justify-between gap-4 px-[22px] py-[18px]"
                  >
                    <span className="text-[16px] font-semibold text-ink">{f.q}</span>
                    <span className={`shrink-0 text-[20px] leading-none ${open ? 'text-space-violet' : 'text-content-faint'}`}>{open ? '–' : '+'}</span>
                  </button>
                  {open && <div className="px-[22px] pb-5 text-[14.5px] leading-[1.6] text-content-body">{f.a}</div>}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────── */}
      <section
        className="text-white text-center"
        style={{ background: 'radial-gradient(120% 160% at 20% 120%, #1C2552 0%, #0E1330 60%)', padding: '64px 24px' }}
      >
        <div className="max-w-[860px] mx-auto">
          <h2 className="font-display font-semibold text-[36px] leading-[1.1] tracking-[-0.025em] mb-3">Every level has a free tier. Start anywhere.</h2>
          <p className="text-[17px] leading-[1.55] text-[#B9C0D9] max-w-[600px] mx-auto mb-7">
            Explorer, Alumni and Educator are — and always will be — free. No credit card, no trial period.
            Upgrade when it makes sense for you.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <a href={`${AUTH_URL}/sign-up`} className="bg-primary text-white text-[15px] font-semibold rounded-[9px] px-[26px] py-3.5 hover:bg-primary-deep transition-colors">Create free account</a>
            <a href="/competitions" className="text-white text-[15px] font-semibold rounded-[9px] px-6 py-[12.5px] border-[1.5px] border-white/40 hover:bg-white/10 transition-colors">Browse competitions →</a>
          </div>
        </div>
      </section>
    </>
  )
}

/* ── School / College — perk-clarity tier card ("1a" layout) ──────────────────
 * Three colour-coded perk blocks (Academy → Community → Store), explicit green
 * "Included" chips, and one condensed "you still pay" footnote. Colour is
 * decorative — every chip/badge also states its value in text. */
const GET_CHIP: Record<'buy' | 'earn' | 'free', { label: string; cls: string }> = {
  buy: { label: 'Buy', cls: 'text-primary bg-primary-soft' },
  earn: { label: 'Earn', cls: 'text-space-violet bg-space-violet-bg' },
  free: { label: 'Free', cls: 'text-enviro-green-text bg-enviro-green-chip' },
}

function PerkBlock({
  icon, tileCls, name, badge, badgeCls, included, children, sub, extra,
}: {
  icon: React.ReactNode
  tileCls: string
  name: string
  badge?: string
  badgeCls?: string
  included?: boolean
  children: React.ReactNode
  sub?: string
  /** Optional second body line, same weight as the description (e.g. Resources). */
  extra?: string
}) {
  return (
    <div className="flex gap-[14px] items-start py-[18px] border-t border-line-light">
      <div className={`shrink-0 w-10 h-10 rounded-[11px] flex items-center justify-center ${tileCls}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-display font-semibold text-[16px] text-ink">{name}</span>
          {badge && <span className={`shrink-0 font-bold text-[12px] rounded-full px-[9px] py-[3px] ${badgeCls}`}>{badge}</span>}
        </div>
        {included && (
          <span className="inline-block mt-[7px] font-bold text-[11px] tracking-[.05em] uppercase text-enviro-green-text bg-enviro-green-chip rounded-full px-2 py-[3px]">
            Included
          </span>
        )}
        <p className="mt-[7px] text-[14px] leading-[1.5] text-content-secondary">{children}</p>
        {extra && <p className="mt-[6px] text-[14px] leading-[1.5] text-content-secondary">{extra}</p>}
        {sub && <p className="mt-[5px] text-[12.5px] leading-[1.45] text-content-faint">{sub}</p>}
      </div>
    </div>
  )
}

function MembershipTierCard({
  tier, audienceName, accent, accentTint, lowerTierNames, price, priceNote, cta,
}: {
  tier: Tier
  audienceName: string
  /** Audience theme colour (matches the audience switcher) for the header pill. */
  accent: string
  accentTint: string
  /** Lower tiers in this audience, highest→lowest (e.g. ['Pathfinder','Explorer']). */
  lowerTierNames: string[]
  price: string
  priceNote: string
  cta: { label: string; href: string }
}) {
  // Academy has three states: included sessions / discount-only / full price.
  const ai = tier.academyIncluded
  let academyBadge: string | undefined
  let academyDesc: React.ReactNode
  let academySub: string | undefined
  if (ai) {
    academyBadge = `${tier.academy} off extras`
    const plural = ai.count !== 1
    academyDesc = (
      <>
        <b className="font-bold text-content-body">{ai.count} {ai.kind} session{plural ? 's' : ''}</b>
        {` (${ai.duration}${plural ? ' each' : ''}), included.`}
      </>
    )
    academySub = `Extra Training, Mentoring & Coaching at ${tier.academy} off.`
  } else if (tier.academy !== '0%') {
    academyBadge = `${tier.academy} off`
    academyDesc = `Training, Mentoring & Coaching at ${tier.academy} off.`
  } else {
    academyDesc = 'Training, Mentoring & Coaching at full price.'
  }

  // Community Spaces are additive — own tier's Space plus every lower tier's.
  const communityDesc = lowerTierNames.length === 0
    ? `Your own ${tier.name} Space — a dedicated room to meet, ask and build.`
    : `Your own ${tier.name} Space, plus the ${lowerTierNames.join(' & ')} Space${
        lowerTierNames.length > 1 ? 's' : ''
      } — dedicated rooms to meet, ask and build.`

  return (
    <div className="bg-white border border-line rounded-panel p-[28px] shadow-card-lift flex flex-col">
      {/* header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="inline-block font-bold text-[11px] tracking-[.08em] uppercase rounded-full px-[11px] py-[6px]" style={{ color: accent, background: accentTint }}>{audienceName}</span>
          <h3 className="font-display font-bold text-[30px] tracking-[-0.02em] text-ink mt-[14px]">{tier.name}</h3>
        </div>
        <div className="text-right shrink-0">
          <p className="font-display font-bold text-[26px] text-primary leading-none">{price}</p>
          <p className="text-[13px] text-content-faint mt-1">{priceNote}</p>
        </div>
      </div>

      {/* how you get it — existing per-tier copy, restyled into chip rows */}
      <p className="font-bold text-[12px] tracking-[.11em] uppercase text-content-faint mt-[22px] mb-[11px]">How you get it</p>
      <div className="flex flex-col gap-[9px]">
        {tier.get.map((gp) => (
          <div key={gp.text} className="flex gap-2.5 items-start">
            <span className={`shrink-0 font-bold text-[11px] tracking-[.05em] uppercase rounded-control px-[9px] py-[5px] ${GET_CHIP[gp.kind].cls}`}>{GET_CHIP[gp.kind].label}</span>
            <span className="text-[14px] leading-[1.45] text-content-body pt-[3px]">{gp.text}</span>
          </div>
        ))}
      </div>

      {/* perk blocks — Academy → Community → Store */}
      <div className="mt-[10px]">
        <PerkBlock
          icon={<Idea size={22} />}
          tileCls="bg-primary-soft text-primary"
          name="Academy"
          badge={academyBadge}
          badgeCls="text-primary bg-primary-soft"
          included={!!ai}
          sub={academySub}
        >
          {academyDesc}
        </PerkBlock>

        <PerkBlock
          icon={<Team size={22} />}
          tileCls="bg-space-violet-bg text-space-violet"
          name="Community"
          included
          extra={`Access to custom ${tier.name} Resources`}
        >
          {communityDesc}
        </PerkBlock>

        <PerkBlock
          icon={<Award size={22} />}
          tileCls="bg-pathway-amber-bg text-donate-gold"
          name="Store"
          badge={`${tier.store} off`}
          badgeCls="text-donate-gold bg-pathway-amber-bg"
        >
          {`${tier.store} off everything in the Stellr store, for as long as you're at this membership tier.`}
        </PerkBlock>
      </div>

      {/* you still pay — one condensed line */}
      <p className="mt-2 text-[12.5px] leading-[1.5] text-content-faint bg-surface rounded-[11px] px-[13px] py-[11px]">
        You still pay for Competition Participation (Competition-allocated merch always free).
      </p>

      <Button href={cta.href} className="w-full mt-[18px]">{cta.label}</Button>
    </div>
  )
}

/* ── Educators — content waterfall ────────────────────────────────────────── */
function Waterfall({ selIdx, priceOf }: { selIdx: number; priceOf: (id: TierId) => string }) {
  const eduTiers = AUDIENCES.educator.tiers

  let cum = 0
  const rows = eduTiers.map((t, idx) => {
    const newItems = WATERFALL_ITEMS.filter((i) => i.t === idx)
    cum += newItems.length
    const groups = WATERFALL_CATEGORIES
      .map((cat) => ({ name: cat.name, color: cat.color, items: newItems.filter((i) => i.c === cat.key).map((i) => i.x) }))
      .filter((g) => g.items.length > 0)
    return {
      id: t.id, name: t.name, priceNote: t.priceNote, store: t.store, academy: t.academy, mentor: t.mentor ?? '',
      newCount: newItems.length, total: cum,
      barPct: `${Math.round((cum / WATERFALL_TOTAL) * 100)}%`,
      opacity: idx <= selIdx ? 1 : 0.42,
      isSelected: idx === selIdx,
      groups,
      inheritNote: idx === 0 ? 'Starts here — the free base set' : `Everything in ${eduTiers[idx - 1].name}, plus these:`,
    }
  })

  let wfTotal = 0
  eduTiers.forEach((_, idx) => { if (idx <= selIdx) wfTotal += WATERFALL_ITEMS.filter((i) => i.t === idx).length })
  const selName = eduTiers[selIdx]?.name ?? eduTiers[0].name

  return (
    <div className="bg-white border border-line rounded-panel px-[30px] pt-7 pb-[30px]" style={{ boxShadow: '0 18px 40px -30px rgba(20,26,61,.35)' }}>
      {/* header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
        <div>
          <p className="font-bold text-[12px] tracking-[.1em] uppercase mb-[7px]" style={{ color: '#0E8C99' }}>Teacher content waterfall</p>
          <h3 className="font-display font-semibold text-[24px] tracking-[-0.02em] text-ink mb-1">Each tier is everything before it — plus more</h3>
        </div>
        <div className="rounded-xl px-4 py-3 text-right" style={{ background: '#E4F7F9', border: '1px solid #C2EBEF' }}>
          <p className="font-bold text-[11px] tracking-[.06em] uppercase mb-1" style={{ color: '#0E7480' }}>Unlocked at {selName}</p>
          <p className="font-display font-bold text-[26px] text-ink leading-none">{wfTotal} <span className="text-[14px] font-semibold" style={{ color: '#2A8A94' }}>of {WATERFALL_TOTAL} resources</span></p>
        </div>
      </div>

      {/* rows */}
      <div className="mt-[18px]">
        {rows.map((row) => {
          const shade = tierShade(row.id)
          return (
            <div
              key={row.id}
              className="relative grid grid-cols-1 lg:grid-cols-[248px_1fr] gap-[22px] items-start border-t border-line-light px-1 pt-5 pb-[22px] transition-opacity motion-reduce:transition-none"
              style={{ opacity: row.opacity }}
            >
              {row.isSelected && <span aria-hidden="true" className="absolute left-[-30px] top-0 bottom-0 w-1 rounded-r" style={{ background: shade }} />}

              {/* left: tier + accumulation */}
              <div>
                <div className="flex items-center gap-[9px] mb-[3px]">
                  <span className="font-display font-semibold text-[20px] text-ink">{row.name}</span>
                  {row.isSelected && <span className="font-bold text-[9px] tracking-[.08em] uppercase text-white rounded px-[7px] py-1" style={{ background: shade }}>Viewing</span>}
                </div>
                <div className="flex items-baseline gap-1.5 mb-[13px]">
                  <span className="font-display font-bold text-[20px] text-ink">{priceOf(row.id)}</span>
                  <span className="text-xs text-content-faint">{row.priceNote}</span>
                </div>
                <div className="h-[9px] rounded-full overflow-hidden mb-2" style={{ background: '#EEF0F7' }}>
                  <div className="h-full rounded-full" style={{ background: shade, width: row.barPct }} />
                </div>
                <p className="text-[13px] text-content-body mb-3.5"><b className="text-ink">+{row.newCount} new</b> · {row.total} of {WATERFALL_TOTAL} unlocked</p>
                <div className="flex flex-col gap-1.5 pt-[13px]" style={{ borderTop: '1px dashed #E4E7F2' }}>
                  <div className="flex justify-between gap-2.5 text-[12.5px]"><span className="text-content-faint whitespace-nowrap">Store / Academy Discounts</span><span className="font-semibold text-content-body whitespace-nowrap">{row.store} / {row.academy}</span></div>
                  <div className="flex justify-between gap-2.5 text-[12.5px]"><span className="text-content-faint whitespace-nowrap">Mentoring</span><span className="font-semibold text-content-body text-right">{row.mentor}</span></div>
                </div>
              </div>

              {/* right: new content grouped */}
              <div>
                <p className="text-xs text-content-faint mb-[13px] italic">{row.inheritNote}</p>
                <div className="flex flex-col gap-3.5">
                  {row.groups.map((g) => (
                    <div key={g.name}>
                      <div className="flex items-center gap-[7px] mb-[7px]">
                        <span className="w-[9px] h-[9px] rounded-[3px]" style={{ background: g.color }} />
                        <span className="font-bold text-[11px] tracking-[.07em] uppercase text-content-secondary whitespace-nowrap">{g.name}</span>
                      </div>
                      <div className="flex flex-wrap gap-[7px]">
                        {g.items.map((it) => (
                          <span key={it} className="text-[13px] leading-[1.3] text-content bg-surface border border-line-light rounded-lg px-[11px] py-1.5">{it}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* category legend */}
      <div className="flex flex-wrap gap-3.5 mt-1.5 pt-[18px] border-t border-line-light">
        {WATERFALL_CATEGORIES.map((c) => (
          <div key={c.key} className="flex items-center gap-[7px]"><span className="w-[11px] h-[11px] rounded-[3px]" style={{ background: c.color }} /><span className="text-[12.5px] text-content-secondary">{c.name}</span></div>
        ))}
      </div>
    </div>
  )
}
