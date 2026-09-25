'use client'

import { useState } from 'react'
import { postUpload, uploadDirectToStorage } from '@/lib/upload-client'
import { useRouter } from 'next/navigation'
import { BADGE_FORMATS, DEFAULT_BADGE_FORMAT, type BadgeFormat } from '@/lib/badge-layout'

const FORMATS = Object.keys(BADGE_FORMATS) as BadgeFormat[]

// Name badge generator panel (PRD 6.7).
// Pick the Avery stock, give it a background, download the sheet. Each stock
// keeps its own background, since the two labels are different shapes.
// Certificates have their own panel, one artwork per award: EventCertificates.
export default function EventBadges({
  eventSlug,
  artworkSet,
}: {
  eventSlug: string
  /** Which formats already have a background. */
  artworkSet: Record<BadgeFormat, boolean>
}) {
  const router = useRouter()
  const [format, setFormat] = useState<BadgeFormat>(DEFAULT_BADGE_FORMAT)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const spec = BADGE_FORMATS[format]
  const has = artworkSet[format]

  async function upload(file: File) {
    setUploading(true)
    setMsg(null)
    try {
      // Bytes go browser → storage via a signed URL; only the path is posted.
      const stored = await uploadDirectToStorage(file, 'event-artwork', { slug: eventSlug, kind: spec.artworkKind })
      if ('error' in stored) {
        setMsg({ text: stored.error, error: true })
        return
      }
      const result = await postUpload(
        `/api/admin/events/${eventSlug}/artwork`,
        JSON.stringify({ kind: spec.artworkKind, storagePath: stored.storagePath, fileType: stored.fileType }),
        { headers: { 'Content-Type': 'application/json' } },
      )
      if ('error' in result) {
        setMsg({ text: result.error, error: true })
        return
      }
      setMsg(
        result.data.lineFound === false
          ? { text: 'Background saved, but no horizontal line was found on it. Names will be centred on the label.', error: true }
          : { text: 'Background saved. Names will sit on the line.' },
      )
      router.refresh()
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-brand-border p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide">Name badges</h3>
        <p className="text-xs text-brand-muted-soft mt-1">
          One badge for every student and volunteer mentor, full name on one line. Names sit just above the
          horizontal line on the background and shrink to fit if they are long.
        </p>
      </div>

      <div role="radiogroup" aria-label="Avery product" className="inline-flex rounded-lg border border-brand-border p-0.5">
        {FORMATS.map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={f === format}
            onClick={() => {
              setFormat(f)
              setMsg(null)
            }}
            className={`text-sm font-medium rounded-md px-3 py-1.5 ${
              f === format ? 'bg-brand-blue text-white' : 'text-brand-blue-dark hover:bg-brand-canvas'
            }`}
          >
            {BADGE_FORMATS[f].label}
          </button>
        ))}
      </div>

      <div className="border border-brand-border rounded-lg p-4 space-y-2">
        <p className="font-medium text-brand-blue-dark text-sm">{spec.label}</p>
        <p className="text-xs text-brand-muted-soft">
          {spec.description}. {has ? <span className="text-green-700">Background set.</span> : <span>No background yet.</span>}
        </p>
        <label className="block text-xs text-brand-muted-soft cursor-pointer">
          <span className="underline hover:text-brand-muted">
            {uploading ? 'Uploading…' : has ? 'Replace background' : 'Upload background'}
          </span>
          <span className="ml-1">
            (PNG or JPEG, landscape, the label’s shape; cropped to fit, never stretched)
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) upload(file)
              e.target.value = ''
            }}
          />
        </label>
        {msg && <p className={`text-xs ${msg.error ? 'text-red-600' : 'text-green-700'}`}>{msg.text}</p>}
        <div>
          <a
            href={`/api/admin/events/${eventSlug}/badges?format=${format}`}
            className="inline-block text-sm font-medium bg-brand-blue text-white rounded-lg px-3 py-1.5 mt-1"
          >
            Download {spec.label} PDF
          </a>
        </div>
        <p className="text-xs text-brand-muted-soft">Print at 100% (actual size), not “fit to page”.</p>
      </div>
    </div>
  )
}
