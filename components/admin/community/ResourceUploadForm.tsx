'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type ResourceKind = 'file' | 'link'

export function ResourceUploadForm() {
  const router = useRouter()
  const [kind, setKind] = useState<ResourceKind>('file')
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    if (kind === 'file' && !file) {
      setError('File and title are required.')
      return
    }
    if (kind === 'link' && !url.trim()) {
      setError('Link URL and title are required.')
      return
    }
    setUploading(true)
    setError(null)
    setSuccess(false)

    try {
      const res =
        kind === 'link'
          ? await fetch('/api/admin/community/resources', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: url.trim(),
                title: title.trim(),
                description: description.trim() || undefined,
              }),
            })
          : await (() => {
              const fd = new FormData()
              fd.append('file', file as File)
              fd.append('title', title.trim())
              if (description.trim()) fd.append('description', description.trim())
              return fetch('/api/admin/community/resources', { method: 'POST', body: fd })
            })()
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Could not save resource.')
        return
      }
      setSuccess(true)
      setFile(null)
      setUrl('')
      setTitle('')
      setDescription('')
      router.refresh()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-brand-border bg-white p-6 space-y-4">
      <h2 className="text-base font-semibold text-brand-blue-dark">Add new resource</h2>

      <div className="inline-flex rounded-md border border-brand-border p-0.5 text-sm">
        {(['file', 'link'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k)
              setError(null)
            }}
            className={`rounded px-3 py-1 font-medium capitalize transition-colors ${
              kind === k ? 'bg-brand-blue-dark text-white' : 'text-brand-muted hover:text-brand-blue-dark'
            }`}
          >
            {k === 'file' ? 'Upload file' : 'Add link'}
          </button>
        ))}
      </div>

      {kind === 'file' ? (
        <div>
          <label className="block text-sm font-medium text-brand-muted mb-1">File</label>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-brand-muted file:mr-3 file:rounded-md file:border-0 file:bg-brand-hairline file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-brand-border"
          />
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium text-brand-muted mb-1">Link URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full rounded-md border border-brand-border px-3 py-2 text-sm focus:border-brand-border focus:outline-none"
            placeholder="https://example.com/resource"
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-brand-muted mb-1">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          className="w-full rounded-md border border-brand-border px-3 py-2 text-sm focus:border-brand-border focus:outline-none"
          placeholder="e.g. 2024 Finals Paper — Physics"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-brand-muted mb-1">
          Description <span className="font-normal text-brand-muted-soft">(optional)</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full rounded-md border border-brand-border px-3 py-2 text-sm focus:border-brand-border focus:outline-none"
          placeholder="Brief summary visible to all members"
        />
      </div>

      <p className="text-xs text-brand-muted-soft">
        Access is inherited from the object a resource is attached to — assign this resource to a Space,
        Cohort, Workshop or Competition from that object&apos;s admin page. There&apos;s no per-resource download gate.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-600">Resource saved successfully.</p>}

      <button
        type="submit"
        disabled={uploading}
        className="rounded-md bg-brand-blue-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
      >
        {uploading ? 'Saving…' : kind === 'link' ? 'Add link' : 'Upload resource'}
      </button>
    </form>
  )
}
