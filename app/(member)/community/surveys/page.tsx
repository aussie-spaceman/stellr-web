import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ClipboardCheck } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { openSurveysFor, surveyHistoryFor } from '@/lib/survey/member'
import { formatDateInZone } from '@/lib/survey/timezone'
import { formatDateShort } from '@/lib/utils'

export const metadata = { title: 'My surveys' }
export const dynamic = 'force-dynamic'

// "My surveys" (handover P3): open surveys to answer, and every survey you've
// submitted, each viewable read-only. Your own responses only.
export default async function MySurveysPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up?next=/community/surveys')
  const db = supabaseServer()
  const [open, history] = await Promise.all([openSurveysFor(db, member.id), surveyHistoryFor(db, member.id)])

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">My surveys</h1>
        <p className="mt-1 text-sm text-brand-muted-soft">
          After each event we ask what worked and what to change. Your answers are seen by Stellr staff and reported only as combined totals.
        </p>
      </div>

      {open.length > 0 && (
        <section className="mb-8">
          <h2 className="text-ds-eyebrow font-bold uppercase tracking-widest text-primary">Open now</h2>
          <ul className="mt-3 divide-y divide-line-light rounded-ds-card border border-line bg-white">
            {open.map((s) => (
              <li key={s.invitationId} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold text-ink">{s.eventTitle}</p>
                  <p className="text-sm text-content-muted">Closes {formatDateInZone(s.closesAt, s.timeZone)}</p>
                </div>
                <Link href={`/community/surveys/open/${s.invitationId}`} className="text-sm font-semibold text-primary hover:underline">
                  {s.started ? 'Finish' : 'Start'} →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-ds-eyebrow font-bold uppercase tracking-widest text-content-muted">Submitted</h2>
        {history.length === 0 ? (
          <div className="mt-3 rounded-ds-card border border-line bg-white p-8 text-center">
            <ClipboardCheck size={28} className="mx-auto text-content-faint" aria-hidden="true" />
            <p className="mt-3 font-semibold text-ink">No submitted surveys yet</p>
            <p className="mt-1 text-sm text-content-secondary">After an event, your survey appears here once you’ve sent it.</p>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line-light rounded-ds-card border border-line bg-white">
            {history.map((h) => (
              <li key={h.responseId} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold text-ink">{h.eventTitle}</p>
                  <p className="text-sm text-content-muted">Submitted {formatDateShort(h.submittedAt)}</p>
                </div>
                <Link href={`/community/surveys/${h.responseId}`} className="text-sm font-semibold text-primary hover:underline">
                  View answers →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
