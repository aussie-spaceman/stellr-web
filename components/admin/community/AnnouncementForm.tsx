'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { JSONContent } from '@tiptap/react'
import { RichTextEditor } from '@/components/community/RichTextEditor'

interface Space {
  id: string
  name: string
  slug: string
}

export function AnnouncementForm({ spaces }: { spaces: Space[] }) {
  const router = useRouter()
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [bodyJson, setBodyJson] = useState<JSONContent | null>(null)
  const [emailAll, setEmailAll] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !spaceId) { setError('Space and title are required.'); return }
    setSubmitting(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await fetch('/api/admin/community/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId, title: title.trim(), bodyJson, emailAll }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to post.'); return }
      setSuccess(true)
      setTitle('')
      setBodyJson(null)
      setEmailAll(false)
      router.refresh()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Post new announcement</h2>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Space</label>
          <select
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
          >
            {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={300}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
            placeholder="Announcement title"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
        <RichTextEditor
          value={bodyJson}
          onChange={(doc) => setBodyJson(doc)}
          placeholder="Write the announcement…"
        />
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={emailAll}
          onChange={(e) => setEmailAll(e.target.checked)}
          className="rounded border-gray-300"
        />
        <span className="text-sm text-gray-700">
          Also email all active members <span className="text-gray-400">(FR-COM-06)</span>
        </span>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-600">Announcement posted.</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {submitting ? 'Posting…' : 'Post announcement'}
      </button>
    </form>
  )
}
