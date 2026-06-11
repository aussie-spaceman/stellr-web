'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Badge & certificate generator panel (PRD 6.7).
// Badges: 3x4" landscape, all participants, tiled on US Letter for printing.
// Certificates: students only, US Letter or A4.
export default function EventBadges({
  eventSlug,
  hasBadgeArtwork,
  hasCertificateArtwork,
  certificateFormat,
}: {
  eventSlug: string
  hasBadgeArtwork: boolean
  hasCertificateArtwork: boolean
  certificateFormat: 'us_letter' | 'a4'
}) {
  const router = useRouter()
  const [format, setFormat] = useState<'us_letter' | 'a4'>(certificateFormat)
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function upload(kind: 'badge' | 'certificate', file: File) {
    setUploading(kind)
    setError(null)
    const formData = new FormData()
    formData.set('kind', kind)
    formData.set('file', file)
    const res = await fetch(`/api/admin/events/${eventSlug}/artwork`, { method: 'POST', body: formData })
    setUploading(null)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.error ?? 'Upload failed')
      return
    }
    router.refresh()
  }

  function UploadInput({ kind, has }: { kind: 'badge' | 'certificate'; has: boolean }) {
    return (
      <label className="text-xs text-gray-500 cursor-pointer">
        <span className="underline hover:text-gray-700">
          {uploading === kind ? 'Uploading…' : has ? 'Replace background artwork' : 'Upload background artwork'}
        </span>
        {has && <span className="ml-1 text-green-600">✓ set</span>}
        <input
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          disabled={uploading !== null}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) upload(kind, file)
            e.target.value = ''
          }}
        />
      </label>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Badges & Certificates</h3>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="border border-gray-200 rounded-lg p-4 space-y-2">
          <p className="font-medium text-gray-900 text-sm">Name Badges</p>
          <p className="text-xs text-gray-500">
            3×4″ landscape, all participants, tiled six per US Letter page with cut guides.
          </p>
          <UploadInput kind="badge" has={hasBadgeArtwork} />
          <div>
            <a
              href={`/api/admin/events/${eventSlug}/badges`}
              className="inline-block text-sm font-medium bg-indigo-600 text-white rounded-lg px-3 py-1.5 mt-1"
            >
              Download Badges PDF
            </a>
          </div>
        </div>
        <div className="border border-gray-200 rounded-lg p-4 space-y-2">
          <p className="font-medium text-gray-900 text-sm">Participation Certificates</p>
          <p className="text-xs text-gray-500">One per student, landscape, with their full name and the event name.</p>
          <UploadInput kind="certificate" has={hasCertificateArtwork} />
          <div className="flex items-center gap-2 mt-1">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as 'us_letter' | 'a4')}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white text-gray-700"
            >
              <option value="us_letter">US Letter</option>
              <option value="a4">A4</option>
            </select>
            <a
              href={`/api/admin/events/${eventSlug}/certificates?format=${format}`}
              className="inline-block text-sm font-medium bg-indigo-600 text-white rounded-lg px-3 py-1.5"
            >
              Download Certificates PDF
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
