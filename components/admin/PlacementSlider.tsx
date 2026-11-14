'use client'

import { useId, useState } from 'react'

type Props = {
  label: string
  /** The stored value (a 0–1 fraction for positions, points for size). */
  value: number
  onChange: (v: number) => void
  /** Bounds and step in stored units — the slider's range. */
  min: number
  max: number
  step: number
  /** Stored → shown: 100 turns a 0–1 fraction into a percentage. */
  scale?: number
  /** Shown after the typed number: '%', 'pt', or ''. */
  unit?: string
  /** Words after the unit: 'down', 'of width'. */
  suffix?: string
}

/** Decimal places in a number, e.g. 0.5 → 1, 2 → 0. */
function decimalsOf(n: number): number {
  const s = String(Math.round(n * 1e6) / 1e6)
  const dot = s.indexOf('.')
  return dot === -1 ? 0 : s.length - dot - 1
}

/**
 * A placement slider with a typed number beside it. Typing moves the slider;
 * a number outside the slider's range snaps to its nearest end.
 */
export function PlacementSlider({ label, value, onChange, min, max, step, scale = 1, unit = '', suffix }: Props) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)

  const decimals = decimalsOf(step * scale)
  const shownMin = min * scale
  const shownMax = max * scale
  const shown = (v: number) => String(Number((v * scale).toFixed(decimals)))
  const toStored = (n: number) => {
    const clamped = Math.min(shownMax, Math.max(shownMin, n))
    const rounded = Math.round(clamped * 10 ** decimals) / 10 ** decimals
    return Number((rounded / scale).toFixed(decimals + Math.round(Math.log10(scale))))
  }

  function type(text: string) {
    setDraft(text)
    const n = Number(text)
    // Move the slider live only while the number is already in range, so
    // typing "6" on the way to "65" does not jump to the low end.
    if (text.trim() !== '' && Number.isFinite(n) && n >= shownMin && n <= shownMax) onChange(toStored(n))
  }

  function commit() {
    if (draft === null) return
    const n = Number(draft)
    if (draft.trim() !== '' && Number.isFinite(n)) onChange(toStored(n))
    setDraft(null)
  }

  return (
    <div className="space-y-1 text-xs text-brand-muted-soft">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`${id}-range`}>{label}</label>
        <span className="flex shrink-0 items-center gap-1 text-brand-muted">
          <input
            type="number"
            inputMode="decimal"
            aria-label={`${label}${unit ? ` (${unit === '%' ? 'percent' : unit})` : ''}`}
            min={shownMin}
            max={shownMax}
            step={Number((step * scale).toFixed(decimals))}
            value={draft ?? shown(value)}
            onChange={(e) => type(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setDraft(null)
            }}
            className="w-16 rounded-md border border-line-strong bg-white px-1.5 py-0.5 text-right text-input mouse:text-xs text-brand-blue-dark tabular-nums"
          />
          {unit && <span>{unit}</span>}
          {suffix && <span>{suffix}</span>}
        </span>
      </div>
      <input
        id={`${id}-range`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          setDraft(null)
          onChange(Number(e.target.value))
        }}
        className="w-full accent-brand-blue"
      />
    </div>
  )
}
