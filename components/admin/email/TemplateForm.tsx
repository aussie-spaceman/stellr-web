'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { JSONContent } from '@tiptap/react'
import { RichTextEditor } from '@/components/community/RichTextEditor'
import { MERGE_FIELDS } from '@/lib/email-vars'

// Create a reusable email template. Subject + body may contain {{mergeFields}};
// the chips below show the supported vocabulary.
export function TemplateForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [bodyJson, setBodyJson] = useState<JSONContent | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !subject.trim()) { setError('Name and subject are required.'); return }
    setSubmitting(true); setError(null); setSuccess(false)
    try {
      const res = await fetch('/api/admin/email/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), subject: subject.trim(), bodyJson }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to save template.'); return }
      setSuccess(true); setName(''); setSubject(''); setBodyJson(null)
      router.refresh()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
      <h2 className="text-base font-semibold text-gray-900">New template</h2>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
            placeholder="Welcome — Alumni"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            maxLength={300}
            placeholder="Welcome to Alumni, {{firstName}}"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
        <RichTextEditor value={bodyJson} onChange={(doc) => setBodyJson(doc)} placeholder="Write the email…" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-500 mr-1">Merge fields:</span>
        {MERGE_FIELDS.map((f) => (
          <code key={f.token} title={`e.g. ${f.example}`} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
            {`{{${f.token}}}`}
          </code>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-600">Template saved.</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Save template'}
      </button>
    </form>
  )
}
