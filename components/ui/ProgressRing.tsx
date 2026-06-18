// Gold progress ring on a warm track (redesign). Server-safe (no hooks).
// Used by Home (T2.2) and the Training list (T3.2).
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
          strokeDashoffset={c - (c * Math.min(100, Math.max(0, pct))) / 100}
          className={done ? 'stroke-emerald-500' : 'stroke-brand-orange'}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-subheading text-[11px] font-semibold text-brand-blue-dark">
        {done ? <Check className="h-4 w-4 text-emerald-500" /> : `${pct}%`}
      </span>
    </div>
  )
}
