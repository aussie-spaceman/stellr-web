import Link from 'next/link'
import { redirect } from 'next/navigation'
import QRCode from 'qrcode'
import { Download } from 'lucide-react'
import { Button } from '@stellr/web-ui'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { SITE_URL } from '@/lib/env'
import { isRealProductionApp } from '@/lib/env-guards'
import { CHECK_IN_BANNER_PATH, loadOpenCheckIns, pickBannerEvent, todayUtc } from '@/lib/check-in-banner'

export const metadata = { title: 'Admin — Check-In Banner' }
export const dynamic = 'force-dynamic'

// The QR code for the reusable check-in banner (Oct 2026). It encodes the fixed
// address /check-in, which never changes, so the banner is printed once and
// carried to every in-person event. The files go to a designer or print shop;
// the page also shows where a scan goes right now.
export default async function CheckInBannerAdminPage() {
  const access = await requireEventAccess()
  if (!access.ok) redirect(access.status === 401 ? '/sign-in' : '/admin')

  const url = new URL(CHECK_IN_BANNER_PATH, SITE_URL).toString()
  const printedAddress = `${new URL(url).host.replace(/^www\./, '')}${CHECK_IN_BANNER_PATH}`
  // Q = 25% error correction: survives glare, creases and a scuffed corner.
  // A 4-module white border is the standard quiet zone scanners need.
  const qrOptions = { margin: 4, errorCorrectionLevel: 'Q' } as const
  const [svg, png, open] = await Promise.all([
    QRCode.toString(url, { ...qrOptions, type: 'svg' }),
    QRCode.toDataURL(url, { ...qrOptions, width: 3000 }),
    loadOpenCheckIns(supabaseServer()),
  ])
  const svgHref = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

  const inPersonOpen = open.filter((e) => e.inPerson)
  const target = pickBannerEvent(open, todayUtc())

  return (
    <div className="max-w-content space-y-6">
      <div>
        <Link href="/admin/competitions" className="text-sm text-primary">
          ← Competitions
        </Link>
        <h1 className="mt-1 font-heading text-title uppercase text-ink">Check-in banner</h1>
        <p className="mt-2 text-content-body">
          One QR code for every in-person event. A scan goes to whichever event has check-in open, so the same banner
          works at every event. Open check-in from the event’s Check-in page when the doors open.
        </p>
      </div>

      {!isRealProductionApp() && (
        <p className="rounded-control border border-line bg-surface px-4 py-3 text-sm text-content-body">
          This QR code points at <span className="font-medium text-ink">{new URL(url).host}</span>, not the live site.
          Download the banner files from the live admin.
        </p>
      )}

      <section className="rounded-ds-card border border-line bg-white p-5">
        <h2 className="font-subheading text-sm font-semibold uppercase tracking-wide text-content-muted">Right now</h2>
        {target ? (
          <p className="mt-2 text-content-body">
            A scan opens check-in for{' '}
            <Link href={`/admin/competitions/${target.slug}/check-in`} className="font-semibold text-primary">
              {target.title ?? target.slug}
            </Link>
            .
          </p>
        ) : (
          <p className="mt-2 text-content-body">
            No in-person event has check-in open, so a scan shows “Check-in isn’t open yet” and sends people to the
            desk.
          </p>
        )}
        {inPersonOpen.length > 1 && (
          <p className="mt-2 text-sm text-danger">
            Check-in is open for {inPersonOpen.map((e) => e.title ?? e.slug).join(' and ')}. Close the one you aren’t
            running.
          </p>
        )}
        <a href={url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-primary">
          Try the address →
        </a>
      </section>

      <section className="grid gap-6 rounded-ds-card border border-line bg-white p-5 md:grid-cols-2">
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- data: URL from the QR encoder; nothing to optimise */}
          <img src={svgHref} alt="Check-in banner QR code" className="w-full max-w-xs rounded-control border border-line-light" />
          <p className="text-sm text-content-muted">
            Print this address under the code for anyone whose camera won’t scan:{' '}
            <span className="font-semibold text-ink">{printedAddress}</span>
          </p>
        </div>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button href={svgHref} download="stellr-check-in-banner-qr.svg" className="min-h-11 px-4 py-2">
              <Download className="h-4 w-4" aria-hidden /> SVG (for print)
            </Button>
            <Button
              variant="secondary"
              href={png}
              download="stellr-check-in-banner-qr.png"
              className="min-h-11 px-4 py-2"
            >
              <Download className="h-4 w-4" aria-hidden /> PNG, 3000px
            </Button>
          </div>
          <div>
            <h2 className="font-subheading text-sm font-semibold text-ink">Notes for the designer</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-content-body">
              <li>Print the code at least 8 in (20 cm) wide so it scans from a few steps back.</li>
              <li>Keep the white border around it, and keep it dark on a plain light background.</li>
              <li>Don’t recolour, round or put a logo over the code.</li>
              <li>Test a proof with two or three phones before the full print.</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  )
}
