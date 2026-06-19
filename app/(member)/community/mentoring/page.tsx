import { redirect } from 'next/navigation'
import { formatDateShort } from '@/lib/utils'
import Link from 'next/link'
import { Users, ChevronRight } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getEntitlement, getMemberActions, listMemberCohorts, listCohortInvites, listMemberSessions } from '@/lib/sessions'
import { getUpcomingReminders } from '@/lib/reminders'
import { ActionChecklist } from '@/components/community/ActionChecklist'
import { CohortInviteCard } from '@/components/community/CohortInviteCard'
import { SessionCalendar } from '@/components/community/SessionCalendar'

export const metadata = { title: 'Community · Mentoring' }

export default async function MentoringPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const [ent, actions, cohorts, invites, sessions, reminders] = await Promise.all([
    getEntitlement(member, 'mentoring'),
    getMemberActions(member.id),
    listMemberCohorts(member.id),
    listCohortInvites(member.id),
    listMemberSessions(member.id),
    getUpcomingReminders(member.id),
  ])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">Mentoring</h1>
        <p className="mt-1 text-sm text-brand-muted-soft">
          Small-group mentoring with a Stellr-approved mentor. Open a cohort for its sessions, chat,
          training, and recordings.
        </p>
      </div>

      <div className="rounded-lg border border-brand-border bg-white p-4 text-sm">
        <span className="font-semibold text-brand-blue-dark">{ent.remaining}</span> of {ent.included} included
        sessions remaining
        {ent.extraCredits > 0 && <span className="text-brand-blue"> · {ent.extraCredits} purchased</span>}
        {ent.expiresAt && (
          <span className="text-brand-muted-soft"> · expires {formatDateShort(ent.expiresAt)}</span>
        )}
      </div>

      {reminders.length > 0 && (
        <div className="space-y-1">
          {reminders.filter((r) => r.bucket === '1day').length > 0 && (
            <div className="rounded-lg border border-brand-orange bg-brand-orange/5 px-4 py-2 text-sm text-brand-gold-ink">
              <strong>Tomorrow:</strong>{' '}
              {reminders.filter((r) => r.bucket === '1day').map((r) => r.title).join(', ')}
            </div>
          )}
          {reminders.filter((r) => r.bucket === '1week').length > 0 && (
            <div className="rounded-lg border border-brand-blue/30 bg-brand-blue/5 px-4 py-2 text-sm text-brand-blue">
              <strong>This week:</strong>{' '}
              {reminders.filter((r) => r.bucket === '1week').map((r) => r.title).join(', ')}
            </div>
          )}
        </div>
      )}

      <section>
        <h2 className="mb-3 text-sm font-subheading font-semibold uppercase tracking-wide text-brand-muted-soft">Calendar</h2>
        <div className="rounded-lg border border-brand-border bg-white p-4">
          <SessionCalendar sessions={sessions} />
        </div>
      </section>

      {invites.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-subheading font-semibold uppercase tracking-wide text-brand-muted-soft">Invitations</h2>
          <ul className="space-y-2">
            {invites.map((inv) => (
              <li key={inv.cohortId}>
                <CohortInviteCard cohortId={inv.cohortId} name={inv.name} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-subheading font-semibold uppercase tracking-wide text-brand-muted-soft">Your cohorts</h2>
        {cohorts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-brand-border py-10 text-center">
            <Users className="mx-auto h-7 w-7 text-brand-muted-soft" />
            <p className="mt-2 text-sm text-brand-muted-soft">
              You&apos;re not in a mentoring cohort yet. An administrator will add you to one.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {cohorts.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/community/mentoring/${c.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-brand-border bg-white p-4 hover:border-brand-border"
                >
                  <div>
                    <p className="flex items-center gap-2 font-medium text-brand-blue-dark">
                      {c.name}
                      {c.isMentor && (
                        <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700">
                          Mentor
                        </span>
                      )}
                      {c.lifecycle === 'archived' && (
                        <span className="rounded-full bg-brand-hairline px-2 py-0.5 text-[11px] font-medium text-brand-muted-soft">
                          Archived
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-brand-muted-soft">{c.memberCount} members</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-brand-muted-soft" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-subheading font-semibold uppercase tracking-wide text-brand-muted-soft">My actions</h2>
        <ActionChecklist actions={actions} />
      </section>
    </div>
  )
}
