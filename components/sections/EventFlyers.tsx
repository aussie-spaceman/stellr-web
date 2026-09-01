'use client'

import { Download, FileText } from 'lucide-react'
import { flyerDownloadUrl, type EventFlyer } from '@/lib/sanity'
import { pushDataLayer, participationTypeFor } from '@/lib/analytics'

/**
 * Downloads panel for an event or campaign page — the flyers authored on the
 * Sanity document (`flyers[]`). Renders nothing when there are none, so the
 * events still waiting on artwork simply don't show the section.
 *
 * Deliberately ungated: unlike the T4 competition dossiers, a flyer is
 * recruitment collateral we want a teacher to forward to colleagues, so there
 * is no AssetGate/email wall in front of it. The click is tracked instead.
 */
export function EventFlyers({
  flyers,
  slug,
  title,
  activityType,
  className = '',
}: {
  flyers?: EventFlyer[]
  slug: string
  title: string
  activityType?: string
  className?: string
}) {
  const items = (flyers ?? []).filter((f) => f?.url)
  if (items.length === 0) return null

  return (
    <div className={`rounded-panel border border-line bg-white p-6 shadow-card ${className}`}>
      <h2 className="font-heading text-lg font-bold text-ink">Downloads</h2>
      <p className="mt-1 text-sm text-content-secondary">
        Print it, share it with colleagues, or send it home with students.
      </p>

      <ul className="mt-4 space-y-2">
        {items.map((flyer, i) => (
          <li key={`${flyer.url}-${i}`}>
            <a
              href={flyerDownloadUrl(flyer)}
              // Cross-origin (cdn.sanity.io), so the `download` attribute is
              // ignored by browsers — the ?dl= in the URL is what actually
              // makes the CDN serve it as an attachment.
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                pushDataLayer({
                  event: 'flyer_download',
                  competition_name: title,
                  competition_id: slug,
                  participation_type: participationTypeFor(activityType),
                  flyer_label: flyer.label,
                })
              }
              className="group flex items-center gap-3 rounded-ds-card border border-line px-4 py-3 transition-colors hover:border-primary hover:bg-primary-soft/40"
            >
              <FileText className="h-5 w-5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-heading text-[15px] font-semibold text-ink">
                  {flyer.label}
                </span>
                <span className="block text-xs text-content-secondary">{descriptor(flyer)}</span>
              </span>
              <Download
                className="h-4 w-4 shrink-0 text-content-secondary transition-colors group-hover:text-primary-deep"
                aria-hidden
              />
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** "3-page PDF · 1.8 MB", degrading to "PDF" when neither is known. */
function descriptor(flyer: EventFlyer): string {
  const parts = [flyer.pages && flyer.pages > 0 ? `${flyer.pages}-page PDF` : 'PDF']
  const size = formatBytes(flyer.size)
  if (size) parts.push(size)
  return parts.join(' · ')
}

function formatBytes(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
