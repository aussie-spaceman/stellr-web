import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { rateLimitGuard, HOUR_MS } from '@/lib/rate-limit'
import { GATED_ASSETS, GATED_BUCKET } from '@/lib/gated-assets'
import { verifyGatedDownload } from '@/lib/gated-download-link'

export const dynamic = 'force-dynamic'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

const NO_STORE = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
}

/**
 * The emailed link for a gated download (lib/gated-download-link.ts). Checks
 * the signature and expiry, then sends the file from private storage as an
 * attachment. The storage location is never revealed to the client.
 */
export async function GET(req: Request) {
  const limited = rateLimitGuard(req, 'asset-download', { limit: 30, windowMs: HOUR_MS })
  if (limited) return limited

  const params = new URL(req.url).searchParams
  const check = verifyGatedDownload(params)
  if (!check.ok) {
    const key = params.get('a')
    const page = check.reason === 'expired' && key && key in GATED_ASSETS
      ? GATED_ASSETS[key as keyof typeof GATED_ASSETS].pagePath
      : ''
    const message = check.reason === 'expired'
      ? `This download link has expired. You can ask for a fresh copy at ${SITE_URL}${page}.`
      : 'This download link is not valid.'
    return new NextResponse(message, {
      status: check.reason === 'expired' ? 410 : 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', ...NO_STORE },
    })
  }

  const asset = GATED_ASSETS[check.key]
  const { data, error } = await supabaseServer().storage.from(GATED_BUCKET).download(asset.storagePath)
  if (error || !data) {
    console.error('[asset-download] Storage read failed:', check.key, error?.message)
    return new NextResponse('The file is unavailable right now. Please try again later.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', ...NO_STORE },
    })
  }

  // The files are a few MB at most, so buffer rather than stream.
  const bytes = await data.arrayBuffer()
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${asset.filename}"`,
      'Content-Length': String(bytes.byteLength),
      ...NO_STORE,
    },
  })
}
