import type { Metadata } from 'next'
import Link from 'next/link'
import { Award, Certificate, Event, Team } from '@stellr/icons'
import { MembershipCompareTable } from '@/components/membership/MembershipCompareTable'
import { MembershipFaq } from '@/components/membership/MembershipFaq'

export const metadata: Metadata = {
  title: 'Membership',
  description:
    'A professional community for school students, college students, and educators — built around real engineering challenges. Start free. Grow as you go.',
}

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

/* ── Shared layout helpers ──────────────────────────────────────────── */
function Wrap({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`max-w-[1180px] mx-auto px-8 ${className}`}>{children}</div>
  )
}

function SegTag({
  children,
  bg,
  color,
}: {
  children: React.ReactNode
  bg: string
  color: string
}) {
  return (
    <span
      className="inline-block font-display font-bold text-[11px] tracking-[.07em] uppercase px-[13px] py-[5px] rounded-full mb-[14px]"
      style={{ background: bg, color }}
    >
      {children}
    </span>
  )
}

function SectionH2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display font-bold text-[32px] tracking-heading text-ink mt-[10px]">
      {children}
    </h2>
  )
}

/* ── Tier card pieces ───────────────────────────────────────────────── */
function Check() {
  return <span className="text-[15px] text-enviro-green shrink-0 mt-[1px]">✓</span>
}

function FeatureRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 leading-[1.45] text-[14px] text-content-secondary">
      <Check />
      <span>{children}</span>
    </div>
  )
}

function AutoNoteViolet({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-space-violet-bg border border-space-violet-chip rounded-[10px] px-[14px] py-[10px] text-[12.5px] text-[#5B3FD4] leading-[1.5] mt-[10px]">
      {children}
    </div>
  )
}

function AutoNoteAmber({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[10px] px-[14px] py-[10px] text-[12.5px] leading-[1.5] mt-[10px]"
      style={{ background: '#FEF5E7', border: '1px solid #F0CFA0', color: '#92550A' }}
    >
      {children}
    </div>
  )
}

function Ribbon({ children, bg }: { children: React.ReactNode; bg: string }) {
  return (
    <span
      className="absolute top-[-12px] left-6 font-display font-bold text-[10.5px] tracking-[.07em] uppercase text-white px-3 py-[5px] rounded-full"
      style={{ background: bg }}
    >
      {children}
    </span>
  )
}

function IconTile({ Icon }: { Icon: React.ComponentType<{ size?: number }> }) {
  return (
    <div className="w-9 h-9 rounded-[9px] bg-enviro-green flex items-center justify-center text-white mb-[14px] shrink-0">
      <Icon size={18} />
    </div>
  )
}

/* ── CTA buttons ────────────────────────────────────────────────────── */
function BtnPrimary({
  href,
  children,
  size = 'lg',
}: {
  href: string
  children: React.ReactNode
  size?: 'sm' | 'lg'
}) {
  const pad = size === 'lg' ? 'px-8 py-[14px] text-base' : 'px-5 py-[10px] text-sm w-full justify-center'
  return (
    <a
      href={href}
      className={`inline-flex items-center ${pad} bg-primary text-white font-display font-bold rounded-control hover:bg-primary-deep transition-colors`}
    >
      {children}
    </a>
  )
}

function BtnOutlineWhite({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center px-8 py-[14px] text-base border-2 border-white text-white font-display font-bold rounded-control hover:bg-white hover:text-ink transition-colors"
    >
      {children}
    </a>
  )
}

function BtnSoft({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center justify-center w-full px-5 py-[10px] text-sm bg-primary-soft text-primary font-display font-bold rounded-control hover:bg-primary/15 transition-colors"
    >
      {children}
    </a>
  )
}

function BtnPrimarySm({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center justify-center w-full px-5 py-[10px] text-sm bg-primary text-white font-display font-bold rounded-control hover:bg-primary-deep transition-colors"
    >
      {children}
    </a>
  )
}

/* ════════════════════════════════════════════════════════════════════ */
export default function MembershipPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden text-white"
        style={{
          background:
            'radial-gradient(120% 130% at 80% -8%, #28306B 0%, #141A3D 45%, #0E1330 100%)',
        }}
      >
        {/* Star scatter */}
        <div
          aria-hidden="true"
          className="absolute top-[60px] right-[120px] w-[5px] h-[5px] rounded-full bg-star-gold"
          style={{
            boxShadow:
              '80px 30px 0 -1px rgba(255,255,255,.6), 160px -15px 0 -2px rgba(255,255,255,.4), 40px 110px 0 -1px #7C5CFC, 220px 70px 0 -2px rgba(255,255,255,.5), 310px 18px 0 -1px #3C6DF6',
          }}
        />

        <Wrap className="py-[72px]">
          <p className="font-display font-bold text-[13px] tracking-[.13em] uppercase text-hero-dim">
            Membership
          </p>
          <h1 className="font-display font-bold text-[56px] leading-[1.04] tracking-display text-white mt-[18px] max-w-[740px]">
            You don&rsquo;t have to figure it out alone.
          </h1>
          <p className="text-[18px] leading-[1.55] text-hero-lead max-w-[580px] mt-5">
            A professional community for school students, college students, and educators — built
            around real engineering challenges. Start free. Grow as you go.
          </p>

          <div className="flex flex-wrap gap-[14px] mt-[30px]">
            <BtnPrimary href={`${AUTH_URL}/sign-up`}>Join free</BtnPrimary>
            <BtnOutlineWhite href="#compare">Compare tiers</BtnOutlineWhite>
          </div>

          <div className="flex flex-wrap gap-[10px] mt-[34px]">
            {[
              'School students · 14–18',
              'College & university',
              'Educators & teachers',
            ].map((label) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 text-[13px] text-hero-lead rounded-full px-[14px] py-[6px]"
                style={{
                  background: 'rgba(255,255,255,.08)',
                  border: '1px solid rgba(255,255,255,.14)',
                }}
              >
                {label}
              </span>
            ))}
          </div>
        </Wrap>
      </section>

      {/* ── School Student Tiers ──────────────────────────────────────── */}
      <section className="bg-white">
        <Wrap className="py-[72px]">
          <SegTag bg="#EAF0FE" color="#2348B0">School students · 14–18</SegTag>
          <SectionH2>From your first workshop to your first award</SectionH2>
          <p className="text-[16px] leading-[1.65] text-content-muted max-w-[620px] mt-[14px] mb-9">
            Explorer is where everyone starts — free, always. Pathfinder and Scholar can be purchased,
            or earned automatically through competition participation and award outcomes.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">

            {/* Explorer (free) */}
            <div className="bg-white border border-line rounded-panel py-7 px-[26px] flex flex-col">
              <p className="font-display font-bold text-[19px] text-ink">Explorer</p>
              <p className="font-display font-bold text-[40px] tracking-heading text-ink mt-2">Free</p>
              <p className="text-[13px] text-content-faint mt-[3px]">For all school students</p>
              <div className="flex flex-col gap-[9px] my-4 flex-1">
                <FeatureRow>Explorer Community Spaces</FeatureRow>
                <FeatureRow>Training materials library</FeatureRow>
                <FeatureRow>Webinar invites &amp; monthly newsletter</FeatureRow>
                <FeatureRow>Competition entry — events &amp; campaigns</FeatureRow>
                <FeatureRow>5% store discount</FeatureRow>
              </div>
              <BtnPrimarySm href={`${AUTH_URL}/sign-up`}>Join free</BtnPrimarySm>
            </div>

            {/* Pathfinder ($60/yr) — featured */}
            <div className="border-[1.5px] border-primary rounded-panel py-7 px-[26px] flex flex-col relative shadow-featured bg-white">
              <Ribbon bg="#7C5CFC">Competition participant</Ribbon>
              <p className="font-display font-bold text-[19px] text-ink">Pathfinder</p>
              <div className="flex items-baseline gap-1.5 mt-2">
                <span className="font-display font-bold text-[40px] tracking-heading text-ink">$60</span>
                <span className="text-[15px] text-content-faint">/year</span>
              </div>
              <p className="text-[13px] text-content-faint mt-[3px]">Active competition participants</p>
              <div className="flex flex-col gap-[9px] my-4 flex-1">
                <FeatureRow>Everything in Explorer</FeatureRow>
                <FeatureRow>Pathfinder Community Spaces</FeatureRow>
                <FeatureRow>Quarterly mentoring cohorts</FeatureRow>
                <FeatureRow>25% discount on mentoring &amp; coaching</FeatureRow>
                <FeatureRow>10% store discount</FeatureRow>
              </div>
              <AutoNoteViolet>
                ✦ Auto-assigned for 12 months to competition participants. Reverts to Explorer at the
                end of term.
              </AutoNoteViolet>
              <div className="mt-3">
                <BtnSoft href="/competitions">Learn more →</BtnSoft>
              </div>
            </div>

            {/* Scholar ($500/yr) */}
            <div className="bg-white border border-line rounded-panel py-7 px-[26px] flex flex-col relative">
              <Ribbon bg="#E0922F">Award winner</Ribbon>
              <p className="font-display font-bold text-[19px] text-ink">Scholar</p>
              <div className="flex items-baseline gap-1.5 mt-2">
                <span className="font-display font-bold text-[40px] tracking-heading text-ink">$500</span>
                <span className="text-[15px] text-content-faint">/year</span>
              </div>
              <p className="text-[13px] text-content-faint mt-[3px]">Competition award winners</p>
              <div className="flex flex-col gap-[9px] my-4 flex-1">
                <FeatureRow>Everything in Pathfinder</FeatureRow>
                <FeatureRow>Scholar Community Spaces</FeatureRow>
                <FeatureRow>5 × 30-min 1:1 coaching sessions</FeatureRow>
                <FeatureRow>30% discount on additional coaching and mentoring</FeatureRow>
                <FeatureRow>Proactive LinkedIn Support</FeatureRow>
              </div>
              <AutoNoteAmber>
                ✦ Auto-assigned for 12 months to competition award winners. Reverts to Explorer at
                the end of term.
              </AutoNoteAmber>
              <div className="mt-3">
                <BtnSoft href="/competitions">Learn more →</BtnSoft>
              </div>
            </div>

          </div>
        </Wrap>
      </section>

      {/* ── College Tiers ─────────────────────────────────────────────── */}
      <section className="bg-surface">
        <Wrap className="py-[72px]">
          <SegTag bg="#F6F2FF" color="#5B3FD4">College &amp; university</SegTag>
          <SectionH2>Keep building after school</SectionH2>
          <p className="text-[16px] leading-[1.65] text-content-muted max-w-[640px] mt-[14px] mb-9">
            Our college membership is designed to continue to develop STEM Power Skills, further
            promote professional connections, and best position our members for internships and
            graduate positions. All high school members are automatically upgraded to Alumni in July
            of their graduating year.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">

            {/* Alumni (free) */}
            <div className="bg-white border border-line rounded-panel py-7 px-[26px] flex flex-col">
              <p className="font-display font-bold text-[19px] text-ink">Alumni</p>
              <p className="font-display font-bold text-[40px] tracking-heading text-ink mt-2">Free</p>
              <p className="text-[13px] text-content-faint mt-[3px]">For all college &amp; university students</p>
              <div className="flex flex-col gap-[9px] my-4 flex-1">
                <FeatureRow>Alumni Community Spaces</FeatureRow>
                <FeatureRow>Training materials library</FeatureRow>
                <FeatureRow>Webinar invites &amp; monthly newsletter</FeatureRow>
                <FeatureRow>Competition entry</FeatureRow>
                <FeatureRow>5% store discount</FeatureRow>
              </div>
              <BtnPrimarySm href={`${AUTH_URL}/sign-up`}>Join free</BtnPrimarySm>
            </div>

            {/* Contributor ($250/yr) */}
            <div className="bg-white border border-line rounded-panel py-7 px-[26px] flex flex-col relative">
              <Ribbon bg="#7C5CFC">1 volunteer activity</Ribbon>
              <p className="font-display font-bold text-[19px] text-ink">Contributor</p>
              <div className="flex items-baseline gap-1.5 mt-2">
                <span className="font-display font-bold text-[40px] tracking-heading text-ink">$250</span>
                <span className="text-[15px] text-content-faint">/year</span>
              </div>
              <p className="text-[13px] text-content-faint mt-[3px]">Freshers &amp; Sophomores</p>
              <div className="flex flex-col gap-[9px] my-4 flex-1">
                <FeatureRow>Everything in Alumni</FeatureRow>
                <FeatureRow>Contributor Community Spaces</FeatureRow>
                <FeatureRow>Semester-long mentoring cohort</FeatureRow>
                <FeatureRow>Career preparation &amp; internship support</FeatureRow>
                <FeatureRow>25% discount on additional mentoring &amp; coaching</FeatureRow>
                <FeatureRow>LinkedIn reference · 10% store discount</FeatureRow>
              </div>
              <AutoNoteViolet>
                ✦ Unlocked by one volunteer activity. Manually upgraded by Stellr admin. Reverts to
                Alumni after 12 months.
              </AutoNoteViolet>
              <div className="mt-3">
                <BtnSoft href="/contact">Learn more →</BtnSoft>
              </div>
            </div>

            {/* Counselor ($500/yr) — featured */}
            <div className="border-[1.5px] border-primary rounded-panel py-7 px-[26px] flex flex-col relative shadow-featured bg-white">
              <Ribbon bg="#3C6DF6">Most active</Ribbon>
              <p className="font-display font-bold text-[19px] text-ink">Counselor</p>
              <div className="flex items-baseline gap-1.5 mt-2">
                <span className="font-display font-bold text-[40px] tracking-heading text-ink">$500</span>
                <span className="text-[15px] text-content-faint">/year</span>
              </div>
              <p className="text-[13px] text-content-faint mt-[3px]">Juniors, Seniors &amp; Post-grads</p>
              <div className="flex flex-col gap-[9px] my-4 flex-1">
                <FeatureRow>Everything in Alumni AND Contributor</FeatureRow>
                <FeatureRow>Counselor Community Spaces</FeatureRow>
                <FeatureRow>2 × 30-min coaching sessions included</FeatureRow>
                <FeatureRow>30% discount on additional coaching</FeatureRow>
                <FeatureRow>Career readiness &amp; graduate positions</FeatureRow>
                <FeatureRow>10% store discount</FeatureRow>
              </div>
              <AutoNoteViolet>
                ✦ Can be purchased directly, or unlocked through multiple volunteer activities.
                Manually upgraded by Stellr admin.
              </AutoNoteViolet>
              <div className="mt-3">
                <BtnPrimarySm href={`${AUTH_URL}/sign-up`}>Get Counselor</BtnPrimarySm>
              </div>
            </div>

          </div>
        </Wrap>
      </section>

      {/* ── Educator Tiers ────────────────────────────────────────────── */}
      <section className="bg-white">
        <Wrap className="py-[72px]">
          <SegTag bg="#EDFAF4" color="#0F6A4C">Educators &amp; teachers</SegTag>
          <SectionH2>Run competitions that actually teach</SectionH2>
          <p className="text-[16px] leading-[1.65] text-content-muted max-w-[620px] mt-[14px] mb-9">
            Bring Stellr competitions into your classroom. The Educator tier is free — upgrade to
            Innovator to unlock the full competition toolkit. Every student account in your cohort
            upgrades with you. Looking for CTE? Check out our Trailblazer tier.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

            {/* Educator (free) */}
            <div className="bg-white border border-line rounded-panel py-7 px-[26px] flex flex-col">
              <IconTile Icon={Event} />
              <p className="font-display font-bold text-[19px] text-ink">Educator</p>
              <p className="font-display font-bold text-[38px] tracking-heading text-ink mt-1.5">Free</p>
              <p className="text-[13px] text-content-faint mt-[2px]">For all teachers &amp; educators</p>
              <div className="flex flex-col gap-[9px] my-4 flex-1">
                <FeatureRow>Educator Community Spaces</FeatureRow>
                <FeatureRow>Training materials library</FeatureRow>
                <FeatureRow>Webinar invites &amp; monthly newsletter</FeatureRow>
                <FeatureRow>Competition entry (events &amp; campaigns)</FeatureRow>
                <FeatureRow>Students assigned Explorer on registration</FeatureRow>
              </div>
              <BtnPrimarySm href={`${AUTH_URL}/sign-up`}>Join free</BtnPrimarySm>
            </div>

            {/* Innovator ($500/yr) — featured green */}
            <div
              className="rounded-panel py-7 px-[26px] flex flex-col relative bg-white border-[1.5px] border-enviro-green"
              style={{ boxShadow: '0 18px 40px -28px rgba(31,169,122,0.35)' }}
            >
              <Ribbon bg="#1FA97A">Competition toolkit</Ribbon>
              <IconTile Icon={Certificate} />
              <p className="font-display font-bold text-[19px] text-ink">Innovator</p>
              <div className="flex items-baseline gap-1.5 mt-1.5">
                <span className="font-display font-bold text-[38px] tracking-heading text-ink">$500</span>
                <span className="text-[15px] text-content-faint">/year</span>
              </div>
              <p className="text-[13px] text-content-faint mt-[2px]">1st year free as a competition participant</p>
              <div className="flex flex-col gap-[9px] my-4 flex-1">
                <FeatureRow>Everything in Educator</FeatureRow>
                <FeatureRow>Assessment guides &amp; marking rubrics</FeatureRow>
                <FeatureRow>Multi-week lesson plans</FeatureRow>
                <FeatureRow>Live kick-off &amp; close-out calls</FeatureRow>
                <FeatureRow>Student certificates</FeatureRow>
                <FeatureRow>AI PM &amp; sub-contractor tools</FeatureRow>
                <FeatureRow>Student accounts upgraded to Pathfinder</FeatureRow>
              </div>
              <BtnPrimarySm href={`${AUTH_URL}/sign-up`}>Get Innovator</BtnPrimarySm>
            </div>

            {/* Trailblazer ($1,000/yr) */}
            <div className="bg-white border border-line rounded-panel py-7 px-[26px] flex flex-col">
              <IconTile Icon={Award} />
              <p className="font-display font-bold text-[19px] text-ink">Trailblazer</p>
              <div className="flex items-baseline gap-1.5 mt-1.5">
                <span className="font-display font-bold text-[38px] tracking-heading text-ink">$1,000</span>
                <span className="text-[15px] text-content-faint">/year</span>
              </div>
              <p className="text-[13px] text-content-faint mt-[2px]">For teachers looking to excel</p>
              <div className="flex flex-col gap-[9px] my-4 flex-1">
                <FeatureRow>Everything in Innovator</FeatureRow>
                <FeatureRow>Bi-weekly mentoring calls (recorded)</FeatureRow>
                <FeatureRow>CPD credits &amp; hours</FeatureRow>
                <FeatureRow>Student awards included</FeatureRow>
              </div>
              <BtnSoft href="/contact">Get Trailblazer</BtnSoft>
            </div>

          </div>

          {/* Other roles note */}
          <div className="mt-6 bg-surface rounded-[14px] px-6 py-5 flex gap-4 items-start">
            <div className="w-8 h-8 rounded-[8px] bg-line flex items-center justify-center shrink-0 text-content-muted">
              <Team size={16} />
            </div>
            <div>
              <p className="font-semibold text-[14.5px] text-ink mb-1">
                Mentors, coaches &amp; industry experts
              </p>
              <p className="text-[14px] text-content-muted leading-[1.65]">
                These are discrete roles assigned rather than purchased — there is no membership
                cost. If you&rsquo;re an industry professional, parent, or donor who wants to get
                involved,{' '}
                <Link
                  href="/contact"
                  className="text-primary font-semibold hover:underline"
                >
                  contact us →
                </Link>
              </p>
            </div>
          </div>
        </Wrap>
      </section>

      {/* ── Comparison Table ──────────────────────────────────────────── */}
      <section className="bg-surface" id="compare">
        <Wrap className="py-[64px]">
          <p className="font-display font-bold text-[13px] tracking-[.13em] uppercase text-primary">
            Compare
          </p>
          <h2 className="font-display font-bold text-[32px] tracking-heading text-ink mt-[10px] mb-6">
            Tiers, side by side
          </h2>
          <MembershipCompareTable />
        </Wrap>
      </section>

      {/* ── Testimonials ──────────────────────────────────────────────── */}
      <section className="bg-white">
        <Wrap className="py-[64px]">
          <p className="font-display font-bold text-[13px] tracking-[.13em] uppercase text-primary">
            From the community
          </p>
          <h2 className="font-display font-bold text-[32px] tracking-heading text-ink mt-[10px] mb-7">
            What members say
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

            <div className="bg-white border border-line rounded-2xl py-7 px-[28px] pl-8 relative border-l-[3px] border-l-primary">
              <p className="text-[15px] leading-[1.65] text-line italic mb-5">
                [School student quote — to be provided]
              </p>
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-primary-soft shrink-0" />
                <p className="font-semibold text-[14px] text-line">[Name · Year · Tier]</p>
              </div>
            </div>

            <div className="bg-white border border-line rounded-2xl py-7 px-[28px] pl-8 relative border-l-[3px] border-l-space-violet">
              <p className="text-[15px] leading-[1.65] text-line italic mb-5">
                [College student quote — to be provided]
              </p>
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-space-violet-bg shrink-0" />
                <p className="font-semibold text-[14px] text-line">[Name · Year · Tier]</p>
              </div>
            </div>

            <div className="bg-white border border-line rounded-2xl py-7 px-[28px] pl-8 relative border-l-[3px] border-l-enviro-green">
              <p className="text-[15px] leading-[1.65] text-line italic mb-5">
                [Educator quote — to be provided]
              </p>
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-enviro-green-bg shrink-0" />
                <p className="font-semibold text-[14px] text-line">[Name · Role · Tier]</p>
              </div>
            </div>

          </div>
        </Wrap>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────── */}
      <section className="bg-surface">
        <Wrap className="py-[64px]">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.7fr] gap-[72px] items-start">

            <div className="lg:sticky lg:top-[90px]">
              <p className="font-display font-bold text-[13px] tracking-[.13em] uppercase text-primary">
                FAQ
              </p>
              <h2 className="font-display font-bold text-[32px] tracking-heading text-ink mt-[10px]">
                Common questions
              </h2>
              <p className="text-[15px] leading-[1.65] text-content-muted mt-[14px]">
                Can&rsquo;t find what you&rsquo;re looking for?
              </p>
              <Link
                href="/contact"
                className="inline-flex items-center gap-1.5 text-primary font-semibold text-[15px] hover:underline mt-1"
              >
                Contact us →
              </Link>
            </div>

            <MembershipFaq />

          </div>
        </Wrap>
      </section>

      {/* ── Join Free CTA ─────────────────────────────────────────────── */}
      <section className="bg-midnight">
        <Wrap className="py-[72px] text-center">
          <p className="font-display font-bold text-[13px] tracking-[.13em] uppercase text-hero-dim">
            Start today
          </p>
          <h2 className="font-display font-bold text-[42px] leading-[1.08] tracking-display text-white mt-[18px] mx-auto max-w-[600px]">
            Every level has a free tier.
            <br />
            Start anywhere.
          </h2>
          <p className="text-[17px] leading-[1.6] text-hero-lead max-w-[500px] mx-auto mt-5">
            Explorer, Alumni, and Educator are — and always will be — free. No credit card, no trial
            period. Upgrade when it makes sense for you.
          </p>
          <div className="flex flex-wrap gap-[14px] mt-[34px] justify-center">
            <BtnPrimary href={`${AUTH_URL}/sign-up`}>Create free account</BtnPrimary>
            <BtnOutlineWhite href="/competitions">Browse competitions →</BtnOutlineWhite>
          </div>
        </Wrap>
      </section>
    </>
  )
}
