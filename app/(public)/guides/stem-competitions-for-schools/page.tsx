import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Hero, Eyebrow, Button, CtaBand } from '@stellr/web-ui'
import { GuideFaq } from '@/components/guides/GuideFaq'
import { PROGRAMS, FAQS, CHECKED_ON, SEASON } from '@/content/guides/competitions-compared'

const PATH = '/guides/stem-competitions-for-schools'
const TITLE = 'STEM competitions for your school, compared'
const DESCRIPTION = `Science Olympiad, FIRST, VEX, TSA TEAMS, StellarXplorers, Future City, NASA TechRise, eCYBERMISSION and Stellr compared for teachers — grades, team size, cost, equipment and time, ${SEASON}.`

export const metadata: Metadata = {
  alternates: { canonical: PATH },
  title: TITLE,
  description: DESCRIPTION,
}

const WWW = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

const articleSchema = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: TITLE,
  description: DESCRIPTION,
  url: `${WWW}${PATH}`,
  // Full datetime with offset and an image: the Rich Results Test flags both
  // as missing on a bare date (25 Sept 2026).
  dateModified: '2026-09-24T00:00:00Z',
  image: `${WWW}/images/og-default.jpg`,
  author: { '@type': 'Organization', '@id': `${WWW}/#organization`, name: 'Stellr Education' },
  publisher: { '@id': `${WWW}/#organization` },
  about: PROGRAMS.map((p) => ({ '@type': 'Thing', name: p.name })),
  inLanguage: 'en-US',
}

/** Constraint-first shortcuts — how teachers actually narrow the list. */
const CHOOSE = [
  {
    need: 'No budget',
    pick: 'NASA TechRise, eCYBERMISSION and Stellr Campaigns are free to enter. StellarXplorers is free for Title I schools.',
  },
  {
    need: 'No lab, kit or build space',
    pick: 'eCYBERMISSION, Stellr Campaigns and Stellr live Challenges need none. StellarXplorers needs only Windows PCs.',
  },
  {
    need: 'Students who want to build a robot',
    pick: 'FIRST (LEGO League, Tech Challenge, Robotics Competition) or VEX — budget for hardware and build space.',
  },
  {
    need: 'Fits inside class time',
    pick: 'Stellr Campaigns run in class over 4 or 10 weeks. TSA TEAMS is a single competition day.',
  },
  {
    need: 'Contact with working professionals',
    pick: 'Stellr, Future City, StellarXplorers and eCYBERMISSION all put STEM professionals in front of students as mentors or judges.',
  },
]

export default function StemCompetitionsComparedPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema).replace(/</g, '\\u003c') }}
      />
      <Hero
        breadcrumb="Guides · For teachers"
        title={TITLE}
        lead="The cost, equipment and time each program asks of a school — side by side, so you can pick the one that fits your students and your calendar."
        pills={[`${SEASON} season`, `Checked ${CHECKED_ON}`]}
      />

      {/* Answer first — the paragraph an assistant should be able to quote. */}
      <section className="section-padding bg-white">
        <div className="container-max max-w-content">
          <Eyebrow>In short</Eyebrow>
          <p className="text-xl text-ink mt-3 leading-relaxed">
            For a school with no budget or lab, NASA TechRise, eCYBERMISSION and Stellr Campaigns are free and need
            no equipment. Robotics programs — FIRST and VEX — suit schools with build space and a hardware budget.
            Science Olympiad covers the widest range of subjects. Future City, StellarXplorers and Stellr put students
            in front of working STEM professionals.
          </p>
        </div>
      </section>

      <section className="section-padding bg-surface">
        <div className="container-max">
          <Eyebrow>Choose by constraint</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">Start from what you have</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {CHOOSE.map((c) => (
              <div key={c.need} className="rounded-panel border border-line bg-white p-6">
                <p className="font-subheading font-semibold text-ink">{c.need}</p>
                <p className="text-content-secondary mt-2 leading-relaxed">{c.pick}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-padding bg-white">
        <div className="container-max">
          <Eyebrow>Side by side</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">The {SEASON} programs compared</h2>
          <p className="text-content-secondary mt-3 max-w-content leading-relaxed">
            Checked on {CHECKED_ON} against each program’s own website. Fees and dates change every season — confirm
            with the organizer before you commit. Where a program doesn’t publish a figure, we say so rather than guess.
          </p>
          <div className="mt-8 overflow-x-auto rounded-panel border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface text-ink text-left">
                  <th scope="col" className="px-4 py-3 font-subheading font-semibold">Program</th>
                  <th scope="col" className="px-4 py-3 font-subheading font-semibold">Grades</th>
                  <th scope="col" className="px-4 py-3 font-subheading font-semibold">Team</th>
                  <th scope="col" className="px-4 py-3 font-subheading font-semibold">Cost to enter</th>
                  <th scope="col" className="px-4 py-3 font-subheading font-semibold">Equipment</th>
                  <th scope="col" className="px-4 py-3 font-subheading font-semibold">Format and time</th>
                  <th scope="col" className="px-4 py-3 font-subheading font-semibold">Industry professionals</th>
                </tr>
              </thead>
              <tbody>
                {PROGRAMS.map((p, i) => (
                  <tr key={p.name} className={p.stellr ? 'bg-primary-soft' : i % 2 ? 'bg-surface' : 'bg-white'}>
                    <th scope="row" className="px-4 py-3 text-left align-top">
                      <span className="font-semibold text-ink">{p.name}</span>
                      <span className="block text-xs text-content-secondary mt-1">{p.organizer}</span>
                    </th>
                    <td className="px-4 py-3 align-top text-content-secondary">{p.grades}</td>
                    <td className="px-4 py-3 align-top text-content-secondary">{p.team}</td>
                    <td className="px-4 py-3 align-top text-content-secondary">{p.cost}</td>
                    <td className="px-4 py-3 align-top text-content-secondary">{p.equipment}</td>
                    <td className="px-4 py-3 align-top text-content-secondary">{p.format}</td>
                    <td className="px-4 py-3 align-top text-content-secondary">{p.professionals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-content-secondary mt-4 leading-relaxed">
            VEX changed organizers in May 2026: VEX-branded events now run through the Global Robotics &amp; Science
            Foundation, and the REC Foundation runs a separate RECF Robotics Competition that does not qualify teams
            for VEX Worlds. Check which your region runs before registering.
          </p>
        </div>
      </section>

      <section className="section-padding bg-surface">
        <div className="container-max max-w-content">
          <Eyebrow>Where Stellr fits</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">An engineering company, not a science fair</h2>
          <p className="text-content-secondary mt-4 leading-relaxed">
            Stellr competitions are industry simulations. Your students become an engineering company answering a
            client’s Request for Proposal — for a settlement in space or a net-zero town on Earth — and are judged by
            working professionals. Run it in class as a free Campaign, or bring a team to a one-day live Challenge.
            Nobody needs a lab, a kit or an engineering degree, you included.
          </p>
          <div className="flex flex-wrap gap-3 mt-6">
            <Button href="/guides/run-an-engineering-design-challenge" as={Link} variant="primary">
              How to run one in class <ArrowRight size={16} />
            </Button>
            <Button href="/competitions" as={Link} variant="softBlue">
              About Stellr competitions
            </Button>
          </div>
        </div>
      </section>

      <GuideFaq faqs={FAQS} />

      <section className="section-padding bg-white">
        <div className="container-max max-w-content">
          <Eyebrow>Sources</Eyebrow>
          <ul className="mt-4 space-y-2 text-sm text-content-secondary">
            {PROGRAMS.map((p) => (
              <li key={p.name}>
                <span className="font-medium text-ink">{p.name}:</span>{' '}
                {p.sources.map((s, i) => (
                  <span key={s}>
                    {i > 0 && ' · '}
                    <a href={s} className="underline hover:text-primary" rel="noopener">
                      {new URL(s).hostname.replace(/^www\./, '')}
                    </a>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <CtaBand
        title="Bring a real engineering challenge to your class"
        body="The core Campaign material is free: the Request for Proposal, the Mission Handbook and teacher and student guides."
        actions={
          <>
            <Button href="/curriculum" as={Link} variant="primary">
              Get the material — free
            </Button>
            <Button href="/events" as={Link} variant="outlineWhite">
              Upcoming live Challenges
            </Button>
          </>
        }
      />
    </>
  )
}
