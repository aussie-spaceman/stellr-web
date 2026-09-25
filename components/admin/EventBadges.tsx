'use client'

import { useState } from 'react'
import { postUpload, uploadDirectToStorage } from '@/lib/upload-client'
import { useRouter } from 'next/navigation'

// Name badge generator panel (PRD 6.7).
// Badges: 3x4" landscape, all participants, tiled on US Letter for printing.
// Certificates have their own panel, one artwork per award: EventCertificates.
export default function EventBadges({
  eventSlug,
  hasBadgeArtwork,
}: {
  eventSlug: string
  hasBadgeArtwork: boolean
}) {
  const router = useRouter()
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function upload(kind: 'badge', file: File) {
    setUploading(kind)
    setError(null)
    try {
      // Bytes go browser → storage via a signed URL; only the path is posted.
      const stored = await uploadDirectToStorage(file, 'event-artwork', { slug: eventSlug, kind })
      if ('error' in stored) {
        setError(stored.error)
        return
      }
      const result = await postUpload(
        `/api/admin/events/${eventSlug}/artwork`,
        JSON.stringify({ kind, storagePath: stored.storagePath, fileType: stored.fileType }),
        { headers: { 'Content-Type': 'application/json' } },
      )
      if ('error' in result) {
        setError(result.error)
        return
      }
      router.refresh()
    } finally {
      setUploading(null)
    }
  }

  function UploadInput({ kind, has }: { kind: 'badge'; has: boolean }) {
    return (
      <label className="text-xs text-brand-muted-soft cursor-pointer">
        <span className="underline hover:text-brand-muted">
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
    <div className="bg-white rounded-xl border border-brand-border p-4 space-y-4">
      <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide">Name badges</h3>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="border border-brand-border rounded-lg p-4 space-y-2">
          <p className="font-medium text-brand-blue-dark text-sm">Name Badges</p>
          <p className="text-xs text-brand-muted-soft">
            3×4″ landscape, all participants, tiled six per US Letter page with cut guides.
          </p>
          <UploadInput kind="badge" has={hasBadgeArtwork} />
          <div>
            <a
              href={`/api/admin/events/${eventSlug}/badges`}
              className="inline-block text-sm font-medium bg-brand-blue text-white rounded-lg px-3 py-1.5 mt-1"
            >
              Download Badges PDF
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
