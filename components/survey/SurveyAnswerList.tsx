import { Badge } from '@stellr/web-ui'
import type { AnswerLine } from '@/lib/survey/member'

// A submitted survey's answers, read-only, in the order they were asked. The
// member's own answers page and the admin member page both render it.
export function SurveyAnswerList({ lines }: { lines: AnswerLine[] }) {
  return (
    <dl className="divide-y divide-line-light rounded-ds-card border border-line bg-white">
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
  )
}
