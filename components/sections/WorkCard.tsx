'use client'

import { useEffect, useState } from 'react'
import { FileText, Download, ExternalLink } from 'lucide-react'
import { type CompetitionAsset, isPending, flagMissing } from '@/lib/media-manifest'
import { AssetGate } from './AssetGate'

/**
 * T4 — Work card → gated download. The preview (cover + page-browsable PDF) is
 * ALWAYS open; only the full dossier download is gated behind the one-field
 * subscriber modal (README §8). Open briefs bypass the gate entirely. Once the
 * visitor has subscribed (localStorage `stellr_subscriber`), gated downloads
 * skip the modal too.
 *
 * Gated assets must have an `assetKey` registered in /api/asset-request's ASSETS
 * map (so the file is emailed + the lead captured in HubSpot).
 */
const CTA =
  'inline-flex items-center justify-center gap-2 rounded-[9px] bg-primary px-5 py-3 font-display text-[15px] font-semibold text-white hover:bg-primary-deep transition-colors'

export function WorkCard({ asset, className = '' }: { asset: CompetitionAsset; className?: string }) {
  const [subscribed, setSubscribed] = useState(false)
  useEffect(() => {
    try {
      setSubscribed(!!localStorage.getItem('stellr_subscriber'))
    } catch {
      /* storage unavailable — treat as not subscribed */
    }
  }, [])

  const pending = isPending(asset)
  if (pending) flagMissing('competition', asset.id)

  const gated = asset.gated && !subscribed
  const eyebrow = asset.gated ? 'Subscriber resource' : 'Free to download'

  return (
    <div className={`flex gap-5 rounded-panel border border-line bg-white p-5 shadow-card ${className}`}>
      {/* Cover */}
      <div className="relative h-[112px] w-[84px] shrink-0 overflow-hidden rounded-md border border-line bg-[linear-gradient(160deg,#20264F,#0E1330)]">
        {!pending && asset.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- small fixed-size cover thumbnail
          <img src={asset.thumbnail} alt={`Cover of ${asset.title}`} className="h-full w-full object-cover" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center">
            <FileText className="h-7 w-7 text-star-gold" />
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-[10.5px] font-display font-bold uppercase tracking-[0.13em] text-primary">{eyebrow}</p>
        <h3 className="mt-1 font-display text-[16px] font-bold leading-tight text-ink">{asset.title}</h3>
        <p className="mt-1 text-[13px] text-content-faint">
          {asset.pages ? `${asset.pages}-page PDF` : 'PDF'}
          {asset.credit ? ` · ${asset.credit}` : ''}
          {pending ? ' · file pending' : ''}
        </p>

        <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
          {/* Preview is always visible */}
          {!pending && (
            <a
              href={asset.previewHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-primary hover:text-primary-deep"
            >
              <ExternalLink className="h-4 w-4" /> Preview
            </a>
          )}

          {/* Download — gated vs open */}
          {pending ? (
            <span className="text-[13px] text-content-faint">Download available once hosted</span>
          ) : gated ? (
            <AssetGate
              asset={asset.assetKey ?? asset.id}
              title={asset.title}
              fileUrl={asset.fileHref}
              triggerLabel="Get the full PDF ↓"
              eyebrow="Subscriber resource"
              triggerClassName={CTA}
              emailOnly
            />
          ) : (
            <a href={asset.fileHref} download className={CTA}>
              <Download className="h-4 w-4" /> Download
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
