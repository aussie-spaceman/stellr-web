import { STAGE_LABEL, type ScholarshipStage } from '@/lib/scholarship-levels'

// One pill vocabulary for a scholarship's stage — the admin list, the review
// page, the member page and the event roster all use it.
const TONE: Record<ScholarshipStage, string> = {
  submitted: 'bg-pathway-amber-bg text-ink',
  awaiting_details: 'bg-primary-soft text-primary-deep',
  awaiting_payment: 'bg-primary-soft text-primary-deep',
  confirmed: 'bg-enviro-green-bg text-enviro-green-text',
  attended: 'bg-enviro-green-bg text-enviro-green-text',
  not_offered: 'bg-line-light text-content-body',
  withdrawn: 'bg-line-light text-content-body',
}

export function ScholarshipStagePill({ stage, percent }: { stage: ScholarshipStage; percent?: number | null }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[stage]}`}>
      {percent != null && stage !== 'submitted' && stage !== 'not_offered' ? `${percent}% · ` : ''}
      {STAGE_LABEL[stage]}
    </span>
  )
}
