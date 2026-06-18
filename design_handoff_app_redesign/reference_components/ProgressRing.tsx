// reference_components/ProgressRing.tsx
// Drop-in replacement for the gray/green ring in app/(member)/community/training/page.tsx.
// Gold progress on a warm track, per the redesign. Server-safe (no hooks).
import { Check } from 'lucide-react'

export function ProgressRing({
  pct,
  done = false,
  size = 44,
}: {
  pct: number
  done?: boolean
  size?: number
}) {
  const r = 16
  const c = 2 * Math.PI * r
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 40 40" className="-rotate-90" style={{ width: size, height: size }}>
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" className="stroke-brand-hairline" />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * pct) / 100}
          className={done ? 'stroke-emerald-500' : 'stroke-brand-orange'}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-subheading text-[11px] font-semibold text-brand-blue-dark">
        {done ? <Check className="h-4 w-4 text-emerald-500" /> : `${pct}%`}
      </span>
    </div>
  )
}
