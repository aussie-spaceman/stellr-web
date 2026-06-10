'use client'

import { useState } from 'react'
import { CheckCircle2, Circle, FileText, Video, ExternalLink } from 'lucide-react'
import { MaterialDownloadButton } from './MaterialDownloadButton'

export interface TrainingItemRowData {
  id: string
  title: string
  content_kind: 'video' | 'document' | 'google_doc' | 'link'
  external_url: string | null
  estimated_minutes: number | null
  completed: boolean
}

// One lesson within a module: open/download the content, and toggle completion.
// Completion posts to the progress API and updates the per-module "x of n" count
// on next load (FR-COM-10: "see my progress as I complete stages").
export function TrainingItemRow({ item }: { item: TrainingItemRowData }) {
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

  const Icon = item.content_kind === 'video' ? Video : FileText
  const isExternal = item.content_kind === 'google_doc' || item.content_kind === 'link'

  return (
    <li className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex min-w-0 items-start gap-3">
        <button
          onClick={toggle}
          disabled={saving}
          aria-label={completed ? 'Mark incomplete' : 'Mark complete'}
          className="mt-0.5 shrink-0 disabled:opacity-50"
        >
          {completed ? (
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          ) : (
            <Circle className="h-5 w-5 text-gray-300" />
          )}
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-gray-400" />
            <h3 className="font-medium text-gray-900">{item.title}</h3>
          </div>
          {item.estimated_minutes != null && (
            <p className="mt-0.5 text-xs text-gray-400">~{item.estimated_minutes} min</p>
          )}
        </div>
      </div>

      <div className="shrink-0">
        {isExternal && item.external_url ? (
          <a
            href={item.external_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open
          </a>
        ) : (
          <MaterialDownloadButton
            endpoint={`/api/community/training/items/${item.id}/download`}
            title={item.title}
            label={item.content_kind === 'video' ? 'Watch' : 'Open'}
          />
        )}
      </div>
    </li>
  )
}
