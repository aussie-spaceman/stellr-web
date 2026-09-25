import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Hero, Eyebrow, Button, CtaBand } from '@stellr/web-ui'
import { GuideFaq } from '@/components/guides/GuideFaq'
import { STAGES, CRITERIA, FAQS } from '@/content/guides/run-a-design-challenge'

const PATH = '/guides/run-an-engineering-design-challenge'
const TITLE = 'How to run an engineering design challenge in your classroom'
const DESCRIPTION =
  'A teacher’s summary of running an industry-simulation design challenge — no lab, no kit, no engineering background: the eight stages and how proposals are judged.'

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
  dateModified: '2026-09-25',
  author: { '@type': 'Organization', '@id': `${WWW}/#organization`, name: 'Stellr Education' },
  publisher: { '@id': `${WWW}/#organization` },
  audience: { '@type': 'EducationalAudience', educationalRole: 'teacher' },
  inLanguage: 'en-US',
}

// A summary on purpose — the full facilitation guide is member material.
// See content/guides/run-a-design-challenge.ts before adding sections.
export default function RunADesignChallengePage() {
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
        <div className="container-max max-w-content">
          <Eyebrow>The process</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">Eight stages, whatever the length</h2>
          <p className="text-content-secondary mt-3 leading-relaxed">
            A four-week and a ten-week challenge run through the same stages.
          </p>
          <ol className="mt-8 space-y-3">
            {STAGES.map((s, i) => (
              <li key={s.stage} className="flex gap-4 rounded-ds-card border border-line bg-white p-4">
                <span className="font-subheading font-semibold text-primary tabular-nums">{i + 1}</span>
                <p className="text-content-secondary leading-relaxed">
                  <span className="font-semibold text-ink">{s.stage}.</span> {s.what}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section-padding bg-white">
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
