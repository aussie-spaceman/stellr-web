import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { participantIdsFor } from '@/lib/survey/access'
import { submittedResponseById } from '@/lib/survey/member'
import { responseBelongsTo, surveyRoleLabel } from '@/lib/survey/history'
import { logSurveyAccess } from '@/lib/survey/audit'
import { formatDateShort } from '@/lib/utils'
import { SurveyAnswerList } from '@/components/survey/SurveyAnswerList'

export const metadata = { title: 'Admin — Member survey answers' }
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/

// One member's submitted survey, read-only, from their admin page. Survey data
// is admin-only, and every view of a member's answers is recorded in
// survey_access_log.
export default async function AdminMemberSurveyResponsePage({
  params,
}: {
  params: Promise<{ id: string; responseId: string }>
}) {
  const { userId, sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) redirect('/admin')
  const { id: memberId, responseId } = await params
  if (!UUID.test(memberId) || !UUID.test(responseId)) notFound()

  const db = supabaseServer()
  const [{ data: member }, participantIds, found] = await Promise.all([
    db.from('members').select('id, first_name, last_name').eq('id', memberId).maybeSingle(),
    participantIdsFor(db, memberId),
    submittedResponseById(db, responseId),
  ])
  // Only through the member it belongs to: the URL can't pair one member's
  // page with someone else's answers.
  if (!member || !found || !responseBelongsTo(found, memberId, participantIds)) notFound()

  await logSurveyAccess(db, {
    actor: userId ?? 'admin',
    action: 'view',
    eventSlug: found.item.eventSlug,
    distributionId: found.distributionId,
    responseId,
    rowCount: 1,
    detail: { what: 'member_response', response_id: responseId, member_id: memberId },
  })

  const { item, lines, quotable } = found
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ') || 'Member'

  return (
    <div className="max-w-content">
      <Link href={`/admin/members/${memberId}`} className="text-sm text-primary hover:underline">← {name}</Link>
      <h1 className="mt-2 font-heading uppercase text-title text-brand-blue-dark">{item.eventTitle}</h1>
      <p className="mt-1 text-sm text-content-muted">
        Submitted {formatDateShort(item.submittedAt)}
        {found.role ? ` · ${surveyRoleLabel({ role: found.role, adultRelationship: null, sendVia: 'self' })}` : ''}
        {' · '}Response <span className="font-mono text-xs">{item.responseId}</span>
      </p>

      <div className="mt-6">
        {lines.length ? (
          <SurveyAnswerList lines={lines} />
        ) : (
          <p className="rounded-ds-card border border-line bg-white p-4 text-sm text-content-body">No answers on record. They may have been redacted.</p>
        )}
      </div>

      <div className="mt-6 rounded-ds-card border border-line bg-white p-5">
        <h2 className="font-display text-lg font-bold text-ink">Quoting</h2>
        <p className="mt-1 text-sm text-content-body">
          {item.quoteWithdrawn
            ? 'Permission to quote this response was withdrawn. It is excluded from testimonial exports.'
            : quotable
              ? 'Answers marked “may be quoted” can appear in testimonial exports. To withdraw that, use the response ID on the Surveys page.'
              : 'This response can’t be quoted.'}
        </p>
      </div>
    </div>
  )
}
