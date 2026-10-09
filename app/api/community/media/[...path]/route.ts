import { NextResponse } from 'next/server'
import { getCurrentMember, signedDownloadUrl } from '@/lib/community'

// GET /api/community/media/<path> — access-gated proxy for embedded post/comment
// images. Any signed-in member may view (images live inside tier-gated spaces,
// and the space/post gating already controls who reaches the page). Redirects to
// a short-lived signed URL so the storage path is never exposed directly.
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { path } = await params
  // deep review MEM-1: Next's route matcher already decoded each catch-all
  // segment once. The old code decoded a SECOND time (`path.map(decodeURIComponent)`),
  // so an encoded `..%2F` segment became `../` AFTER the `community-media/`
  // prefix check — and storage-js + the WHATWG URL parser then normalised the
  // dot-segments before the request left, signing ANY object the service key can
  // reach (guardian-signed minor consent PDFs in `signed-agreements/`, teacher
  // licences, campaign proposals, …). Never decode again, and reject any segment
  // that is empty, a dot-segment, or smuggles a path separator.
  if (
    !Array.isArray(path) ||
    path.length === 0 ||
    path.some((s) => s === '' || s === '.' || s === '..' || s.includes('/') || s.includes('\\'))
  ) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const storagePath = path.join('/')
  // Belt-and-braces: the proxy only ever serves the shape that `community-media`
  // uploads produce (`community-media/<memberId uuid>/<Date.now()>-<safeName>`,
  // see lib/uploads.ts). Anything else — including a path that escaped the prefix
  // — never reaches signedDownloadUrl.
  if (!/^community-media\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/.test(storagePath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const url = await signedDownloadUrl(storagePath)
  if (!url) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.redirect(url)
}
