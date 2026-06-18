'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { JSONContent } from '@tiptap/react'
import { RichTextEditor } from './RichTextEditor'

interface Props {
  postId: string
  parentCommentId?: string | null
  placeholder?: string
  compact?: boolean
  onDone?: () => void
}

// Reply composer used at the post level and nested under comments (FR-COM-02).
export function CommentForm({ postId, parentCommentId = null, placeholder, compact, onDone }: Props) {
  const router = useRouter()
  const [bodyJson, setBodyJson] = useState<JSONContent | null>(null)
  const [hasText, setHasText] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!hasText) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/community/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, parentCommentId, bodyJson }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong.')
        return
      }
      setBodyJson(null)
      setHasText(false)
      onDone?.()
      router.refresh()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <RichTextEditor
        value={bodyJson}
        compact={compact}
        placeholder={placeholder ?? 'Write a reply…'}
        onChange={(doc, text) => {
          setBodyJson(doc)
          setHasText(text.trim().length > 0)
        }}
      />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={submitting || !hasText}
          className="rounded-md bg-brand-blue-dark px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-40"
        >
          {submitting ? 'Sending…' : 'Reply'}
        </button>
        {onDone && (
          <button
            onClick={onDone}
            className="rounded-md px-2 py-1.5 text-sm text-brand-muted-soft hover:text-brand-muted"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
