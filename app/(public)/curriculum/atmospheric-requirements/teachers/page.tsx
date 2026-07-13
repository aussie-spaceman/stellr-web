import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Hero, Eyebrow, Button, CtaBand } from '@stellr/web-ui'
import { OBJECTIVES, NGSS, TUTORIAL_META } from '../tutorial-data'

export const metadata: Metadata = {
  title: 'Atmospheric Requirements — Teacher Companion',
  description:
    'Facilitation guide for the Atmospheric Requirements tutorial: answer key, timing, common misconceptions, discussion prompts and NGSS alignment.',
}

const TIMING = [
  { phase: 'Hook & objectives', min: 5, note: 'Frame the design problem: a settlement has to make its own air.' },
  { phase: 'Part 1 — pressure & composition', min: 12, note: 'Two worked examples, then the Pressure Explorer.' },
  { phase: 'Part 2 & 3 — health and fire', min: 12, note: 'Altitude, SP-413, the fire triangle and the trade-off table.' },
  { phase: 'Part 4 — other air components', min: 6, note: 'N₂, CO₂, water vapour cards; quick class discussion.' },
  { phase: 'Part 5 — sizing calculator', min: 15, note: 'Work the container problem together, then let pairs change inputs.' },
  { phase: 'Check & wrap', min: 8, note: 'Three self-check questions; surface reasoning as a class.' },
] as const

const ANSWERS = [
  {
    q: 'Example 1 — 700 mmHg total, 150 mmHg pO₂',
    a: '150 ÷ 700 = 0.214 → 21.4% oxygen (essentially Earth-like).',
  },
  {
    q: 'Example 2 — 20% O₂ at 0.65 atm total',
    a: '0.20 × 0.65 = 0.13 atm pO₂ (below Earth’s ~0.16 atm; mild altitude effects).',
  },
  {
    q: 'Q1 — 0.18 atm pO₂ at 0.60 atm total',
    a: '0.18 ÷ 0.60 = 0.30 → 30% oxygen. Above Earth’s 21% because total pressure is lower.',
  },
  {
    q: 'Q2 — 21% O₂ at 0.50 atm total',
    a: '0.21 × 0.50 = 0.105 atm pO₂.',
  },
  {
    q: 'Q3 — same pO₂, cabin A at 1.0 atm vs cabin B at 0.5 atm',
    a: 'Cabin B is more flammable: same pO₂ at half the pressure means double the oxygen fraction, and flammability tracks concentration.',
  },
  {
    q: 'Container problem — 1,000,000 m³, 0.75 atm, pO₂ 0.132 atm',
    a: 'Partial volumes: O₂ 176,000 m³, N₂ 824,000 m³. Adjusted expansion ratios (×0.75): O₂ 0.000872, N₂ 0.001078. Liquid: O₂ ≈ 153.5 m³, N₂ ≈ 887.9 m³ → ≈ 1.5 containers O₂ and 8.9 containers N₂.',
  },
] as const

const MISCONCEPTIONS = [
  {
    myth: '“Lower pressure means less oxygen, so it must be safer from fire.”',
    reality:
      'The opposite is usually true. To keep people healthy at lower total pressure you raise the oxygen fraction, and fire risk tracks that fraction — so low-pressure cabins are often more flammable, not less.',
  },
  {
    myth: '“Percent oxygen and partial pressure of oxygen are the same thing.”',
    reality:
      'They’re linked but distinct. pO₂ is what the lungs respond to; percent is pO₂ divided by total pressure. The same pO₂ can be 21% or 40% depending on total pressure.',
  },
  {
    myth: '“The original worksheet says 1.6 oxygen containers, so that’s the answer.”',
    reality:
      'That figure is a rounding artefact. The calculation gives ≈153.5 m³ of liquid oxygen, or ≈1.5 containers. This rebuild corrects it — a good moment to discuss significant figures.',
  },
  {
    myth: '“Air is basically just oxygen.”',
    reality:
      'Oxygen is only ~21% of Earth’s air. Nitrogen (an inert safety buffer and biological necessity), CO₂ and water vapour all matter to people, plants, electronics and structures.',
  },
] as const

const DISCUSSION = [
  'If shipping gas from Earth is expensive, what’s the argument for a lower total pressure — and what’s the cost of that choice?',
  'Apollo 1 used pure oxygen for engineering convenience. What trade-off were they making, and what changed afterward?',
  'Where else on the settlement (labs, workshops, agriculture) might a different atmosphere be justified?',
  'The maths assumes ideal gas behaviour. When would that assumption break down, and how would you check it?',
] as const

export default function TeacherCompanionPage() {
  return (
    <>
      <Hero
        breadcrumb="Curriculum · Teacher companion"
        title="Atmospheric Requirements — teacher companion"
        lead="Everything you need to run the tutorial with confidence: a full answer key, suggested timing, the misconceptions students hit most, discussion prompts and NGSS alignment."
        pills={[`⏱ ${TUTORIAL_META.time}`, `🎓 ${TUTORIAL_META.level}`, 'Answer key included']}
      >
        <div className="flex flex-wrap gap-3 mt-8">
          <Button href="/curriculum/atmospheric-requirements" as={Link} variant="primary">
            <ArrowLeft size={16} /> Student tutorial
          </Button>
        </div>
      </Hero>

      {/* Objectives + NGSS */}
      <section className="section-padding bg-white">
        <div className="container-max grid gap-10 lg:grid-cols-2">
          <div>
            <Eyebrow>Learning objectives</Eyebrow>
            <h2 className="text-3xl font-bold text-ink mt-3">What students should walk away with</h2>
            <ul className="mt-6 space-y-3">
              {OBJECTIVES.map((o, i) => (
                <li key={i} className="flex gap-3 text-content-secondary leading-relaxed">
                  <span className="text-primary font-bold">{i + 1}.</span>
                  {o}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <Eyebrow>NGSS alignment</Eyebrow>
            <h2 className="text-3xl font-bold text-ink mt-3">Where it maps</h2>
            <p className="text-content-secondary mt-3 text-sm leading-relaxed">
              This is a quantitative engineering-design task, so the strongest fits are the engineering-design
              performance expectations, plus the mathematics practice and the scale/quantity crosscutting concept.
            </p>
            <ul className="mt-5 space-y-3">
              {NGSS.map((n) => (
                <li key={n.code} className="rounded-ds-card border border-line bg-white p-4">
                  <span className="inline-flex items-center rounded-pill bg-primary-soft px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
                    {n.code}
                  </span>
                  <p className="text-content-secondary text-sm mt-2 leading-relaxed">{n.label}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Timing */}
      <section className="section-padding bg-surface">
        <div className="container-max">
          <Eyebrow>Suggested timing</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">A 55–60 minute run</h2>
          <div className="mt-8 overflow-x-auto rounded-panel border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white text-ink text-left">
                  <th className="px-4 py-3 font-subheading font-semibold">Phase</th>
                  <th className="px-4 py-3 font-subheading font-semibold whitespace-nowrap">Minutes</th>
                  <th className="px-4 py-3 font-subheading font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {TIMING.map((t, i) => (
                  <tr key={t.phase} className={i % 2 ? 'bg-surface' : 'bg-white'}>
                    <td className="px-4 py-3 font-medium text-ink">{t.phase}</td>
                    <td className="px-4 py-3 tabular-nums text-content-secondary">{t.min}</td>
                    <td className="px-4 py-3 text-content-secondary leading-relaxed">{t.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Answer key */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <Eyebrow>Answer key</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">Worked answers</h2>
          <div className="mt-8 space-y-4">
            {ANSWERS.map((a) => (
              <div key={a.q} className="rounded-panel border border-line bg-white p-6 shadow-card-lift">
                <p className="font-subheading font-semibold text-ink">{a.q}</p>
                <p className="text-content-secondary mt-2 leading-relaxed">{a.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Misconceptions */}
      <section className="section-padding bg-surface">
        <div className="container-max">
          <Eyebrow>Watch for</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">Common misconceptions</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {MISCONCEPTIONS.map((m) => (
              <div key={m.myth} className="rounded-panel border border-line bg-white p-6">
                <p className="font-semibold text-danger leading-relaxed">{m.myth}</p>
                <p className="text-content-secondary mt-3 text-sm leading-relaxed">{m.reality}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Discussion */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <Eyebrow>Take it further</Eyebrow>
          <h2 className="text-3xl font-bold text-ink mt-3">Discussion prompts</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {DISCUSSION.map((d, i) => (
              <li key={i} className="rounded-ds-card border border-line bg-surface p-5 text-content-secondary leading-relaxed">
                {d}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <CtaBand
        title="Download the lesson pack"
        body="A ready-to-run lesson plan and slide deck accompany this tutorial. Get the full Space Design Challenge material for your classroom."
        actions={
          <Button href="/curriculum" as={Link} variant="primary">
            Browse the curriculum
          </Button>
        }
      />
    </>
  )
}
