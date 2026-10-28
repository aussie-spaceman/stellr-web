'use client'

import { useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { Dialog } from '@stellr/web-ui'

const PAGES = [
  {
    id: 'front',
    label: 'Front: your hours',
    src: '/images/educators/pd-certificate-sample-front.webp',
    alt: 'Sample certificate of professional development, front: the educator’s name, the event, its date and location, and the hours of effort completed.',
  },
  {
    id: 'back',
    label: 'Back: standards map',
    src: '/images/educators/pd-certificate-sample-back.webp',
    alt: 'Sample certificate, back: a standards alignment map showing where during the event each Common Core standard was addressed.',
  },
] as const

// Both images are 1200×927 WebP (US Letter landscape), rendered from the real
// certificate by scripts/pd-certificate-sample.ts. Plain <img>, already sized:
// next/image would spend the Image Transformations meter on two static files.
const W = 1200
const H = 927

/** The two pages of the sample PD certificate; either opens full size. */
export function PdCertificateSample() {
  const [open, setOpen] = useState<(typeof PAGES)[number] | null>(null)

  return (
    <>
      <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {PAGES.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => setOpen(p)}
              aria-haspopup="dialog"
              className="group block w-full text-left focus:outline-hidden"
            >
              <span className="relative block overflow-hidden rounded-ds-card border border-line bg-white shadow-card-lift transition-shadow group-hover:shadow-featured group-focus-visible:ring-2 group-focus-visible:ring-primary group-focus-visible:ring-offset-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP; see above */}
                <img src={p.src} alt={p.alt} width={W} height={H} loading="lazy" decoding="async" className="h-auto w-full" />
                <span className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-ink shadow-card">
                  <Maximize2 size={15} aria-hidden="true" />
                </span>
              </span>
              <span className="mt-2 block text-sm font-semibold text-ink">
                {p.label}
                <span className="sr-only">{' — view full size'}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Dialog open={open != null} onClose={() => setOpen(null)} title={open?.label ?? ''} description="Sample certificate" size="3xl">
        {open && (
          // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP; see above
          <img src={open.src} alt={open.alt} width={W} height={H} className="h-auto w-full rounded-control border border-line" />
        )}
      </Dialog>
    </>
  )
}
