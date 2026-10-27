import { EraCycle } from '@stellr/web-ui'
import { Environment } from '@stellr/icons'
import { CURRENT_SCHOOL_YEAR, eraCycle, storyYear } from '@/lib/future-history'

/**
 * The four-year rotation of space competitions, this year marked, with the
 * Environmental line beneath it. Shared by /competitions and its Future
 * History page so the two can't disagree.
 */
export function FutureHistoryCycle() {
  const year = storyYear(CURRENT_SCHOOL_YEAR)
  return (
    <div>
      <EraCycle
        items={eraCycle().map(({ era, schoolYear, setIn, current }) => ({
          name: era.name,
          scope: era.scope,
          ahead: `+${era.yearsAhead} years`,
          when: `${schoolYear} school year · set in ${setIn}`,
          current,
        }))}
      />
      <p className="mt-3 flex items-start gap-2.5 rounded-ds-card border border-enviro-green-chip bg-enviro-green-bg px-4 py-3 text-sm text-content-secondary">
        <Environment size={18} className="mt-0.5 shrink-0 text-enviro-green-text" aria-hidden="true" />
        <span>
          <strong className="text-enviro-green-text">Environmental competitions run every year</strong>, on Earth, in
          the same future — this year, {year}.
        </span>
      </p>
    </div>
  )
}
