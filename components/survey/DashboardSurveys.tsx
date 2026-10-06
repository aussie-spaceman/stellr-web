import Link from 'next/link'
import { ClipboardCheck } from 'lucide-react'
import { Button } from '@stellr/web-ui'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { openSurveysFor } from '@/lib/survey/member'
import { formatDateInZone } from '@/lib/survey/timezone'

// Dashboard card while a post-event survey is open for this member (handover
// A4): one line per survey, straight into the same renderer as the email link.
// Self-contained so the home page only drops it in; renders nothing otherwise.
export async function DashboardSurveys() {
  const member = await getCurrentMember()
  if (!member) return null
  const open = await openSurveysFor(supabaseServer(), member.id).catch(() => [])
  if (!open.length) return null

  return (
    <section className="mb-8 rounded-ds-card border border-line bg-white p-5" aria-labelledby="dash-surveys">
      <div className="flex items-start gap-3">
        <ClipboardCheck size={22} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="dash-surveys" className="font-display text-lg font-bold text-ink">
            {open.length === 1 ? 'How was it? Your event survey is open' : 'Your event surveys are open'}
          </h2>
          <ul className="mt-3 space-y-3">
            {open.map((s) => (
              <li key={s.invitationId} className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{s.eventTitle}</p>
                  <p className="text-sm text-content-muted">
                    About 5 minutes · closes {formatDateInZone(s.closesAt, s.timeZone)}
                  </p>
                </div>
                <Button variant="primaryStrong" href={`/community/surveys/open/${s.invitationId}`} as={Link}>
                  {s.started ? 'Finish survey' : 'Start survey'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
