'use client'

import { Flame, Wind, Droplets, Leaf } from 'lucide-react'
import { Eyebrow } from '@stellr/web-ui'
import { PressureExplorer } from './PressureExplorer'
import { ContainerCalculator } from './ContainerCalculator'
import { PracticeCheck } from './PracticeCheck'
import { WorkedExample } from './WorkedExample'
import { OBJECTIVES, TRADEOFF_ROWS, SOURCES } from './tutorial-data'

// The "Atmospheric Requirements" lesson body — objectives → Parts 1–5 → practice
// → sources. Shared by the public tutorial page (/curriculum/atmospheric-requirements,
// which adds Hero/CtaBand chrome) and the Training course player (registry key
// 'atmospheric-requirements' in lib/interactive-lessons.tsx). Page chrome stays out.

// Non-oxygen air components (student-facing summary cards).
const COMPONENTS = [
  {
    name: 'Nitrogen',
    Icon: Wind,
    accent: 'text-space-violet',
    chip: 'bg-space-violet-bg text-space-violet-text',
    points: [
      'An inert filler that dilutes the oxygen — a built-in safety margin against fire and sudden pressure loss.',
      'All life needs nitrogen to build cells. Plants can’t use N₂ directly; they rely on nitrogen-fixing bacteria or fertiliser, and animals get it by eating plants.',
    ],
  },
  {
    name: 'Carbon dioxide',
    Icon: Leaf,
    accent: 'text-enviro-green',
    chip: 'bg-enviro-green-bg text-enviro-green-text',
    points: [
      'People breathe it out. Too much is dangerous (hypercapnia); too little is also harmful (hypocapnia).',
      'Plants need it to photosynthesise, and higher CO₂ can boost plant growth. Scrubbers pull the excess back out of the air.',
    ],
  },
  {
    name: 'Water vapour',
    Icon: Droplets,
    accent: 'text-avatar-teal',
    chip: 'bg-white text-avatar-teal',
    points: [
      'People are comfortable with some moisture; too little dries eyes, skin and airways, too much stops sweat from cooling us.',
      'It also drives plant transpiration, electronics condensation and static, metal corrosion, slippery surfaces — and, at 100%, rain.',
    ],
  },
] as const

function SectionHead({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  return (
    <div className="max-w-2xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="text-3xl font-bold text-ink mt-3">{title}</h2>
      {lead && <p className="text-content-secondary mt-3 leading-relaxed">{lead}</p>}
    </div>
  )
}

// Reusable inline formula chip.
function Formula({ children }: { children: React.ReactNode }) {
  return (
    <code className="inline-block rounded-ds-card bg-surface border border-line px-3 py-2 font-display text-ink">
      {children}
    </code>
  )
}

export function AtmosphericRequirements() {
  return (
    <>
      {/* Objectives */}
      <section id="start" className="section-padding bg-white">
        <div className="container-max">
          <SectionHead
            eyebrow="What you’ll be able to do"
            title="By the end, you can size an atmosphere and defend your choices."
          />
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {OBJECTIVES.map((o, i) => (
              <li key={i} className="flex gap-3 rounded-ds-card border border-line bg-white p-5 shadow-card-lift">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary font-display font-bold text-sm">
                  {i + 1}
                </span>
                <span className="text-content-secondary leading-relaxed">{o}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Concept 1 — pressure & composition */}
      <section className="section-padding bg-surface">
        <div className="container-max space-y-8">
          <SectionHead
            eyebrow="Part 1 · The core relationship"
            title="How total pressure sets the oxygen fraction"
            lead="Air is a mixture, and each gas contributes its own “partial pressure”. Oxygen’s share of the total is what your body — and any fire — actually responds to."
          />
          <div className="flex flex-wrap gap-4">
            <Formula>Partial pressure of O₂ = Total pressure × Fraction of O₂</Formula>
            <Formula>Fraction of O₂ = Partial pressure of O₂ ÷ Total pressure</Formula>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <WorkedExample
              prompt={
                <>
                  <strong className="text-ink">Example 1.</strong> A container has a total pressure of 700 mmHg and a
                  partial pressure of oxygen of 150 mmHg. What percent oxygen do you have?
                </>
              }
            >
              <p>Fraction of O₂ = pO₂ ÷ total pressure = 150 ÷ 700 = 0.214.</p>
              <p>
                <strong className="text-ink">≈ 21.4% oxygen</strong> — almost exactly Earth’s 21%.
              </p>
            </WorkedExample>

            <WorkedExample
              prompt={
                <>
                  <strong className="text-ink">Example 2.</strong> You must have 20% oxygen in a system that runs at only
                  0.65 Earth atmospheres of pressure. What is the partial pressure of oxygen?
                </>
              }
            >
              <p>pO₂ = fraction × total pressure = 0.20 × 0.65 = 0.13.</p>
              <p>
                <strong className="text-ink">pO₂ = 0.13 atm.</strong> Below Earth’s ~0.16 atm, so occupants would feel
                mild altitude effects.
              </p>
            </WorkedExample>
          </div>

          <div>
            <h3 className="font-display text-xl font-bold text-ink">Try it yourself</h3>
            <p className="text-content-secondary mt-1 mb-4 leading-relaxed">
              Move the sliders and watch the oxygen fraction — and the comfort and fire read-outs — respond.
            </p>
            <PressureExplorer />
          </div>
        </div>
      </section>

      {/* Concept 2 — how much oxygen people need */}
      <section className="section-padding bg-white">
        <div className="container-max space-y-6">
          <SectionHead
            eyebrow="Part 2 · Keeping people healthy"
            title="How much oxygen do people actually need?"
            lead="As a rule, the lower the total pressure, the higher the percent oxygen you need to keep people healthy. People survive at altitude, but not without consequences."
          />
          <p className="text-content-secondary max-w-2xl leading-relaxed">
            NASA’s foundational study{' '}
            <a
              href="https://nss.org/settlement/nasa/75SummerStudy/Chapt3.html"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-primary"
            >
              Space Settlements: A Design Study (SP-413)
            </a>{' '}
            recommends keeping the partial pressure of oxygen close to what the lungs need for good respiration — roughly
            0.13 atm (~100 mmHg) — with a tolerance band on either side. Go too low and you risk hypoxia; too high and you
            risk other effects on the blood. We’ll use that recommended value in the sizing problem later.
          </p>
        </div>
      </section>

      {/* Concept 3 — flammability */}
      <section className="section-padding bg-surface">
        <div className="container-max space-y-6">
          <SectionHead
            eyebrow="Part 3 · Keeping fires in check"
            title="Why the oxygen fraction — not just the pressure — drives fire"
          />
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-start">
            <div className="space-y-4 text-content-secondary leading-relaxed">
              <p>
                A fire needs three things at once: <strong className="text-ink">fuel, heat, and oxygen</strong> (an
                oxidiser). Remove any one and it can’t burn — that’s the fire triangle.
              </p>
              <p>
                The Apollo 1 tragedy showed the stakes: a spark in a{' '}
                <strong className="text-ink">pure-oxygen cabin</strong> caused a fire that killed three astronauts during
                a ground test. NASA later switched ground tests to a nitrogen–oxygen mix.
              </p>
              <p>
                A key NASA finding: <strong className="text-ink">oxygen concentration matters more than partial
                pressure</strong> for flammability. A higher percent oxygen raises fire risk faster than a higher partial
                pressure does. So a designer wants to keep the oxygen fraction as low as human health allows.
              </p>
            </div>
            <div className="rounded-panel border border-line bg-white p-6">
              <div className="flex items-center gap-2 text-danger">
                <Flame size={20} />
                <span className="font-subheading font-semibold">The fire triangle</span>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-content-secondary">
                <li className="rounded-ds-card bg-surface border border-line px-4 py-3">🔥 Heat — an ignition source</li>
                <li className="rounded-ds-card bg-surface border border-line px-4 py-3">🪵 Fuel — anything that burns</li>
                <li className="rounded-ds-card bg-surface border border-line px-4 py-3">💨 Oxygen — the oxidiser</li>
              </ul>
            </div>
          </div>

          {/* Trade-off table */}
          <div>
            <h3 className="font-display text-xl font-bold text-ink mt-4">What does the trade-off look like?</h3>
            <p className="text-content-secondary mt-1 mb-4 max-w-2xl leading-relaxed">
              Hold the oxygen partial pressure steady and lower the total pressure, and the oxygen fraction climbs fast.
              At a low total pressure, each extra bit of oxygen pushes the percentage up much more quickly.
            </p>
            <div className="overflow-x-auto rounded-panel border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-white text-ink text-left">
                    <th className="px-4 py-3 font-subheading font-semibold">Total pressure (atm)</th>
                    <th className="px-4 py-3 font-subheading font-semibold">pO₂ (atm)</th>
                    <th className="px-4 py-3 font-subheading font-semibold">% Oxygen</th>
                  </tr>
                </thead>
                <tbody>
                  {TRADEOFF_ROWS.map((r, i) => (
                    <tr key={i} className={i % 2 ? 'bg-surface' : 'bg-white'}>
                      <td className="px-4 py-2 tabular-nums text-content-secondary">{r.total}</td>
                      <td className="px-4 py-2 tabular-nums text-content-secondary">{r.ppo2}</td>
                      <td
                        className={`px-4 py-2 tabular-nums font-semibold ${
                          r.pct <= 23 ? 'text-enviro-green' : r.pct <= 35 ? 'text-pathway-amber-deep' : 'text-danger'
                        }`}
                      >
                        {r.pct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-content-secondary mt-4 max-w-2xl leading-relaxed">
              There’s no single percentage where things “suddenly” catch fire — the designer has to decide how far to
              deviate from well-understood Earth-like conditions, weighing fire risk, human comfort, the cost of shipping
              and replenishing gas, material availability, and the structure needed to hold the pressure.
            </p>
          </div>
        </div>
      </section>

      {/* Concept 4 — non-oxygen components */}
      <section className="section-padding bg-white">
        <div className="container-max space-y-8">
          <SectionHead
            eyebrow="Part 4 · The rest of the air"
            title="What the non-oxygen components do for you"
            lead="Air is far more than oxygen. The three biggest other components each earn their place."
          />
          <div className="grid gap-5 md:grid-cols-3">
            {COMPONENTS.map((c) => (
              <div key={c.name} className="flex flex-col rounded-panel border border-line bg-white p-6 shadow-card-lift">
                <div className="flex items-center gap-3">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-ds-card border border-line ${c.accent}`}>
                    <c.Icon size={20} />
                  </span>
                  <h3 className="font-display text-lg font-bold text-ink">{c.name}</h3>
                </div>
                <ul className="mt-4 space-y-3 text-sm text-content-secondary leading-relaxed">
                  {c.points.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-content-secondary max-w-2xl leading-relaxed text-sm">
            Beyond air, remember that other gases in industrial systems have flammable and explosive limits (LEL/LFL and
            UEL/UFL) — ranges of concentration where they can ignite. Good practice is to keep those in mind whenever a
            system holds a gas other than air.
          </p>
        </div>
      </section>

      {/* Concept 5 — sizing the gas */}
      <section className="section-padding bg-surface">
        <div className="container-max space-y-6">
          <SectionHead
            eyebrow="Part 5 · Putting it together"
            title="How much air does a settlement need?"
            lead="A settlement of 1,000,000 m³ runs at 0.75 atm and 20 °C. Using the NASA-recommended oxygen partial pressure and nitrogen for the rest, how many 100 m³ cargo containers of each gas does it take to fill it?"
          />
          <ContainerCalculator />
        </div>
      </section>

      {/* Practice */}
      <section className="section-padding bg-white">
        <div className="container-max space-y-6">
          <SectionHead
            eyebrow="Check your understanding"
            title="Three quick questions"
            lead="Answers check instantly and the reasoning reveals as you go. Nothing is recorded — this is just for you."
          />
          <PracticeCheck />
        </div>
      </section>

      {/* Sources */}
      <section className="section-padding bg-surface">
        <div className="container-max">
          <SectionHead eyebrow="Go deeper" title="Sources and further reading" />
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {SOURCES.map((group) => (
              <div key={group.group}>
                <h3 className="font-subheading font-semibold text-ink">{group.group}</h3>
                <ul className="mt-3 space-y-2 text-sm">
                  {group.items.map((s) => (
                    <li key={s.href}>
                      <a
                        href={s.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline leading-relaxed"
                      >
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
