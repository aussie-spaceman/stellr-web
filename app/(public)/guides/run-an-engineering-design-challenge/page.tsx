import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Hero, Eyebrow, Button, CtaBand } from '@stellr/web-ui'
import { GuideFaq } from '@/components/guides/GuideFaq'
import {
  STAGES,
  FIRST_SESSION,
  TRADE_STUDY,
  tradeStudyTotals,
  SENSITIVITY_WEIGHTS,
  WHEN_TO_STEP_IN,
  CRITERIA,
  FAQS,
} from '@/content/guides/run-a-design-challenge'

const PATH = '/guides/run-an-engineering-design-challenge'
const TITLE = 'How to run an engineering design challenge in your classroom'
const DESCRIPTION =
  'A teacher’s guide to running an industry-simulation design challenge — no lab, no kit, no engineering background. The eight stages, your first session, trade studies and assessment.'

export const metadata: Metadata = {
  alternates: { canonical: PATH },
  title: 'Run an engineering design challenge in class',
  description: DESCRIPTION,
}

const WWW = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

const articleSchema = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: TITLE,
  description: DESCRIPTION,
  url: `${WWW}${PATH}`,
  dateModified: '2026-09-24',
  author: { '@type': 'Organization', '@id': `${WWW}/#organization`, name: 'Stellr Education' },
  publisher: { '@id': `${WWW}/#organization` },
  audience: { '@type': 'EducationalAudience', educationalRole: 'teacher' },
  inLanguage: 'en-US',
}

const fmt = (n: number) => n.toFixed(2)

export default function RunADesignChallengePage() {
  const totals = tradeStudyTotals()
  const shifted = tradeStudyTotals(SENSITIVITY_WEIGHTS)

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema).replace(/</g, '\\u003c') }}
      />
      <Hero
        breadcrumb="Guides · For teachers"
        title={TITLE}
        lead="Your class becomes an engineering company bidding for a client’s contract. You run the process; the students do the engineering."
        pills={['No lab or kit', '4 or 10 weeks', 'Grades 9–12']}
      />

      {/* Answer first — the paragraph an assistant should be able to quote. */}
      <section className="section-padding bg-white">
        <div className="container-max max-w-content">
          <Eyebrow>In short</Eyebrow>
          <p className="text-xl text-ink mt-3 leading-relaxed">
            Give the class a client’s Request for Proposal, split it into departments with a student CEO, and have
            every requirement owned by a named student. Students research options, choose between them with a
            weighted trade study, freeze the design, then write and self-assess a proposal against a rubric. You
            manage owners and deadlines — not the engineering answers.
          </p>
          <p className="text-content-secondary mt-6 leading-relaxed">
            The engineering is the vehicle. What students actually practise is deciding with incomplete information,
            handing work between teams, and defending a choice with evidence. You need no lab, no kit and no
            engineering background.
          </p>
        </div>
      </section>

      <section className="section-padding bg-surface">
        <div className="container-max">
          <Eyebrow>The process</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">Eight stages, whatever the length</h2>
          <p className="text-content-secondary mt-3 max-w-content leading-relaxed">
            A four-week and a ten-week challenge run through the same stages. Knowing which one the class is in tells
            you what to do this week.
          </p>
          <div className="mt-8 overflow-x-auto rounded-panel border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white text-ink text-left">
                  <th scope="col" className="px-4 py-3 font-subheading font-semibold">Stage</th>
                  <th scope="col" className="px-4 py-3 font-subheading font-semibold">What happens</th>
                  <th scope="col" className="px-4 py-3 font-subheading font-semibold">Your job</th>
                </tr>
              </thead>
              <tbody>
                {STAGES.map((s, i) => (
                  <tr key={s.stage} className={i % 2 ? 'bg-surface' : 'bg-white'}>
                    <th scope="row" className="px-4 py-3 text-left font-medium text-ink whitespace-nowrap">
                      {i + 1}. {s.stage}
                    </th>
                    <td className="px-4 py-3 text-content-secondary leading-relaxed">{s.what}</td>
                    <td className="px-4 py-3 text-content-secondary leading-relaxed">{s.you}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-content-secondary mt-4 max-w-content leading-relaxed">
            <strong className="text-ink">Watch for looping.</strong> A class that goes Decide → Freeze → Decide →
            Freeze never reaches the proposal. The freeze is where you spend your authority.
          </p>
        </div>
      </section>

      <section className="section-padding bg-white">
        <div className="container-max">
          <Eyebrow>Session one</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">Form the company in one lesson</h2>
          <div className="mt-8 overflow-x-auto rounded-panel border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface text-ink text-left">
                  <th scope="col" className="px-4 py-3 font-subheading font-semibold">Step</th>
                  <th scope="col" className="px-4 py-3 font-subheading font-semibold whitespace-nowrap">Minutes</th>
                  <th scope="col" className="px-4 py-3 font-subheading font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {FIRST_SESSION.map((s, i) => (
                  <tr key={s.step} className={i % 2 ? 'bg-surface' : 'bg-white'}>
                    <th scope="row" className="px-4 py-3 text-left font-medium text-ink">{s.step}</th>
                    <td className="px-4 py-3 tabular-nums text-content-secondary">{s.min}</td>
                    <td className="px-4 py-3 text-content-secondary leading-relaxed">{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-content-secondary mt-4 max-w-content leading-relaxed">
            When they want to start designing on day one, say it plainly: you don’t know what the client wants yet.
            Every hour spent understanding the brief saves three later.
          </p>
        </div>
      </section>

      <section className="section-padding bg-surface">
        <div className="container-max">
          <Eyebrow>Deciding well</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">A worked trade study</h2>
          <p className="text-content-secondary mt-3 max-w-content leading-relaxed">
            Students score two or three real options against weighted criteria drawn from the brief, then decide on
            the numbers rather than on who argues loudest.
          </p>
          <div className="mt-8 overflow-x-auto rounded-panel border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white text-ink text-left">
                  <th scope="col" className="px-4 py-3 font-subheading font-semibold">Criterion (weight)</th>
                  {TRADE_STUDY.options.map((o) => (
                    <th key={o} scope="col" className="px-4 py-3 font-subheading font-semibold text-right">{o}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TRADE_STUDY.criteria.map((c, i) => (
                  <tr key={c.name} className={i % 2 ? 'bg-surface' : 'bg-white'}>
                    <th scope="row" className="px-4 py-3 text-left font-medium text-ink">
                      {c.name} ({c.weight}%)
                    </th>
                    {c.scores.map((s, k) => (
                      <td key={k} className="px-4 py-3 text-right tabular-nums text-content-secondary">{s}</td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-primary-soft">
                  <th scope="row" className="px-4 py-3 text-left font-semibold text-ink">Weighted total</th>
                  {totals.map((t, k) => (
                    <td key={k} className="px-4 py-3 text-right tabular-nums font-semibold text-ink">{fmt(t)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-content-secondary mt-4 max-w-content leading-relaxed">
            <strong className="text-ink">Teach the sensitivity check.</strong> Option A wins at {fmt(totals[0])}, but
            move ten points of weight from “meets the hardest constraint” to “room to grow” and C overtakes it (
            {fmt(shifted[2])} against {fmt(shifted[0])}). A proposal that says the decision was close, and why it went
            the way it did, is more credible than one that pretends it was obvious. Then the CEO freezes the decision
            in writing — and you back it.
          </p>
        </div>
      </section>

      <section className="section-padding bg-white">
        <div className="container-max">
          <Eyebrow>Your role</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">Step in on process, never on content</h2>
          <p className="text-content-secondary mt-3 max-w-content leading-relaxed">
            Process failures compound and cost the whole class. Content mistakes are the learning.
          </p>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {WHEN_TO_STEP_IN.map((w) => (
              <div key={w.if} className="rounded-panel border border-line bg-white p-6">
                <p className="font-subheading font-semibold text-ink">If {w.if.charAt(0).toLowerCase() + w.if.slice(1)}</p>
                <p className="text-content-secondary mt-2 leading-relaxed">{w.then}</p>
                <p className="text-sm text-content-secondary mt-2">Don’t: {w.not}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-padding bg-surface">
        <div className="container-max">
          <Eyebrow>Assessment</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">Three questions, equally weighted</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {CRITERIA.map((c) => (
              <div key={c.name} className="rounded-panel border border-line bg-white p-6">
                <p className="font-subheading font-semibold text-ink">{c.name}</p>
                <p className="text-content-secondary mt-2 leading-relaxed">{c.ask}</p>
              </div>
            ))}
          </div>
          <p className="text-content-secondary mt-6 max-w-content leading-relaxed">
            Score each criterion on its own, choosing the band that describes the work before the number within it —
            and mark the work, not the effort. Have students score their own draft first: anything below six becomes
            a fix list with an owner and a time estimate. It is the most valuable hour of the challenge.
          </p>
        </div>
      </section>

      <GuideFaq faqs={FAQS} />

      <section className="section-padding bg-surface">
        <div className="container-max max-w-content">
          <Eyebrow>Related</Eyebrow>
          <div className="flex flex-wrap gap-3 mt-4">
            <Button href="/guides/stem-competitions-for-schools" as={Link} variant="softBlue">
              STEM competitions compared <ArrowRight size={16} />
            </Button>
            <Button href="/curriculum/atmospheric-requirements" as={Link} variant="softBlue">
              A worked tutorial: atmospheric requirements <ArrowRight size={16} />
            </Button>
            <Button href="/grant" as={Link} variant="softBlue">
              Teacher Grant Program <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      </section>

      <CtaBand
        title="Get the brief, the handbook and the guides — free"
        body="A free Educator account gives you the Request for Proposal, the Mission Handbook, teacher and student Campaign guides, and written judging feedback if your class submits."
        actions={
          <>
            <Button href="/curriculum" as={Link} variant="primary">
              Get the material — free
            </Button>
            <Button href="/events/space-design-campaign-fall" as={Link} variant="outlineWhite">
              Enter the Fall Campaign
            </Button>
          </>
        }
      />
    </>
  )
}
