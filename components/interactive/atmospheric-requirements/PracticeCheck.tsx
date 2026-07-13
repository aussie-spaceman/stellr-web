'use client'

import * as React from 'react'
import { Check, X } from 'lucide-react'
import { PRACTICE } from './tutorial-data'

// Self-check questions: numeric-entry with tolerance, or multiple choice.
// Purely formative — feedback is immediate and the worked reasoning reveals after
// an attempt. No scoring is stored.

type Numeric = Extract<(typeof PRACTICE)[number], { answer: number }>
type Choice = Extract<(typeof PRACTICE)[number], { choices: readonly string[] }>

function NumericQ({ q, index }: { q: Numeric; index: number }) {
  const [value, setValue] = React.useState('')
  const [checked, setChecked] = React.useState(false)
  const num = Number(value)
  const correct = value !== '' && Math.abs(num - q.answer) <= q.tolerance

  return (
    <div className="rounded-panel border border-line bg-white p-6">
      <p className="font-subheading font-semibold text-ink">
        <span className="text-primary">Q{index + 1}.</span> {q.prompt}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          type="number"
          value={value}
          step="any"
          onChange={(e) => {
            setValue(e.target.value)
            setChecked(false)
          }}
          className="input-field w-32"
          placeholder="Answer"
        />
        <span className="text-content-muted text-sm">{q.unit}</span>
        <button
          type="button"
          onClick={() => setChecked(true)}
          className="inline-flex items-center rounded-control bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-deep"
        >
          Check
        </button>
        {checked && value !== '' && (
          <span
            className={`inline-flex items-center gap-1 text-sm font-semibold ${
              correct ? 'text-enviro-green' : 'text-danger'
            }`}
          >
            {correct ? <Check size={16} /> : <X size={16} />}
            {correct ? 'Correct' : 'Not quite'}
          </span>
        )}
      </div>
      {checked && (
        <p className="mt-4 rounded-ds-card bg-surface border border-line p-4 text-sm text-content-secondary leading-relaxed">
          {q.solution}
        </p>
      )}
    </div>
  )
}

function ChoiceQ({ q, index }: { q: Choice; index: number }) {
  const [picked, setPicked] = React.useState<number | null>(null)
  const answered = picked !== null
  const correct = picked === q.answerIndex

  return (
    <div className="rounded-panel border border-line bg-white p-6">
      <p className="font-subheading font-semibold text-ink">
        <span className="text-primary">Q{index + 1}.</span> {q.prompt}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {q.choices.map((choice, i) => {
          const isPicked = picked === i
          const showRight = answered && i === q.answerIndex
          const showWrong = answered && isPicked && i !== q.answerIndex
          return (
            <button
              key={choice}
              type="button"
              onClick={() => setPicked(i)}
              className={`flex items-center justify-between rounded-ds-card border px-4 py-3 text-left text-sm font-medium transition-colors ${
                showRight
                  ? 'border-enviro-green bg-enviro-green-bg text-enviro-green-text'
                  : showWrong
                    ? 'border-danger bg-white text-danger'
                    : 'border-line bg-white text-content-secondary hover:border-primary'
              }`}
            >
              {choice}
              {showRight && <Check size={16} />}
              {showWrong && <X size={16} />}
            </button>
          )
        })}
      </div>
      {answered && (
        <p className="mt-4 rounded-ds-card bg-surface border border-line p-4 text-sm text-content-secondary leading-relaxed">
          {correct ? '' : 'Have another look. '}
          {q.solution}
        </p>
      )}
    </div>
  )
}

export function PracticeCheck() {
  return (
    <div className="space-y-4">
      {PRACTICE.map((q, i) =>
        'choices' in q ? (
          <ChoiceQ key={q.id} q={q as Choice} index={i} />
        ) : (
          <NumericQ key={q.id} q={q as Numeric} index={i} />
        ),
      )}
    </div>
  )
}
