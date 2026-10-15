import { Check } from 'lucide-react'

/**
 * Where a registrant is in the flow. Wraps onto a second line on a narrow
 * phone rather than pushing the page sideways (it overflowed at 320px), and
 * is an ordered list with aria-current="step" so a screen reader hears
 * "step 2 of 3, current".
 */
export function StepBar({ steps, current }: { steps: string[]; current: number }) {
  return (
    <nav aria-label="Registration progress">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs sm:gap-x-2 sm:text-sm">
        {steps.map((label, i) => {
          const n = i + 1
          const done = n < current
          const isCurrent = n === current
          return (
            <li key={label} aria-current={isCurrent ? 'step' : undefined} className="flex items-center gap-1 sm:gap-2">
              {i > 0 && (
                <span className="text-content-faint" aria-hidden="true">
                  ›
                </span>
              )}
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold sm:h-6 sm:w-6 ${
                  done ? 'bg-enviro-green-text text-white' : isCurrent ? 'bg-primary-deep text-white' : 'bg-line-light text-content-muted'
                }`}
              >
                {done ? <Check className="h-3 w-3" aria-label="Done:" /> : n}
              </span>
              <span className={isCurrent ? 'font-medium text-ink' : 'text-content-muted'}>{label}</span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
