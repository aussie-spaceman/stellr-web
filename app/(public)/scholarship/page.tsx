import type { Metadata } from 'next'
import { Award, Team } from '@stellr/icons'
import { Eyebrow } from '@stellr/web-ui'
import { getAllEvents, type StellarEvent } from '@/lib/sanity'
import { ScholarshipForm } from '@/components/forms/ScholarshipForm'

export const metadata: Metadata = {
  title: 'Scholarships',
  description:
    "Cost should never be the reason you don't compete. Apply for a Stellr scholarship and we'll cover the participation fee for the competition or workshop you're applying to.",
}

export const revalidate = 3600

/* Fallback list when Sanity is unconfigured or returns no open events. */
const FALLBACK_ACTIVITIES = [
  'Space Design Competition',
  'Orbital Habitat Challenge',
  'Lunar Resource Run',
  'Environmental Design Competition',
  'Hands-on Workshop',
  'Not sure yet',
]

const infoCards = [
  {
    Icon: Award,
    tileBg: 'bg-primary-soft',
    iconColor: 'text-primary',
    title: 'What it covers',
    body: "The full participation fee for the Stellr competition or workshop you're applying to.",
  },
  {
    Icon: Team,
    tileBg: 'bg-enviro-green-bg',
    iconColor: 'text-enviro-green',
    title: "Who it's for",
    body: "Any student whose circumstances might otherwise prevent them from taking part. You don't need to explain more than you're comfortable with.",
  },
]

export default async function ScholarshipPage() {
  const events: StellarEvent[] = (await getAllEvents().catch(() => [])) ?? []
  const liveTitles = Array.from(new Set(events.map((e) => e.title).filter(Boolean))) as string[]
  const usedFallback = liveTitles.length === 0
  const activities = usedFallback ? FALLBACK_ACTIVITIES : [...liveTitles, 'Not sure yet']

  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-midnight text-white pt-16 pb-[70px] px-4 sm:px-6 lg:px-8 bg-[radial-gradient(120%_130%_at_85%_-10%,#28306B_0%,#141A3D_45%,#0E1330_100%)]">
        <div className="container-max">
          <Eyebrow className="text-[#9FB0FF]">Educate · Scholarships</Eyebrow>
          <h1 className="mt-4 text-4xl sm:text-5xl font-bold tracking-display leading-[1.05] max-w-[760px]">
            Cost should never be the reason you don&rsquo;t compete.
          </h1>
          <p className="mt-5 text-lg text-hero-lead leading-relaxed max-w-[620px]">
            Stellr is committed to inclusive events where every student can take part and do their best work.
            If participation fees stand in the way, apply for a scholarship — we&rsquo;ll cover the cost.
          </p>
        </div>
      </section>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <section className="bg-surface section-padding">
        <div className="container-max grid grid-cols-1 lg:grid-cols-[0.82fr_1.18fr] gap-12 items-start">
          {/* Explainer */}
          <div>
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold text-ink leading-tight">A simple, confidential ask</h2>
            <p className="mt-4 text-[15.5px] text-content-secondary leading-relaxed">
              Fill out the form and our Scholarships Committee will review your application and follow up by
              email. Applications are kept confidential.
            </p>

            <div className="flex flex-col gap-3.5 mt-6">
              {infoCards.map(({ Icon, tileBg, iconColor, title, body }) => (
                <div
                  key={title}
                  className="flex gap-4 bg-white border border-line rounded-ds-card px-[22px] py-5"
                >
                  <span className={`shrink-0 w-10 h-10 rounded-[10px] flex items-center justify-center ${tileBg} ${iconColor}`}>
                    <Icon size={22} />
                  </span>
                  <div>
                    <h3 className="font-display text-base font-semibold text-ink">{title}</h3>
                    <p className="mt-1 text-sm text-content-secondary leading-relaxed">{body}</p>
                  </div>
                </div>
              ))}

              {/* Caveat note */}
              <div className="flex gap-3 bg-[#FBEFDD] border border-[#F0DEBF] rounded-ds-card px-[22px] py-[18px]">
                <span className="shrink-0 font-display font-bold text-[#C9892C] text-lg leading-none mt-0.5">
                  !
                </span>
                <p className="text-[13.5px] text-[#7A5A1E] leading-relaxed">
                  Scholarships cover direct event costs only — not additional expenses such as travel or
                  accommodation.
                </p>
              </div>
            </div>
          </div>

          {/* Application form card */}
          <div className="bg-white border border-line rounded-panel shadow-card-lift p-7 sm:p-9">
            <ScholarshipForm activities={activities} usedFallback={usedFallback} />
          </div>
        </div>
      </section>
    </>
  )
}
