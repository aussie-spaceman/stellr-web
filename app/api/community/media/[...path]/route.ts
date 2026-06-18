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
  const storagePath = path.map(decodeURIComponent).join('/')
  // Confine to the media prefix — never proxy arbitrary resource paths.
  if (!storagePath.startsWith('community-media/')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const url = await signedDownloadUrl(storagePath)
  if (!url) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.redirect(url)
}
