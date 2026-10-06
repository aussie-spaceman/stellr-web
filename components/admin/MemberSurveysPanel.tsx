import Link from 'next/link'
import { formatDateShort } from '@/lib/utils'
import { adminSurveyResponseHref } from '@/lib/activity-links'
// Types only: lib/survey/history reaches the Sanity client through the schedule rules.
import type { MemberSurveyItem, SurveyStatusKey } from '@/lib/survey/history'

const STATUS_CLS: Record<SurveyStatusKey, string> = {
  submitted: 'bg-enviro-green-bg text-enviro-green-text',
  started: 'bg-pathway-amber-bg text-ink',
  opened: 'bg-primary-soft text-primary-deep',
  invited: 'bg-primary-soft text-primary-deep',
  closed: 'bg-line-light text-content-body',
  bounced: 'bg-line-light text-danger',
}

// The member's post-event surveys on their admin page: every invitation, where
// it stands, and the answers for a submitted one (each view is logged).
export function MemberSurveysPanel({ memberId, items }: { memberId: string; items: MemberSurveyItem[] }) {
  return (
    <div className="bg-white rounded-xl border border-line p-6">
      <h2 className="text-base font-semibold text-ink mb-4">Surveys</h2>
      {items.length === 0 ? (
        <p className="text-sm text-content-muted">No survey invitations yet.</p>
      ) : (
        <ul className="divide-y divide-line-light">
          {items.map((s) => (
            <li key={s.invitationId} className="py-3 first:pt-0 last:pb-0 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">{s.eventTitle}</p>
                <p className="text-xs text-content-body mt-0.5">
                  {s.role} · invited {formatDateShort(s.invitedAt)}
                  {s.submittedAt ? ` · submitted ${formatDateShort(s.submittedAt)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLS[s.status]}`}>
                  {s.statusLabel}
                </span>
                {s.status === 'submitted' && s.responseId && (
                  <Link href={adminSurveyResponseHref(memberId, s.responseId)} className="text-xs font-semibold text-primary hover:text-primary-deep">
                    View answers →
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
