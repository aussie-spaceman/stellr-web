import { NextResponse } from 'next/server'
import { getCurrentMember, signedDownloadUrl } from '@/lib/community'
import { resolveTrainingOpen } from '@/lib/resources-catalogue'

// Office documents can't render in a bare browser tab, so route them through the
// Google Docs viewer (matches the in-lesson document player).
const OFFICE_RE = /\.(docx?|pptx?|xlsx?)(\?|#|$)/i
function viewerFor(url: string, title: string): string {
  return OFFICE_RE.test(url) || OFFICE_RE.test(title)
    ? `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=false`
    : url
}

// GET /api/community/resources/training-open?ref=tr:<id>|rec:<itemId>[&redirect=1]
// Opens a read-only training lesson resource / recording surfaced in the global
// catalogue. Access is re-checked at request time (enrolled in the module). Files
// and recordings stream via a short-lived signed URL; links return their URL.
//
// With ?redirect=1 the route 302s straight to the destination — used as a plain
// anchor href so clicking a resource opens the file directly (no blank tab).
// Without it, returns JSON { url, title, kind } for programmatic callers.
export async function GET(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const params = new URL(req.url).searchParams
  const ref = params.get('ref') ?? ''
  const wantsRedirect = params.get('redirect') === '1'
  const resolved = await resolveTrainingOpen(member, ref)
  if (!resolved) return NextResponse.json({ error: 'No access to this resource' }, { status: 403 })

  let url: string | null
  if (resolved.kind === 'link') {
    url = resolved.url
  } else {
    url = await signedDownloadUrl(resolved.storagePath)
    if (!url) return NextResponse.json({ error: 'Could not generate link' }, { status: 500 })
  }

  if (wantsRedirect) {
    if (!url) return NextResponse.json({ error: 'Could not open resource' }, { status: 500 })
    // Recordings/links open as-is; documents pass through the viewer.
    const dest = resolved.kind === 'file' ? viewerFor(url, resolved.title) : url
    return NextResponse.redirect(dest)
  }

  const kind = resolved.kind === 'link' ? 'link' : resolved.kind === 'recording' ? 'video' : 'file'
  return NextResponse.json({ url, title: resolved.title, kind })
}
