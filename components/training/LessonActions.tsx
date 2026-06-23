'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ArrowRight, RotateCcw } from 'lucide-react'

// Inline action row beneath the lesson player: Mark lesson complete (records
// progress + advances) and Next lesson. Lesson selection is a ?lesson= param on
// the course page, so navigation stays on the same screen.
export function LessonActions({
  moduleId,
  itemId,
  nextId,
  completed: initialCompleted,
}: {
  moduleId: string
  itemId: string
  nextId: string | null
  completed: boolean
}) {
  const router = useRouter()
  const [completed, setCompleted] = useState(initialCompleted)
  const [busy, setBusy] = useState(false)

  const go = (lessonId: string | null) => {
    router.push(lessonId ? `/community/training/${moduleId}?lesson=${lessonId}` : `/community/training/${moduleId}`)
  }

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
    if (advance && next) go(nextId)
    else router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {completed ? (
        <button
          onClick={() => setStatus(false, false)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border px-4 py-2 text-sm font-semibold text-brand-muted transition hover:bg-brand-canvas disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" /> Mark incomplete
        </button>
      ) : (
        <button
          onClick={() => setStatus(true, true)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-bright disabled:opacity-60"
        >
          <Check className="h-4 w-4" />
          {busy ? 'Saving…' : 'Mark lesson complete'}
        </button>
      )}
      {nextId && (
        <button
          onClick={() => go(nextId)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border px-4 py-2 text-sm font-semibold text-brand-muted transition hover:bg-brand-canvas"
        >
          Next lesson <ArrowRight className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
