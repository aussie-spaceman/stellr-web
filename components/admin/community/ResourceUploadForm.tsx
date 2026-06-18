'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Space {
  id: string
  name: string
}

export function ResourceUploadForm({ spaces }: { spaces: Space[] }) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [spaceId, setSpaceId] = useState('')
  const [minTierRank, setMinTierRank] = useState('1')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !title.trim()) {
      setError('File and title are required.')
      return
    }
    setUploading(true)
    setError(null)
    setSuccess(false)

    const fd = new FormData()
    fd.append('file', file)
    fd.append('title', title.trim())
    if (description.trim()) fd.append('description', description.trim())
    if (spaceId) fd.append('spaceId', spaceId)
    fd.append('minTierRank', minTierRank)

    try {
      const res = await fetch('/api/admin/community/resources', {
        method: 'POST',
        body: fd,
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Upload failed.')
        return
      }
      setSuccess(true)
      setFile(null)
      setTitle('')
      setDescription('')
      setSpaceId('')
      router.refresh()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-brand-border bg-white p-6 space-y-4">
      <h2 className="text-base font-semibold text-brand-blue-dark">Upload new resource</h2>

      <div>
        <label className="block text-sm font-medium text-brand-muted mb-1">File</label>
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-brand-muted file:mr-3 file:rounded-md file:border-0 file:bg-brand-hairline file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-brand-border"
          required
        />
      </div>

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

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-brand-muted mb-1">Space</label>
          <select
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
            className="w-full rounded-md border border-brand-border px-3 py-2 text-sm focus:border-brand-border focus:outline-none"
          >
            <option value="">— All spaces —</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-brand-muted mb-1">Download access</label>
          <select
            value={minTierRank}
            onChange={(e) => setMinTierRank(e.target.value)}
            className="w-full rounded-md border border-brand-border px-3 py-2 text-sm focus:border-brand-border focus:outline-none"
          >
            <option value="0">All members (free + paid)</option>
            <option value="1">Paid members only</option>
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-600">Resource uploaded successfully.</p>}

      <button
        type="submit"
        disabled={uploading}
        className="rounded-md bg-brand-blue-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
      >
        {uploading ? 'Uploading…' : 'Upload resource'}
      </button>
    </form>
  )
}
