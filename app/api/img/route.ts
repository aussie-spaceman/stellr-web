import { NextResponse } from 'next/server'
import { watermarkImageBuffer } from '@/lib/watermark/image'

// On-the-fly watermarker for CMS/CDN images (Sanity). Fetches the source image,
// bakes "© Stellr Education" into the bottom-right, and returns it with immutable
// cache headers so Vercel's CDN serves the stamped bytes after the first hit.
//
// Locked to the Sanity CDN so this can't be used as an open image proxy. Sanity
// URLs already carry the asset hash + transform params, so they cache cleanly.

export const runtime = 'nodejs'

const ALLOWED_HOSTS = ['cdn.sanity.io']

export async function GET(req: Request) {
  const src = new URL(req.url).searchParams.get('src')
  if (!src) return NextResponse.json({ error: 'src required' }, { status: 400 })

  let origin: URL
  try {
    origin = new URL(src)
  } catch {
    return NextResponse.json({ error: 'invalid src' }, { status: 400 })
  }
  if (origin.protocol !== 'https:' || !ALLOWED_HOSTS.some((h) => origin.hostname === h || origin.hostname.endsWith(`.${h}`))) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 400 })
  }

  const upstream = await fetch(origin.toString()).catch(() => null)
  if (!upstream || !upstream.ok) {
    return NextResponse.json({ error: 'upstream fetch failed' }, { status: 502 })
  }
  const contentType = upstream.headers.get('content-type') ?? 'image/jpeg'
  const input = Buffer.from(await upstream.arrayBuffer())

  let out: Buffer = input
  try {
    out = await watermarkImageBuffer(input)
  } catch (err) {
    console.error('[img] watermark failed, serving original:', err)
  }

  return new NextResponse(out as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // Immutable: the src URL changes whenever the asset or transform changes.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
