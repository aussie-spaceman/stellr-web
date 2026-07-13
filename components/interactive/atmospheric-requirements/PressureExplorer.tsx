'use client'

import * as React from 'react'

// Interactive explorer: set total pressure and partial pressure of oxygen, and
// see the resulting percent oxygen plus qualitative comfort / fire read-outs.
// Pure client-side maths — no dependencies. All colour comes from DS tokens.

const EARTH_PPO2 = 0.16 // atm, sea-level partial pressure of oxygen (~120 mmHg working value)

function comfortBand(ppo2: number): { label: string; tone: string } {
  // Based on NASA SP-413: tolerable pO2 roughly 0.10–0.30 atm; comfort near Earth.
  if (ppo2 < 0.1) return { label: 'Too little O₂ — hypoxia risk', tone: 'text-danger' }
  if (ppo2 < 0.13) return { label: 'Low — mild altitude effects', tone: 'text-pathway-amber-deep' }
  if (ppo2 <= 0.21) return { label: 'Comfortable for people', tone: 'text-enviro-green' }
  if (ppo2 <= 0.3) return { label: 'High — usable, watch fire risk', tone: 'text-pathway-amber-deep' }
  return { label: 'Very high O₂ — hazardous', tone: 'text-danger' }
}

function fireBand(pct: number): { label: string; tone: string; fill: string } {
  // Flammability tracks oxygen *fraction* more than partial pressure.
  if (pct <= 23) return { label: 'Near Earth-like fire behaviour', tone: 'text-enviro-green', fill: 'bg-enviro-green' }
  if (pct <= 35) return { label: 'Elevated fire risk', tone: 'text-pathway-amber-deep', fill: 'bg-pathway-amber' }
  return { label: 'High fire risk — materials burn readily', tone: 'text-danger', fill: 'bg-danger' }
}

export function PressureExplorer() {
  const [total, setTotal] = React.useState(0.7)
  const [ppo2, setPpo2] = React.useState(0.16)

  // Keep pO2 physically valid: it can't exceed total pressure.
  const cappedPpo2 = Math.min(ppo2, total)
  const pct = total > 0 ? (cappedPpo2 / total) * 100 : 0
  const comfort = comfortBand(cappedPpo2)
  const fire = fireBand(pct)

  return (
    <div className="bg-surface border border-line rounded-panel p-6 sm:p-8">
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Controls */}
        <div className="space-y-6">
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="total-p" className="font-subheading font-semibold text-ink">
                Total pressure
              </label>
              <span className="font-display font-bold text-ink tabular-nums">{total.toFixed(2)} atm</span>
            </div>
            <input
              id="total-p"
              type="range"
              min={0.2}
              max={1}
              step={0.01}
              value={total}
              onChange={(e) => setTotal(Number(e.target.value))}
              className="w-full mt-3 accent-primary"
            />
            <p className="text-xs text-content-muted mt-1">Earth at sea level ≈ 1.0 atm</p>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="ppo2" className="font-subheading font-semibold text-ink">
                Partial pressure of oxygen
              </label>
              <span className="font-display font-bold text-ink tabular-nums">{cappedPpo2.toFixed(3)} atm</span>
            </div>
            <input
              id="ppo2"
              type="range"
              min={0.05}
              max={Math.min(0.35, total)}
              step={0.005}
              value={cappedPpo2}
              onChange={(e) => setPpo2(Number(e.target.value))}
              className="w-full mt-3 accent-primary"
            />
            <p className="text-xs text-content-muted mt-1">Earth at sea level ≈ {EARTH_PPO2.toFixed(2)} atm</p>
          </div>
        </div>

        {/* Read-out */}
        <div className="flex flex-col justify-center bg-white border border-line rounded-ds-card p-6">
          <p className="text-xs uppercase tracking-[0.14em] font-subheading font-semibold text-content-muted">
            Resulting oxygen fraction
          </p>
          <p className="font-display text-5xl font-bold text-ink mt-1 tabular-nums">{pct.toFixed(0)}%</p>

          <div className="mt-4 h-2 w-full rounded-pill bg-line overflow-hidden">
            <div
              className={`h-full ${fire.fill} transition-all`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>

          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-content-secondary">Human comfort</dt>
              <dd className={`font-semibold text-right ${comfort.tone}`}>{comfort.label}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-content-secondary">Fire risk</dt>
              <dd className={`font-semibold text-right ${fire.tone}`}>{fire.label}</dd>
            </div>
          </dl>
        </div>
      </div>

      <p className="text-sm text-content-secondary mt-6 leading-relaxed">
        Notice the tension: drop the total pressure to save on structure and gas, and the same life-supporting{' '}
        <em>partial</em> pressure of oxygen becomes a much larger <em>fraction</em> of the air — which pushes fire risk
        up. That trade-off is the heart of the design problem.
      </p>
    </div>
  )
}
