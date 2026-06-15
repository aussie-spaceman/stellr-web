'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Circle, FileText, Video, Link2, Lock, ChevronRight } from 'lucide-react'

export interface TrainingItemRowData {
  id: string
  title: string
  content_kind: 'video' | 'document' | 'google_doc' | 'link' | 'live'
  external_url: string | null
  estimated_minutes: number | null
  completed: boolean
}

// One lesson within a module. The row links into the focused lesson player; the
// checkmark is a quick complete/incomplete toggle that posts to the progress API
// and updates the per-module "x of n" count (FR-COM-10). Drip-locked lessons are
// shown but not openable.
export function TrainingItemRow({
  item,
  index,
  moduleId,
  locked = false,
  availableAt = null,
}: {
  item: TrainingItemRowData
  index?: number
  moduleId: string
  locked?: boolean
  availableAt?: string | null
}) {
  const [completed, setCompleted] = useState(item.completed)
  const [saving, setSaving] = useState(false)

  const toggle = async () => {
    const next = !completed
    setSaving(true)
    setCompleted(next) // optimistic
    try {
      const res = await fetch('/api/community/training/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, status: next ? 'completed' : 'in_progress' }),
      })
      if (!res.ok) setCompleted(!next) // revert on failure
    } catch {
      setCompleted(!next)
    } finally {
      setSaving(false)
    }
  }

  const Icon =
    item.content_kind === 'video' || item.content_kind === 'live'
      ? Video
      : item.content_kind === 'google_doc' || item.content_kind === 'link'
        ? Link2
        : FileText

  const meta = (
    <>
      <span className="capitalize">{item.content_kind.replace('_', ' ')}</span>
      {item.estimated_minutes != null && ` · ~${item.estimated_minutes} min`}
    </>
  )

  if (locked) {
    return (
      <li className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 p-3.5 opacity-80">
        <div className="flex min-w-0 items-center gap-3">
          <Lock className="h-5 w-5 shrink-0 text-amber-400" />
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-400">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate font-medium text-gray-500">
              {index != null && <span className="text-gray-400">{index}. </span>}
              {item.title}
            </h3>
            <p className="mt-0.5 text-xs text-gray-400">
              {availableAt ? `Unlocks ${new Date(availableAt).toLocaleDateString()}` : 'Locked'}
            </p>
          </div>
        </div>
      </li>
    )
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3.5 transition hover:border-gray-300 hover:shadow-sm">
      <button
        onClick={toggle}
        disabled={saving}
        aria-label={completed ? 'Mark incomplete' : 'Mark complete'}
        className="shrink-0 transition hover:scale-110 disabled:opacity-50"
      >
        {completed ? (
          <CheckCircle2 className="h-6 w-6 text-green-500" />
        ) : (
          <Circle className="h-6 w-6 text-gray-300" />
        )}
      </button>

      <Link
        href={`/community/training/${moduleId}/${item.id}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className={`truncate font-medium ${completed ? 'text-gray-500' : 'text-gray-900'}`}>
            {index != null && <span className="text-gray-400">{index}. </span>}
            {item.title}
          </h3>
          <p className="mt-0.5 text-xs text-gray-400">{meta}</p>
        </div>
      </Link>

      <ChevronRight className="h-5 w-5 shrink-0 text-gray-300" />
    </li>
  )
}
