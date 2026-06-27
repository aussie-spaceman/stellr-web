'use client'

import * as React from 'react'
import { Team, Launch, Award, Document, Idea, Global, Orbit, Certificate } from '@stellr/icons'
import { TierCard, BracketShadeKey, bracketPalette, tierShade, tierGlow } from '@stellr/web-ui'
import type { TierId } from '@stellr/web-ui'
import {
  AUDIENCES, AUDIENCE_ORDER, VALUE_CARDS, FAQS,
  WATERFALL_CATEGORIES, WATERFALL_ITEMS, WATERFALL_TOTAL, PURCHASABLE_LABELS,
  type AudienceId, type ValueIcon,
} from './tier-data'

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

const ICONS: Record<ValueIcon, React.ComponentType<{ size?: number }>> = {
  team: Team, launch: Launch, award: Award, document: Document,
  idea: Idea, global: Global, orbit: Orbit, certificate: Certificate,
}

export default function MembershipExplorer({ prices }: { prices: Record<string, string> }) {
  const [audienceId, setAudienceId] = React.useState<AudienceId>('school')
  const [selectedId, setSelectedId] = React.useState<TierId>('explorer')
  const [openFaq, setOpenFaq] = React.useState(0)

  const audience = AUDIENCES[audienceId]
  const pal = bracketPalette(audience.bracket)
  const isEducator = audienceId === 'educator'
  const priceOf = (id: TierId) => prices[id] ?? 'Free'

  function selectAudience(id: AudienceId) {
    setAudienceId(id)
    setSelectedId(AUDIENCES[id].tiers[0].id)
  }

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

          <p className="font-bold text-[12px] tracking-[.1em] uppercase text-[#7A82A6] mb-[13px]">Choose your audience</p>
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
                  className="cursor-pointer rounded-full px-[22px] py-3 text-[14px] font-semibold text-white transition-colors"
                  style={active
                    ? { background: ap.base, border: '1px solid transparent' }
                    : { background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.22)' }}
                >
                  {AUDIENCES[id].switchLabel}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Explorer ──────────────────────────────────────────────────── */}
      <section id="explore" className="bg-surface" style={{ padding: '46px 24px 52px' }}>
        <div className="max-w-[1180px] mx-auto flex flex-col gap-6">

          {/* age-bracket colour key */}
          <BracketShadeKey className="-mt-2 mx-0.5" />

          {/* tier cards */}
          <div className="flex flex-wrap gap-[13px]">
            {audience.tiers.map((t) => (
              <div key={t.id} className="flex-1 basis-[200px]">
                <TierCard
                  tier={t.id}
                  role={t.role}
                  name={t.name}
                  price={priceOf(t.id)}
                  priceNote={t.priceNote}
                  selected={t.id === selected.id}
                  onSelect={() => setSelectedId(t.id)}
                />
              </div>
            ))}
          </div>

          {isEducator ? <Waterfall selIdx={selIdx} priceOf={priceOf} /> : <TierLensDetail selected={selected} audienceName={audience.name} priceOf={priceOf} />}
        </div>
      </section>

      {/* ── "What you get" value cards ────────────────────────────────── */}
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

      {/* ── Testimonials (kept) ───────────────────────────────────────── */}
      <section className="bg-surface">
        <div className="max-w-[1180px] mx-auto px-6 py-16">
          <p className="font-display font-bold text-[13px] tracking-[.13em] uppercase text-primary">From the community</p>
          <h2 className="font-display font-bold text-[32px] tracking-heading text-ink mt-[10px] mb-7">What members say</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="bg-white border border-line rounded-2xl py-7 px-7 pl-8 relative border-l-[3px] border-l-primary">
              <p className="text-[15px] leading-[1.65] text-line italic mb-5">&ldquo;I competed in the 2017 and 2018 International Space Settlement Design Competitions, and they remain among my fondest memories from high school.&rdquo;</p>
              <div className="flex items-center gap-2.5"><div className="w-9 h-9 rounded-full bg-primary-soft shrink-0" /><p className="font-semibold text-[14px] text-line">Noah Swingle · 2017 &amp; 2018 · Mechanical Engineering, University of South Carolina</p></div>
            </div>
            <div className="bg-white border border-line rounded-2xl py-7 px-7 pl-8 relative border-l-[3px] border-l-space-violet">
              <p className="text-[15px] leading-[1.65] text-line italic mb-5">&ldquo;I&rsquo;ve seen kids blossom in areas we can&rsquo;t always teach in the classroom — public speaking, problem solving, working with others.&rdquo;</p>
              <div className="flex items-center gap-2.5"><div className="w-9 h-9 rounded-full bg-space-violet-bg shrink-0" /><p className="font-semibold text-[14px] text-line">Linda Lamb · 2024 · English Teacher, Willcox AZ</p></div>
            </div>
            <div className="bg-white border border-line rounded-2xl py-7 px-7 pl-8 relative border-l-[3px] border-l-enviro-green">
              <p className="text-[15px] leading-[1.65] text-line italic mb-5">&ldquo;I participated in two regional and two international Space Settlement Design Competitions, and I can honestly say the experience changed my life.&rdquo;</p>
              <div className="flex items-center gap-2.5"><div className="w-9 h-9 rounded-full bg-enviro-green-bg shrink-0" /><p className="font-semibold text-[14px] text-line">Allyson Rose · Multi-Year, Multi-Event Participant</p></div>
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

/* ── School / College — tier-lens detail panel ────────────────────────────── */
function TierLensDetail({
  selected, audienceName, priceOf,
}: {
  selected: (typeof AUDIENCES)[AudienceId]['tiers'][number]
  audienceName: string
  priceOf: (id: TierId) => string
}) {
  const stillPay: string[] = []
  selected.cells.forEach((c, i) => {
    if (c.tone === 'full') stillPay.push(`${PURCHASABLE_LABELS[i]} — full price${i === 0 ? ' (free merch included)' : ''}`)
    else if (c.tone === 'discount') stillPay.push(`${PURCHASABLE_LABELS[i]} — ${c.label} (your rate)`)
  })
  stillPay.push('Any academy extras beyond what is included, at your discount')

  const badge = { free: { bg: '#EDFAF4', fg: '#0F6A4C' }, buy: { bg: '#EAF0FE', fg: '#2C53C6' }, earn: { bg: '#F6F2FF', fg: '#3B2B86' } }

  return (
    <div className="bg-white border border-line rounded-panel px-[30px] py-7" style={{ boxShadow: '0 18px 40px -30px rgba(20,26,61,.35)' }}>
      {/* header */}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-[22px]">
        <div>
          <span className="inline-block font-bold text-[11px] tracking-[.1em] uppercase text-content-secondary bg-surface border border-line rounded-full px-3 py-1.5 mb-2.5">{audienceName}</span>
          <h3 className="font-display font-semibold text-[26px] tracking-[-0.02em] text-ink m-0">{selected.name}</h3>
        </div>
        <div className="flex gap-[26px] items-end">
          <div className="text-right">
            <p className="font-bold text-[11px] tracking-[.06em] uppercase text-content-faint mb-[5px]">Store / Academy discounts</p>
            <p className="font-display font-semibold text-[17px] text-content-body">{selected.store} / {selected.academy}</p>
          </div>
          <div className="text-right">
            <p className="font-display font-bold text-[30px] text-ink leading-none">{priceOf(selected.id)}</p>
            <p className="text-[13px] text-content-faint">{selected.priceNote}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-[26px]">
        {/* left */}
        <div>
          <p className="font-bold text-[12px] tracking-[.08em] uppercase text-content-secondary mb-[11px]">How you get it</p>
          <div className="flex flex-col gap-[9px] mb-[22px]">
            {selected.get.map((gp) => (
              <div key={gp.text} className="flex gap-2.5 items-start">
                <span className="shrink-0 font-bold text-[10px] tracking-[.06em] rounded-md px-2 py-[5px] mt-px uppercase" style={{ background: badge[gp.kind].bg, color: badge[gp.kind].fg }}>{gp.kind}</span>
                <span className="text-[14px] leading-[1.45] text-content-body">{gp.text}</span>
              </div>
            ))}
          </div>
          <p className="font-bold text-[12px] tracking-[.08em] uppercase mb-[11px]" style={{ color: '#0F6A4C' }}>Included free · granted</p>
          <div className="flex flex-col gap-[7px]">
            {selected.granted.map((g) => (
              <div key={g} className="flex gap-[9px] items-start">
                <span className="shrink-0 text-[14px] leading-[1.45]" style={{ color: '#1FA97A' }}>✓</span>
                <span className="text-[14px] leading-[1.45] text-content">{g}</span>
              </div>
            ))}
          </div>
        </div>

        {/* right */}
        <div>
          <p className="font-bold text-[12px] tracking-[.08em] uppercase mb-[11px]" style={{ color: '#2C53C6' }}>What you still pay for</p>
          <div className="flex flex-col gap-[7px] mb-[22px]">
            {stillPay.map((t) => (
              <div key={t} className="flex gap-[9px] items-start">
                <span className="shrink-0 text-content-faint text-[14px] leading-[1.45]">→</span>
                <span className="text-[14px] leading-[1.45] text-content-body">{t}</span>
              </div>
            ))}
          </div>
          {selected.revert ? (
            <div className="rounded-xl px-[15px] py-[13px]" style={{ background: '#FBEFDD', border: '1px solid #F2DFBF' }}>
              <p className="font-bold text-[11px] tracking-[.06em] uppercase mb-[5px]" style={{ color: '#9A6A1E' }}>If granted · expires</p>
              <p className="text-[13px] leading-[1.45]" style={{ color: '#6A4E18' }}>{selected.revert} Granted entitlements expire on revert and are non-refundable; a purchased tier renews and doesn&rsquo;t revert.</p>
            </div>
          ) : selected.free ? (
            <div className="rounded-xl px-[15px] py-[13px]" style={{ background: '#EDFAF4', border: '1px solid #DCF3EA' }}>
              <p className="text-[13px] leading-[1.45]" style={{ color: '#0F6A4C' }}>Free, always — no card, no trial. The base tier every member in this audience keeps.</p>
            </div>
          ) : null}
        </div>
      </div>
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
          <p className="text-[14px] leading-[1.5] text-content-muted max-w-[560px] m-0">
            Click a tier above to fill the cascade up to that level. Lit rows are what that buyer gets; dimmed rows preview what&rsquo;s still ahead.
          </p>
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
