import { NextResponse } from 'next/server'
import { watermarkImageBuffer } from '@/lib/watermark/image'

// On-the-fly watermarker for CMS/CDN images (Sanity). Fetches the source image,
// bakes "© Stellr Education" into the bottom-right, and returns it with immutable
// cache headers so Vercel's CDN serves the stamped bytes after the first hit.
//
// Locked to Stellr's own Sanity project so this can't be used as an open image
// proxy. Sanity URLs already carry the asset hash + transform params, so they
// cache cleanly.

export const runtime = 'nodejs'

// deep review MEM-2 / PUB-3: only serve images from Stellr's OWN Sanity project.
// The old allowlist was the host `cdn.sanity.io` — but anyone can create a free
// Sanity project and upload an SVG/HTML asset, which this route would then fetch
// and serve from the Stellr origin with the upstream Content-Type (stored XSS on
// www and app). Pin to `/images/<projectId>/<dataset>/` (ids from the same env
// the Sanity client reads — lib/sanity.ts), only ever echo a real raster image
// Content-Type, and cap the fetched size so this can't be an open, CPU-heavy
// proxy for arbitrary bytes.
const ALLOWED_IMAGE_TYPE = /^image\/(jpeg|png|webp|avif|gif)(;|$)/
const MAX_UPSTREAM_BYTES = 15 * 1024 * 1024 // 15 MB — generous for a CMS photo

export async function GET(req: Request) {
  const src = new URL(req.url).searchParams.get('src')
  if (!src) return NextResponse.json({ error: 'src required' }, { status: 400 })

  let origin: URL
  try {
    origin = new URL(src)
  } catch {
    return NextResponse.json({ error: 'invalid src' }, { status: 400 })
  }

  // Read the project/dataset at request time so the nodejs runtime picks up the
  // deployment env (and tests can stub it). Pin the full path, not just the host.
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production'
  const allowedPrefix = projectId ? `/images/${projectId}/${dataset}/` : null
  if (
    origin.protocol !== 'https:' ||
    origin.hostname !== 'cdn.sanity.io' ||
    !allowedPrefix ||
    !origin.pathname.startsWith(allowedPrefix)
  ) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 400 })
  }

  // redirect: 'error' so a 3xx response can't smuggle in an off-allowlist origin.
  const upstream = await fetch(origin.toString(), { redirect: 'error' }).catch(() => null)
  if (!upstream || !upstream.ok) {
    return NextResponse.json({ error: 'upstream fetch failed' }, { status: 502 })
  }

  // Never echo a non-image Content-Type: an SVG/HTML asset would execute as
  // script on our origin. Allowlist real raster image types only.
  const contentType = upstream.headers.get('content-type') ?? ''
  if (!ALLOWED_IMAGE_TYPE.test(contentType)) {
    return NextResponse.json({ error: 'unsupported media type' }, { status: 415 })
  }

  // Cap the size before and after buffering (handles a lying/absent Content-Length).
  if (Number(upstream.headers.get('content-length') ?? 0) > MAX_UPSTREAM_BYTES) {
    return NextResponse.json({ error: 'too large' }, { status: 415 })
  }
  const input = Buffer.from(await upstream.arrayBuffer())
  if (input.byteLength > MAX_UPSTREAM_BYTES) {
    return NextResponse.json({ error: 'too large' }, { status: 415 })
  }

  // deep review MEM-2: on a watermark failure, fail closed with 502 — NEVER fall
  // back to the original bytes. The old passthrough was the XSS/raw-bytes
  // primitive (a non-image sharp rejected came straight back untouched).
  let out: Buffer
  try {
    out = await watermarkImageBuffer(input)
  } catch (err) {
    console.error('[img] watermark failed:', err)
    return NextResponse.json({ error: 'processing failed' }, { status: 502 })
  }

  return new NextResponse(out as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      // Defence in depth: even a byte-for-byte passthrough (sharp returns the
      // input for sub-96px images) can't run script under this CSP.
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // Immutable: the src URL changes whenever the asset or transform changes.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
