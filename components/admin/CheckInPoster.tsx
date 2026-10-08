'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Printer } from 'lucide-react'
import { Button, Eyebrow } from '@stellr/web-ui'

// Letter-size door poster for the start of the check-in line (CO, Oct 2026): the
// line checks itself in on phones while it waits. Printing hides everything on
// the page except the poster, admin chrome included.
export default function CheckInPoster({ url, title, dateLabel }: { url: string; title: string; dateLabel: string | null }) {
  const [qr, setQr] = useState<string | null>(null)

  useEffect(() => {
    QRCode.toDataURL(url, { width: 1200, margin: 1, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(null))
  }, [url])

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          @page { size: letter portrait; margin: 0.5in; }
          body * { visibility: hidden; }
          #check-in-poster, #check-in-poster * { visibility: visible; }
          #check-in-poster { position: absolute; inset: 0; border: 0; box-shadow: none; }
        }
      `}</style>
      <div className="flex items-center gap-3 print:hidden">
        <Button onClick={() => window.print()} disabled={!qr} className="min-h-11 px-5 py-2">
          <Printer className="h-4 w-4" aria-hidden /> Print poster
        </Button>
        <p className="text-sm text-content-muted">Print a few — one at the start of the line, one at the desk.</p>
      </div>

      <div
        id="check-in-poster"
        className="mx-auto flex max-w-content flex-col items-center gap-6 rounded-ds-card border border-line bg-white px-8 py-10 text-center"
      >
        <div>
          <Eyebrow>Stellr Education</Eyebrow>
          <h1 className="mt-2 font-display text-4xl font-bold text-ink">{title}</h1>
          {dateLabel && <p className="mt-1 text-lg text-content-muted">{dateLabel}</p>}
        </div>
        <p className="font-display text-5xl font-bold text-primary">Check in here</p>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- data: URL from the QR encoder; nothing to optimise
          <img src={qr} alt="Check-in QR code" className="w-full max-w-md" />
        ) : (
          <div className="aspect-square w-full max-w-md animate-pulse rounded-control bg-surface" />
        )}
        <ol className="space-y-3 text-left text-xl text-content-body">
          <li>
            <span className="font-semibold text-ink">1.</span> Scan with your phone camera
          </li>
          <li>
            <span className="font-semibold text-ink">2.</span> Enter your name and date of birth
          </li>
          <li>
            <span className="font-semibold text-ink">3.</span> Show your screen at the desk for your company number and
            shirt
          </li>
        </ol>
        <p className="text-base text-content-muted">No phone? Head straight to the registration desk.</p>
      </div>
    </div>
  )
}
