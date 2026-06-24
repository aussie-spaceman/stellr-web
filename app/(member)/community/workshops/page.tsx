import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getCredits } from '@/lib/credits'
import { listMemberWorkshops, type MemberWorkshopCard } from '@/lib/workshops'
import { themeTile } from '@/lib/mentoring-format'

export const metadata = { title: 'Workshops · Your workshops' }

export default async function WorkshopsPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const [workshopCredits, cohortCredits, cards] = await Promise.all([
    getCredits(member, 'workshop'),
    getCredits(member, 'mentoring'),
    listMemberWorkshops(member),
  ])

  const active = cards.filter((c) => c.lifecycle === 'active')
  const completed = cards.filter((c) => c.lifecycle === 'archived')

  return (
    <div className="mx-auto max-w-content space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-subheading text-[13px] font-semibold uppercase tracking-[0.13em] text-space-violet">
            Academy · Coaching workshops
          </p>
          <h1 className="mt-1 font-display text-[34px] font-bold leading-tight tracking-[-0.02em] text-ink">
            Your coaching workshops
          </h1>
          <p className="mt-1.5 max-w-xl text-[15px] text-content-secondary">
            Focused coaching workshops led by a Stellr coach. Join with your membership, a workshop credit, or a one-off payment.
          </p>
        </div>
        <Link
          href="/community/workshops/discover"
          className="inline-flex shrink-0 items-center gap-2 rounded-[9px] bg-primary-soft px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/15"
        >
          <Search className="h-4 w-4" /> Find a workshop
        </Link>
      </header>

      {/* Wallet widget — both balances */}
      <section className="grid gap-3 sm:grid-cols-2">
        <WalletCard label="Workshop credits" value={workshopCredits.remaining} href="/community/workshops/discover" hint="Spend on any open workshop" />
        <WalletCard label="Cohort credits" value={cohortCredits.remaining} href="/community/mentoring/discover" hint="Spend on any mentoring cohort" />
      </section>

      {/* Active workshops */}
      <section className="space-y-3">
        {active.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-line bg-white py-12 text-center">
            <p className="text-sm text-content-muted">
              You&apos;re not in a workshop yet.{' '}
              <Link href="/community/workshops/discover" className="font-semibold text-primary hover:underline">
                Find a workshop to join →
              </Link>
            </p>
          </div>
        ) : (
          active.map((c) => <WorkshopCard key={c.id} c={c} />)
        )}
      </section>

      {completed.length > 0 && (
        <section>
          <h2 className="mb-2 font-subheading text-[12px] font-semibold uppercase tracking-[0.1em] text-content-faint">Completed</h2>
          <ul className="divide-y divide-line-light rounded-[14px] border border-line bg-white">
            {completed.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <span className="text-sm font-medium text-content-secondary">{c.name}</span>
                <Link href={`/community/workshops/${c.id}`} className="text-[13px] font-medium text-content-muted hover:text-primary">
                  View →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function WalletCard({ label, value, href, hint }: { label: string; value: number; href: string; hint: string }) {
  return (
    <Link href={href} className="rounded-card border border-line bg-white p-5 transition-shadow hover:shadow-card-lift">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-content-faint">{label}</p>
      <p className="mt-1 font-display text-[30px] font-bold text-ink">{value}</p>
      <p className="mt-0.5 text-[13px] text-content-muted">{hint}</p>
    </Link>
  )
}

function WorkshopCard({ c }: { c: MemberWorkshopCard }) {
  const tile = themeTile(c.theme)
  return (
    <Link
      href={`/community/workshops/${c.id}`}
      className="group block rounded-card border border-line bg-white p-5 transition-all hover:-translate-y-px hover:shadow-card-lift"
    >
      <div className="flex flex-wrap items-start gap-4">
        <div
          className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-[13px] font-display text-lg font-bold text-white"
          style={{ background: tile.gradient }}
        >
          {c.name.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-[20px] font-bold text-ink">{c.name}</h3>
            <span className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-[11px] font-bold tracking-[0.04em] ${tile.chip}`}>
              {tile.label}
            </span>
            {c.isCoach && (
              <span className="inline-flex items-center rounded-pill bg-primary-soft px-2.5 py-0.5 text-[11px] font-bold text-primary">COACH</span>
            )}
          </div>
          <p className="mt-1 text-[13.5px] text-content-secondary">
            {c.mentorName ?? 'Stellr coach'} · {c.memberCount} member{c.memberCount === 1 ? '' : 's'} · {c.plannedSessions} session{c.plannedSessions === 1 ? '' : 's'}
          </p>
        </div>
      </div>
    </Link>
  )
}
