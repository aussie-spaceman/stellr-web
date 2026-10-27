'use client'

import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Award, Idea, Satellite, Team } from '@stellr/icons'
import { AwardTile, Dialog } from '@stellr/web-ui'
import { PUBLIC_AWARDS, type AssignedAwardType } from '@/lib/event-awards'
import { SUMMER_CAMP } from '@/lib/summer-camp'

const ICONS: Record<AssignedAwardType, React.ElementType> = {
  anita_gale: Idea,
  dick_edwards: Team,
  overall_champion: Award,
  norm_chaffee: Satellite,
}

const DECIDED_BY = { judges: 'Chosen by judges', mentors: 'Chosen by mentors' } as const

/**
 * The four awards as tiles; each opens a Dialog with what it is for, how the
 * winner is chosen, and whether it carries a Summer Camp invitation. The tile
 * summaries are in the page's HTML; the detail repeats in the page FAQ.
 */
export function AwardsShowcase() {
  const [openType, setOpenType] = useState<AssignedAwardType | null>(null)
  const open = PUBLIC_AWARDS.find((a) => a.type === openType)

  return (
    <>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PUBLIC_AWARDS.map((a) => (
          <li key={a.type}>
            <AwardTile
              name={a.name}
              count={a.count}
              decidedBy={DECIDED_BY[a.decidedBy]}
              summary={a.summary}
              Icon={ICONS[a.type]}
              campInvite={a.summerCamp}
              onOpen={() => setOpenType(a.type)}
            />
          </li>
        ))}
      </ul>

      <Dialog
        open={open != null}
        onClose={() => setOpenType(null)}
        title={open ? `The ${open.name}` : ''}
        description={open ? `${open.count} · ${DECIDED_BY[open.decidedBy].toLowerCase()}` : undefined}
        size="lg"
      >
        {open && (
          <div className="space-y-5 text-ds-body text-content-secondary">
            <section>
              <h3 className="font-subheading text-xs font-bold uppercase tracking-[0.08em] text-content-muted">
                What it&rsquo;s for
              </h3>
              <p className="mt-1.5">{open.forWhat}</p>
            </section>
            <section>
              <h3 className="font-subheading text-xs font-bold uppercase tracking-[0.08em] text-content-muted">
                How it&rsquo;s chosen
              </h3>
              <p className="mt-1.5">{open.howChosen}</p>
            </section>
            <section className="rounded-ds-card border border-pathway-amber/30 bg-pathway-amber-bg px-4 py-3.5">
              <h3 className="font-subheading text-xs font-bold uppercase tracking-[0.08em] text-gold-ink">
                {SUMMER_CAMP.name}
              </h3>
              {open.summerCamp ? (
                <p className="mt-1.5">
                  Winners are invited to the {SUMMER_CAMP.name} in {SUMMER_CAMP.when}, run by our partner{' '}
                  <a
                    href={SUMMER_CAMP.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 font-semibold text-primary-deep underline underline-offset-2 hover:no-underline"
                  >
                    {SUMMER_CAMP.partner}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </a>
                  . Attendance carries a fee.
                </p>
              ) : (
                <p className="mt-1.5">
                  Being in the winning company doesn&rsquo;t carry an invitation on its own. Its standout
                  engineers receive the Engineering Excellence Award, which does.
                </p>
              )}
            </section>
          </div>
        )}
      </Dialog>
    </>
  )
}
