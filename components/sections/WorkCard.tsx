'use client'

import { FileText, Download, ExternalLink } from 'lucide-react'
import { type CompetitionAsset, isPending, flagMissing } from '@/lib/media-helpers'
import { AssetGate } from './AssetGate'

/**
 * T4 — Work card. The preview (cover + page-browsable PDF) is ALWAYS open
 * (README §8). An open file downloads directly; a gated file opens the email
 * gate, and the full file only ever reaches the requester by email, as an
 * expiring link. A gated asset therefore carries no file URL at all — just the
 * `assetKey` registered in lib/gated-assets.ts.
 */
const CTA =
  'inline-flex items-center justify-center gap-2 rounded-[9px] bg-primary px-5 py-3 font-display text-[15px] font-semibold text-white hover:bg-primary-deep transition-colors'

export function WorkCard({ asset, eyebrow: eyebrowOverride, className = '' }: { asset: CompetitionAsset; eyebrow?: string; className?: string }) {
  const pending = isPending(asset)
  if (pending) flagMissing('competition', asset.id)

  const eyebrow = eyebrowOverride ?? (asset.gated ? 'Subscriber resource' : 'Free to download')

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

          {/* Download — gated (email only) vs open */}
          {pending ? (
            <span className="text-[13px] text-content-faint">Download available once hosted</span>
          ) : asset.gated && asset.assetKey ? (
            <AssetGate
              asset={asset.assetKey}
              title={asset.title}
              triggerLabel="Get the full PDF ↓"
              eyebrow="Subscriber resource"
              triggerClassName={CTA}
              emailOnly
            />
          ) : asset.fileHref ? (
            <a href={asset.fileHref} download className={CTA}>
              <Download className="h-4 w-4" /> Download
            </a>
          ) : null}
        </div>
      </div>
    </div>
  )
}
