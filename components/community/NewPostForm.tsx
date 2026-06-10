'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { JSONContent } from '@tiptap/react'
import { RichTextEditor } from './RichTextEditor'

// Composer for starting a new post in a space (FR-COM-02).
export function NewPostForm({ spaceSlug }: { spaceSlug: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [bodyJson, setBodyJson] = useState<JSONContent | null>(null)
  const [bodyText, setBodyText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setTitle('')
    setBodyJson(null)
    setBodyText('')
    setError(null)
  }

  const submit = async () => {
    if (!title.trim()) {
      setError('Add a title.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/community/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceSlug, title: title.trim(), bodyJson }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong.')
        return
      }
      reset()
      setOpen(false)
      router.push(`/community/${spaceSlug}/${json.id}`)
      router.refresh()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-gray-300 bg-white px-4 py-3 text-left text-sm text-gray-500 hover:border-gray-400 hover:text-gray-700"
      >
        Start a new post…
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Post title"
        maxLength={300}
        className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-medium focus:border-gray-400 focus:outline-none"
      />
      <RichTextEditor
        value={bodyJson}
        onChange={(doc, text) => {
          setBodyJson(doc)
          setBodyText(text)
        }}
        placeholder="Write something…"
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={submitting}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting ? 'Posting…' : 'Post'}
        </button>
        <button
          onClick={() => {
            reset()
            setOpen(false)
          }}
          className="rounded-md px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
        {bodyText.length > 0 && (
          <span className="ml-auto text-xs text-gray-400">{bodyText.length} chars</span>
        )}
      </div>
    </div>
  )
}
