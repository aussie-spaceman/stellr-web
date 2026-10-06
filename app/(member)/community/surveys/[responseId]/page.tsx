import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Badge } from '@stellr/web-ui'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { submittedResponseFor } from '@/lib/survey/member'
import { formatDateShort } from '@/lib/utils'
import { WithdrawMyQuote } from '@/components/survey/WithdrawMyQuote'

export const metadata = { title: 'Survey answers' }
export const dynamic = 'force-dynamic'

// One submitted survey, read-only (handover P2/P3). Only the member's own.
export default async function SurveyAnswersPage({ params }: { params: Promise<{ responseId: string }> }) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up?next=/community/surveys')
  const { responseId } = await params
  if (!/^[0-9a-f-]{36}$/.test(responseId)) notFound()
  const found = await submittedResponseFor(supabaseServer(), member.id, responseId)
  if (!found) notFound()
  const { item, lines, quotable } = found

  return (
    <div>
      <Link href="/community/surveys" className="text-sm text-primary hover:underline">← My surveys</Link>
      <h1 className="mt-2 font-heading uppercase text-title text-brand-blue-dark">{item.eventTitle}</h1>
      <p className="mt-1 text-sm text-brand-muted-soft">Submitted {formatDateShort(item.submittedAt)}. Submitted answers can’t be changed.</p>

      <dl className="mt-6 divide-y divide-line-light rounded-ds-card border border-line bg-white">
        {lines.map((l) => (
          <div key={l.question.key} className="p-4">
            <dt className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
              {l.question.label}
              {l.question.quotable && <Badge className="bg-pathway-amber-bg text-brand-gold-ink">{l.question.labelTag ?? 'may be quoted'}</Badge>}
            </dt>
            <dd className="mt-1 whitespace-pre-line text-content-body">{l.display}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 rounded-ds-card border border-line bg-white p-5">
        <h2 className="font-display text-lg font-bold text-ink">Quoting</h2>
        {item.quoteWithdrawn ? (
          <p className="mt-1 text-sm text-content-body">You withdrew permission to quote this response. It won’t be used.</p>
        ) : quotable ? (
          <>
            <p className="mt-1 text-sm text-content-body">
              Answers marked “may be quoted” could appear in Stellr materials. You can withdraw that for this response at any time.
            </p>
            <WithdrawMyQuote responseId={item.responseId} />
          </>
        ) : (
          <p className="mt-1 text-sm text-content-body">This response won’t be quoted.</p>
        )}
        <p className="mt-3 text-xs text-content-muted">
          Change whether Stellr may quote any of your survey answers in <Link href="/account" className="underline">your account settings</Link>.
        </p>
      </div>
    </div>
  )
}
