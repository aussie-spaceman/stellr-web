import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { listMemberWorkshops } from '@/lib/workshops'
import { themeTile } from '@/lib/mentoring-format'

export const metadata = { title: 'Coach workspace · Your workshops' }

// Coach workspace dashboard (handover §4.5 / decision 4 — mirrors the mentor
// workspace at /community/mentoring/manage). Lists the workshops the member
// coaches; each links to its manage surface where resources are added.
export default async function CoachDashboardPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const workshops = (await listMemberWorkshops(member)).filter((w) => w.isCoach)
  if (!member.isAdmin && workshops.length === 0) redirect('/community/workshops')

  const active = workshops.filter((w) => w.lifecycle === 'active')
  const completed = workshops.filter((w) => w.lifecycle === 'archived')

  return (
    <div className="mx-auto max-w-content space-y-7">
      <header>
        <p className="font-subheading text-[13px] font-semibold uppercase tracking-[0.13em] text-pathway-amber">
          Coach workspace
        </p>
        <h1 className="mt-1 font-display text-[34px] font-bold leading-tight tracking-[-0.02em] text-ink">
          Your workshops
        </h1>
      </header>

      <section className="space-y-3">
        {active.length === 0 ? (
          <div className="rounded-card border border-dashed border-line bg-white py-12 text-center">
            <p className="text-sm text-content-muted">You don’t coach any active workshops yet.</p>
          </div>
        ) : (
          active.map((w) => {
            const tile = themeTile(w.theme)
            return (
              <Link
                key={w.id}
                href={`/community/workshops/${w.id}/manage`}
                className="group flex items-center gap-4 rounded-card border border-line bg-white p-5 transition-all hover:-translate-y-px hover:shadow-card-lift"
              >
                <div
                  className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-[13px] font-display text-lg font-bold text-white"
                  style={{ background: tile.gradient }}
                >
                  {w.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-[20px] font-bold text-ink">{w.name}</h3>
                    <span className={`rounded-pill px-2.5 py-0.5 text-[11px] font-bold tracking-[0.04em] ${tile.chip}`}>
                      {tile.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[13.5px] text-content-secondary">
                    {w.memberCount} member{w.memberCount === 1 ? '' : 's'} · {w.plannedSessions} sessions
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-content-faint group-hover:text-primary" />
              </Link>
            )
          })
        )}
      </section>

      {completed.length > 0 && (
        <section>
          <h2 className="mb-2 font-subheading text-[12px] font-semibold uppercase tracking-[0.1em] text-content-faint">
            Completed
          </h2>
          <ul className="divide-y divide-line-light rounded-card border border-line bg-white">
            {completed.map((w) => (
              <li key={w.id} className="flex items-center justify-between px-5 py-3.5">
                <span className="text-sm font-medium text-content-secondary">{w.name}</span>
                <Link
                  href={`/community/workshops/${w.id}/manage`}
                  className="text-[13px] font-medium text-content-muted hover:text-primary"
                >
                  Manage →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
