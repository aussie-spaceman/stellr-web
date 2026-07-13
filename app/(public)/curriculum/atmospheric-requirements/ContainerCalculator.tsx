'use client'

import * as React from 'react'
import { CONTAINER_PROBLEM } from './tutorial-data'

// Step-by-step calculator for "how much air does a settlement need?".
// Reproduces the worked example (Dalton → Amagat → expansion ratios → containers)
// and lets students change the inputs and watch every step recompute.

const fmt = (n: number, d = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

export function ContainerCalculator() {
  const P = CONTAINER_PROBLEM
  const [volume, setVolume] = React.useState<number>(P.volume)
  const [total, setTotal] = React.useState<number>(P.totalPressure)
  const [ppo2, setPpo2] = React.useState<number>(P.ppo2)

  const ppn2 = Math.max(0, total - ppo2)

  // Amagat: partial volume = (partial pressure / total pressure) × total volume.
  const volO2 = (ppo2 / total) * volume
  const volN2 = (ppn2 / total) * volume

  // Expansion ratio adjusted for settlement pressure (gas takes more space at
  // lower P, so scale the 1-atm ratio by the total pressure).
  const erO2 = P.er.o2 * total
  const erN2 = P.er.n2 * total

  const liqO2 = volO2 * erO2
  const liqN2 = volN2 * erN2

  const containersO2 = liqO2 / P.containerSize
  const containersN2 = liqN2 / P.containerSize

  const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
    <li className="relative pl-11">
      <span className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-primary font-display font-bold text-sm">
        {n}
      </span>
      <p className="font-subheading font-semibold text-ink">{title}</p>
      <div className="text-sm text-content-secondary mt-1 leading-relaxed">{children}</div>
    </li>
  )

  return (
    <div className="bg-surface border border-line rounded-panel p-6 sm:p-8">
      {/* Inputs */}
      <div className="grid gap-5 sm:grid-cols-3">
        <label className="block">
          <span className="label-text">Settlement volume (m³)</span>
          <input
            type="number"
            value={volume}
            min={1000}
            step={1000}
            onChange={(e) => setVolume(Math.max(0, Number(e.target.value)))}
            className="input-field mt-1"
          />
        </label>
        <label className="block">
          <span className="label-text">Total pressure (atm)</span>
          <input
            type="number"
            value={total}
            min={0.1}
            max={1.5}
            step={0.01}
            onChange={(e) => setTotal(Math.max(0.01, Number(e.target.value)))}
            className="input-field mt-1"
          />
        </label>
        <label className="block">
          <span className="label-text">pO₂ (atm)</span>
          <input
            type="number"
            value={ppo2}
            min={0.05}
            max={total}
            step={0.001}
            onChange={(e) => setPpo2(Math.max(0, Number(e.target.value)))}
            className="input-field mt-1"
          />
        </label>
      </div>

      {ppo2 > total && (
        <p className="text-sm text-danger font-semibold mt-4">
          Partial pressure of oxygen can’t exceed the total pressure — lower pO₂ or raise total pressure.
        </p>
      )}

      {/* Steps */}
      <ol className="mt-8 space-y-6">
        <Step n={1} title="Split the air into its parts (Dalton’s Law)">
          Total pressure = pO₂ + pN₂. With pO₂ = {ppo2.toFixed(3)} atm, nitrogen makes up the rest:{' '}
          <strong className="text-ink">pN₂ = {ppn2.toFixed(3)} atm</strong>.
        </Step>

        <Step n={2} title="Find each gas’s partial volume (Amagat’s Law)">
          Partial volume = (partial pressure ÷ total pressure) × total volume.
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <span className="rounded-ds-card bg-white border border-line px-3 py-2">
              O₂: {fmt(volO2)} m³
            </span>
            <span className="rounded-ds-card bg-white border border-line px-3 py-2">
              N₂: {fmt(volN2)} m³
            </span>
          </div>
        </Step>

        <Step n={3} title="Adjust the expansion ratio for settlement pressure">
          Liquefied gas expands more at lower pressure, so scale the 1-atm ratio by the total pressure.
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <span className="rounded-ds-card bg-white border border-line px-3 py-2">
              O₂: {erO2.toFixed(6)} (liquid per m³ gas)
            </span>
            <span className="rounded-ds-card bg-white border border-line px-3 py-2">
              N₂: {erN2.toFixed(6)}
            </span>
          </div>
        </Step>

        <Step n={4} title="Convert to litres of liquid, then to containers">
          Liquid volume = partial volume × adjusted expansion ratio, divided into {P.containerSize} m³ containers.
        </Step>
      </ol>

      {/* Answer */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-ds-card bg-white border border-line p-5 text-center">
          <p className="text-xs uppercase tracking-[0.14em] font-subheading font-semibold text-content-muted">
            Oxygen containers
          </p>
          <p className="font-display text-4xl font-bold text-ink mt-1 tabular-nums">{fmt(containersO2, 1)}</p>
          <p className="text-xs text-content-muted mt-1">{fmt(liqO2, 1)} m³ liquid O₂</p>
        </div>
        <div className="rounded-ds-card bg-white border border-line p-5 text-center">
          <p className="text-xs uppercase tracking-[0.14em] font-subheading font-semibold text-content-muted">
            Nitrogen containers
          </p>
          <p className="font-display text-4xl font-bold text-ink mt-1 tabular-nums">{fmt(containersN2, 1)}</p>
          <p className="text-xs text-content-muted mt-1">{fmt(liqN2, 1)} m³ liquid N₂</p>
        </div>
      </div>

      <p className="text-sm text-content-secondary mt-6 leading-relaxed">
        With the example inputs (1,000,000 m³ at 0.75 atm, pO₂ = 0.132 atm) you get about{' '}
        <strong className="text-ink">1.5 containers of oxygen and 8.9 of nitrogen</strong>. Each of these assumes air
        behaves as an ideal gas — a good first estimate, but a design team can refine it with the van der Waals equation.
      </p>
    </div>
  )
}
