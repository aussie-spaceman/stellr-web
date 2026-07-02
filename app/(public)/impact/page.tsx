import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'
import { Award, Certificate, Satellite, Team } from '@stellr/icons'
import { Eyebrow, Button } from '@stellr/web-ui'
import { WhitePaperGate } from '@/components/sections/WhitePaperGate'

export const metadata: Metadata = {
  title: 'Impact',
  description:
    "We don't just teach STEM — we change the trajectory. How Stellr shapes student career trajectories, the STEM Power Skills that decide who advances, and where we stand on AI.",
}

const WWW = 'https://www.stellreducation.org'

/* ── Hero stats ───────────────────────────────────────────────────────── */
const heroStats = [
  { stat: '100k', color: 'text-star-gold', label: 'students we aim to impact over 10 years' },
  { stat: 'Top 1%', color: 'text-[#9B83FF]', label: 'of high school STEM achievers already with us' },
  { stat: 'Lifelong', color: 'text-[#5FE0C0]', label: 'a network from high school through retirement' },
]

/* ── Spectrum cards ───────────────────────────────────────────────────── */
const spectrum = [
  {
    pill: 'Too narrow',
    pillClass: 'bg-[#EEF0F7] text-content-muted',
    node: 'bg-[#C7CDDF]',
    title: 'A single job',
    body: '“Become a propulsion engineer.” Locks a teenager into one title before they’ve tried the work — or learned it’s one of fifty doors.',
    featured: false,
  },
  {
    pill: 'The trajectory',
    pillClass: 'bg-primary-soft text-primary',
    node: 'bg-primary',
    title: 'A direction you can act on',
    body: '“You’re building toward hands-on engineering.” Specific enough to take the next step — the next workshop, the next competition, the next person to meet — broad enough to keep every door open.',
    featured: true,
  },
  {
    pill: 'Too broad',
    pillClass: 'bg-[#EEF0F7] text-content-muted',
    node: 'bg-[#C7CDDF]',
    title: 'A whole career path',
    body: '“Find your calling in STEM.” Sounds inspiring and gives a student nothing to do on Monday morning.',
    featured: false,
  },
]

/* ── Soft-skill dividend rows ─────────────────────────────────────────── */
const skills = [
  { n: '01', title: 'Communication', body: 'Defend a design decision to working engineers, in plain language, on the clock.' },
  { n: '02', title: 'Leadership', body: "Take a team of four from blank page to submission. Someone has to call it — we make sure it's you, then your teammate next time." },
  { n: '03', title: 'Collaboration', body: 'Real teams, real friction. You learn to divide the work, merge it, and ship something none of you could alone.' },
  { n: '04', title: 'Stakeholder management', body: 'Our agentic AI subcontractors push back, miss deadlines, and ask hard questions — just like a real client will.' },
  { n: '05', title: 'Resilience', body: "You will be judged, and sometimes you won't place. Then you iterate. That loop is the entire point." },
  { n: '06', title: 'Initiative', body: 'No one hands you the next step. You learn to find the workshop, ask the mentor, and enter the harder bracket.' },
]

/* ── Constellation timeline ───────────────────────────────────────────── */
const stages = [
  { color: '#7C5CFC', title: 'High school', body: 'Find your footing alongside students who were here 18 months ago.' },
  { color: '#3C6DF6', title: 'College', body: 'The mentors judging your work run the labs you want to join.' },
  { color: '#16B6C4', title: 'Early career', body: 'First references and internships come from people who watched you compete.' },
  { color: '#1FA97A', title: 'Established pro', body: 'Give back as a judge or mentor; hire from the cohort you trust.' },
  { color: '#FFC24B', title: 'Lifelong member', body: 'A network that spans a career, not a semester.' },
]

/* ── White-paper bullets (client-edited — use verbatim) ───────────────── */
const paperBullets = [
  'Why “soft skills” is incorrect - they are "essential skills"',
  'STEM Power Skills, defined — how you apply technical knowledge',
  'The three mechanisms the evidence backs — team competitions, mentoring, and community collaboration',
  'Why these are the most defensibly human skills in an AI-augmented workplace',
]

/* ── AI pillars ───────────────────────────────────────────────────────── */
const pillars = [
  { Icon: Award, tint: 'text-star-gold', title: 'Quantified in competition', body: 'Students show what AI bought them. Every entry reports the ROI — time saved, quality gained. (New to ROI? There’s an Academy course.)' },
  { Icon: Certificate, tint: 'text-[#5FE0C0]', title: 'Taught in the Academy', body: 'Engineering is applied knowledge. We give members the grounding to apply AI deliberately, not blindly.' },
  { Icon: Satellite, tint: 'text-[#7CA0FF]', title: 'Built into the simulation', body: 'Custom agentic “subcontractors” behave like real vendors — so students practise managing AI, not just prompting it.' },
  { Icon: Team, tint: 'text-[#C3A4FF]', title: 'Supported for educators', body: 'We give educators the lessons, tools, and guardrails to use AI — and to let students use it safely.' },
]

const PAPER_TITLE = 'From “Soft Skills” to STEM Power Skills'

export default function ImpactPage() {
  return (
    <>
      {/* ── 1. Hero ───────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-midnight text-white pt-[54px] pb-16 px-4 sm:px-6 lg:px-8 bg-[radial-gradient(130%_120%_at_20%_-10%,#2A2150_0%,#161B40_42%,#0C1024_100%)]">
        <div className="container-max">
          <Eyebrow className="text-[#A99CF0]">About → Impact</Eyebrow>
          <h1 className="mt-4 font-display text-4xl sm:text-5xl lg:text-[66px] font-bold tracking-[-0.03em] leading-[1.02] lg:leading-none">
            We don&rsquo;t just teach STEM.
            <br />
            We change the trajectory.
          </h1>
          <p className="mt-6 text-lg text-[#C8CEF0] leading-relaxed max-w-[600px]">
            After people ask <em>why</em> we do what we do, they ask what impact we have. This is how we
            change student career trajectories — and where we stand on the technology reshaping their future.
          </p>

          <div className="flex flex-wrap gap-y-6 mt-10">
            {heroStats.map((s, i) => (
              <div
                key={s.stat}
                className={`pr-9 ${i > 0 ? 'pl-9 border-l border-white/[0.14]' : ''}`}
              >
                <p className={`font-display text-[40px] font-bold leading-none ${s.color}`}>{s.stat}</p>
                <p className="mt-2 text-[13.5px] text-[#A6AFD8] max-w-[170px] leading-snug">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 2. Career trajectory intro ────────────────────────────────── */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <Eyebrow>Career trajectory</Eyebrow>
          <h2 className="mt-3 font-display text-3xl sm:text-display font-bold text-ink leading-tight max-w-2xl">
            Setting young professionals on a STEM path
          </h2>
          <p className="mt-5 text-lg text-content-body leading-relaxed max-w-[720px]">
            We help students see — and step onto — a STEM career path long before they have to commit to one.
            By connecting high school, college, and professional life into a single community, we remove the
            opacity between each phase of the journey. Two things make it stick: the skills no exam tests, and
            the people you meet on the way up.
          </p>
        </div>
      </section>

      {/* ── 3. Why "trajectory" — the spectrum ────────────────────────── */}
      <section className="section-padding bg-surface border-t border-line-light">
        <div className="container-max">
          <div className="max-w-[680px] mx-auto text-center">
            <Eyebrow>Why &ldquo;trajectory&rdquo;</Eyebrow>
            <h2 className="mt-3 font-display text-3xl font-bold text-ink leading-tight">
              The useful middle between a job and a career path
            </h2>
            <p className="mt-4 text-content-body leading-relaxed">
              Tell a 15-year-old to pick a job and you&rsquo;ve narrowed them too soon. Tell them to
              &ldquo;find their career path&rdquo; and you&rsquo;ve said nothing they can act on. A trajectory
              is the space between — a direction with enough specifics to take the next real step.
            </p>
          </div>

          <div className="relative mt-12">
            <div
              aria-hidden
              className="hidden md:block absolute top-[38px] left-[14%] right-[14%] h-px bg-[linear-gradient(90deg,#C7CDDF,#3C6DF6_50%,#C7CDDF)]"
            />
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1.15fr_1fr] gap-[18px]">
              {spectrum.map((c) => (
                <div
                  key={c.pill}
                  className={`relative bg-white rounded-ds-card p-6 ${
                    c.featured
                      ? 'border-2 border-primary shadow-[0_18px_40px_-28px_rgba(60,109,246,.6)]'
                      : 'border border-line'
                  }`}
                >
                  <span
                    className={`block rounded-full mx-auto ${c.node} ${c.featured ? 'w-4 h-4' : 'w-3 h-3'}`}
                  />
                  <span
                    className={`inline-flex mt-4 px-3 py-1 rounded-full text-[10.5px] font-display font-bold uppercase tracking-[0.1em] ${c.pillClass}`}
                  >
                    {c.pill}
                  </span>
                  <h3 className="mt-3 font-display text-lg font-bold text-ink">{c.title}</h3>
                  <p className="mt-2 text-sm text-content-secondary leading-relaxed">{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── 4. The soft-skill dividend ────────────────────────────────── */}
      <section className="section-padding bg-white">
        <div className="container-max grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-11">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <Eyebrow>The soft-skill dividend</Eyebrow>
            <h3 className="mt-3 font-display text-[27px] font-bold text-ink leading-tight">
              The skills that never show up on a transcript
            </h3>
            <p className="mt-4 text-content-secondary leading-relaxed">
              Technical ability gets you in the room. What you do next decides how far you go — and every
              competition is built to exercise it in public, under judgement, with feedback.
            </p>
          </div>

          <div>
            {skills.map((s, i) => (
              <div
                key={s.n}
                className={`flex gap-5 sm:gap-[22px] py-[22px] border-t border-line ${
                  i === skills.length - 1 ? 'border-b' : ''
                }`}
              >
                <span className="w-[30px] shrink-0 font-display text-lg font-bold text-space-violet">
                  {s.n}
                </span>
                <h4 className="w-[170px] shrink-0 font-display text-[17px] font-bold text-ink leading-snug">
                  {s.title}
                </h4>
                <p className="text-content-secondary leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 5. Cradle-to-grave network ────────────────────────────────── */}
      <section className="relative overflow-hidden bg-midnight text-white py-16 px-4 sm:px-6 lg:px-8 bg-[radial-gradient(130%_120%_at_50%_-10%,#1A1F46_0%,#0E1330_55%,#0A0E25_100%)]">
        <div className="container-max">
          <Eyebrow className="text-star-gold">Cradle-to-grave network</Eyebrow>
          <h2 className="mt-3 font-display text-3xl sm:text-[34px] font-bold leading-tight max-w-3xl">
            You meet the people who&rsquo;ll shape your career — before you need them
          </h2>
          <p className="mt-4 text-[#C8CEF0] leading-relaxed max-w-3xl">
            Most students are one introduction away from an internship and have no way to make it. Stellr
            collapses that distance. In one community you sit alongside the people one and two steps ahead of
            you — and the professionals who hire, mentor, and eventually retire into giving back.
          </p>

          <div className="relative mt-14">
            <div
              aria-hidden
              className="hidden md:block absolute top-[18px] left-[10%] right-[10%] h-[2px] bg-[linear-gradient(90deg,#7C5CFC,#3C6DF6,#16B6C4,#1FA97A,#FFC24B)]"
            />
            <div className="grid grid-cols-2 md:grid-cols-5 gap-8 md:gap-4">
              {stages.map((st) => (
                <div key={st.title}>
                  <span
                    className="block w-[38px] h-[38px] rounded-full mx-auto md:mx-0"
                    style={{
                      background: st.color,
                      boxShadow: `0 0 0 6px ${st.color}2E, 0 0 22px 2px ${st.color}99`,
                    }}
                  />
                  <h3 className="mt-5 font-display text-base font-bold text-white">{st.title}</h3>
                  <p className="mt-1.5 text-[13.5px] text-[#A6AFD8] leading-snug">{st.body}</p>
                </div>
              ))}
            </div>
          </div>

          <blockquote className="mt-14 mx-auto max-w-[780px] text-center font-display text-[23px] font-medium text-white leading-snug">
            &ldquo;By the time you graduate, you don&rsquo;t have a contact list. You have a community that has
            watched you grow up.&rdquo;
          </blockquote>
        </div>
      </section>

      {/* ── 6. White paper feature card ───────────────────────────────── */}
      <section className="section-padding bg-surface border-t border-line-light">
        <div className="container-max">
          <div className="bg-white rounded-panel shadow-card-lift p-8 sm:p-10 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-11 items-center">
            <div>
              <span className="inline-flex px-3 py-1 rounded-full bg-[#FBEFDD] text-[#9A6418] text-[10.5px] font-display font-bold uppercase tracking-[0.1em]">
                White paper · 2026
              </span>
              <h2 className="mt-4 font-display text-3xl font-bold text-ink leading-tight">{PAPER_TITLE}</h2>
              <p className="mt-3 text-content-secondary leading-relaxed">
                The case for retiring the term &ldquo;soft skills&rdquo; — and the evidence that competitions,
                mentoring, and community build the human capabilities that decide who advances in STEM.
              </p>
              <ul className="mt-5 space-y-2.5">
                {paperBullets.map((b) => (
                  <li key={b} className="flex gap-2.5 text-[15px] text-content-body leading-relaxed">
                    <span className="text-primary font-bold">›</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-7">
                <WhitePaperGate />
              </div>
            </div>

            {/* Mock PDF cover */}
            <div className="hidden lg:flex flex-col justify-end aspect-[3/4] rounded-panel p-6 bg-[linear-gradient(160deg,#20264F,#0E1330)] border border-white/10">
              <p className="text-[10.5px] font-display font-bold uppercase tracking-[0.13em] text-[#A6AFD8]">
                Stellr · 2026 report
              </p>
              <p className="mt-2 font-display text-[19px] font-bold text-white leading-tight">{PAPER_TITLE}</p>
              <span className="block w-12 h-[3px] rounded-full bg-star-gold mt-4" />
            </div>
          </div>
        </div>
      </section>

      {/* ── 7. A note on AI ───────────────────────────────────────────── */}
      <section id="AI" className="relative overflow-hidden bg-midnight text-white py-16 px-4 sm:px-6 lg:px-8 scroll-mt-24 bg-[radial-gradient(130%_120%_at_80%_-10%,#20274F_0%,#11163A_50%,#0B0F28_100%)]">
        <div className="container-max">
          <Eyebrow className="text-[#9FB0FF]">A note on AI</Eyebrow>
          <h2 className="mt-3 font-display text-3xl sm:text-[44px] font-bold tracking-[-0.03em] leading-[1.05] max-w-3xl">
            AI is eating education.
            <br />
            So we set the table.
          </h2>
          <p className="mt-5 text-[#C8CEF0] leading-relaxed max-w-3xl">
            Generative AI, large language models, and agentic systems are changing professional work week by
            week. We won&rsquo;t ban it, and we won&rsquo;t pretend it away. We teach students to use it well —
            and to prove it was worth using. So we incorporate AI into our competitions openly, in four
            deliberate ways.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
            {pillars.map(({ Icon, tint, title, body }) => (
              <div
                key={title}
                className="bg-white/[0.05] border border-white/[0.12] rounded-card p-6"
              >
                <span className={`inline-flex w-11 h-11 rounded-xl bg-white/[0.06] items-center justify-center ${tint}`}>
                  <Icon size={22} />
                </span>
                <h3 className="mt-4 font-display text-[17px] font-bold text-white leading-snug">{title}</h3>
                <p className="mt-2 text-[14px] text-[#B3BCE6] leading-relaxed">{body}</p>
              </div>
            ))}
          </div>

          {/* Contact strip */}
          <div className="mt-10 bg-white/[0.05] border border-white/[0.12] rounded-card px-6 py-5 flex flex-wrap items-center justify-between gap-4">
            <p className="text-[15px] text-[#C8CEF0]">
              Questions or concerns about how we deploy AI? Talk to us directly.
            </p>
            <Button href={`${WWW}/contact`} variant="outlineWhite" className="px-5 py-2.5">
              Contact us <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      </section>

      {/* ── 8. Closing CTA ────────────────────────────────────────────── */}
      <section className="section-padding bg-white text-center">
        <div className="container-max max-w-2xl">
          <h2 className="font-display text-3xl font-bold text-ink leading-tight">
            Learn more about why we do this
          </h2>
          <p className="mt-4 text-content-secondary leading-relaxed">
            Read our mission, meet the team, or get in touch to find out how Stellr can make an impact in your
            community.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-8">
            <Button href={`${WWW}/about#mission`} variant="primary">
              Our mission
            </Button>
            <Button href={`${WWW}/contact`} variant="secondary">
              Contact us
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}
