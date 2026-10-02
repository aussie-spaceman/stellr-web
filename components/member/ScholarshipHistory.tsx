import { STAGE_LABEL, STAGE_LABEL_MEMBER, formatUsd, stageAccepted } from '@/lib/scholarship-levels'
import type { ScholarshipHistoryItem } from '@/lib/scholarships'

// A member's scholarships — requested, offered (with the discount) and whether
// they took it up. One component for both views: the student's Account page
// (`audience="member"`) and the admin member page (`audience="admin"`, with a
// link to each application). Renders nothing when there are none.

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function ScholarshipHistory({
  items,
  audience,
}: {
  items: ScholarshipHistoryItem[]
  audience: 'member' | 'admin'
}) {
  if (items.length === 0) return null
  const labels = audience === 'member' ? STAGE_LABEL_MEMBER : STAGE_LABEL
  return (
    <div className="bg-white rounded-xl border border-line p-6">
      <h2 className="text-base font-semibold text-ink mb-4">Scholarships</h2>
      <ul className="divide-y divide-line-light">
        {items.map((s) => (
          <li key={s.id} className="py-3 first:pt-0 last:pb-0 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-ink">{s.eventTitle}</p>
              <p className="text-xs text-content-body mt-0.5">
                Applied {fmt(s.appliedAt)}
                {s.offeredAt ? ` · offered ${fmt(s.offeredAt)}` : ''}
                {s.percent != null && s.stage !== 'submitted' && s.stage !== 'not_offered' ? ` · ${s.percent}% scholarship` : ''}
              </p>
              {s.refund && (
                <p className="text-xs text-content-body mt-0.5">
                  {s.refund.type === 'cash'
                    ? `${formatUsd(s.refund.cents)} refunded to the card`
                    : s.refund.type === 'credit'
                      ? `${formatUsd(s.refund.cents)} added as account credit`
                      : audience === 'admin'
                        ? `${formatUsd(s.refund.cents)} reimbursement needs doing manually`
                        : `${formatUsd(s.refund.cents)} reimbursement being arranged`}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  stageAccepted(s.stage)
                    ? 'bg-enviro-green-bg text-enviro-green-text'
                    : s.stage === 'submitted'
                      ? 'bg-pathway-amber-bg text-ink'
                      : s.stage === 'not_offered' || s.stage === 'withdrawn'
                        ? 'bg-line-light text-content-body'
                        : 'bg-primary-soft text-primary-deep'
                }`}
              >
                {labels[s.stage]}
              </span>
              {audience === 'member' && s.offerUrl && (
                <a href={s.offerUrl} className="text-xs font-semibold text-primary hover:text-primary-deep">Next step →</a>
              )}
              {audience === 'admin' && (
                <a href={`/admin/scholarships/${s.id}`} className="text-xs font-semibold text-primary hover:text-primary-deep">Application →</a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
