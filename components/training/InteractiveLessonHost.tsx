'use client'

import { INTERACTIVE_LESSONS } from '@/lib/interactive-lessons'
import { isInteractiveKey } from '@/lib/interactive-lessons-meta'

// Client host for interactive lessons: looks the registered component up by key
// and renders it in the player's media slot. getLesson only emits registered keys,
// so the guard here is belt-and-braces (LessonMedia shows the unavailable state
// for anything unregistered before this mounts).
export function InteractiveLessonHost({ lessonKey }: { lessonKey: string }) {
  if (!isInteractiveKey(lessonKey)) return null
  const Component = INTERACTIVE_LESSONS[lessonKey]
  return (
    <div className="overflow-hidden rounded-2xl border border-brand-border bg-white">
      <Component />
    </div>
  )
}
