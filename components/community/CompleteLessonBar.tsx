'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, RotateCcw } from 'lucide-react'

// Footer of the lesson player: prev/next navigation plus a "Complete lesson"
// action that records progress (FR-COM-10) and advances to the next lesson, or
// back to the module dashboard if this was the last one.
export function CompleteLessonBar({
  moduleId,
  itemId,
  prevId,
  nextId,
  completed: initialCompleted,
}: {
  moduleId: string
  itemId: string
  prevId: string | null
  nextId: string | null
  completed: boolean
}) {
  const router = useRouter()
  const [completed, setCompleted] = useState(initialCompleted)
  const [busy, setBusy] = useState(false)

  const base = `/community/training/${moduleId}`

  const setStatus = async (next: boolean, advance: boolean) => {
    setBusy(true)
    setCompleted(next)
    try {
      await fetch('/api/community/training/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, status: next ? 'completed' : 'in_progress' }),
      })
    } catch {
      setCompleted(!next)
    } finally {
      setBusy(false)
    }
    if (advance) router.push(nextId ? `${base}/${nextId}` : base)
    else router.refresh()
  }

  return (
    <div className="sticky bottom-0 border-t border-brand-border bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <a
          href={prevId ? `${base}/${prevId}` : base}
          className="inline-flex items-center gap-1.5 rounded-full border border-brand-border px-3.5 py-2 text-sm font-medium text-brand-muted hover:bg-brand-canvas"
        >
          <ArrowLeft className="h-4 w-4" />
          {prevId ? 'Previous' : 'Course'}
        </a>

        {completed ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setStatus(false, false)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full border border-brand-border px-3.5 py-2 text-sm font-medium text-brand-muted hover:bg-brand-canvas disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" /> Mark incomplete
            </button>
            <a
              href={nextId ? `${base}/${nextId}` : base}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand-blue-dark px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue-dark"
            >
              {nextId ? 'Next lesson' : 'Finish'}
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        ) : (
          <button
            onClick={() => setStatus(true, true)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-blue-dark px-5 py-2 text-sm font-semibold text-white hover:bg-brand-blue-dark disabled:opacity-60"
          >
            <Check className="h-4 w-4" />
            {busy ? 'Saving…' : 'Complete lesson'}
          </button>
        )}
      </div>
    </div>
  )
}
