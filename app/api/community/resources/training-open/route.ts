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

// Friendly full-page message for the redirect flow — the resource opens in a new
// tab, so a raw JSON error there reads as broken. Shown when the file is missing,
// expired, or the member no longer has access.
function errorPage(message: string, status: number): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Resource unavailable</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F0F2F8;color:#13183A;
display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{max-width:420px;padding:32px;background:#fff;border-radius:16px;box-shadow:0 18px 40px -30px rgba(20,26,61,.4);text-align:center}
h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#5A6178;margin:0 0 16px;line-height:1.5}
button{font:inherit;font-size:14px;font-weight:600;color:#fff;background:#3C6DF6;border:0;border-radius:10px;padding:8px 16px;cursor:pointer}</style>
</head><body><div class="card"><h1>This resource can’t be opened</h1>
<p>${message}</p>
<button onclick="window.close()">Close tab</button></div></body></html>`
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
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
  if (!resolved) {
    return wantsRedirect
      ? errorPage('You no longer have access to it, or it has been removed.', 403)
      : NextResponse.json({ error: 'No access to this resource' }, { status: 403 })
  }

  let url: string | null
  if (resolved.kind === 'link') {
    url = resolved.url
  } else {
    url = await signedDownloadUrl(resolved.storagePath)
  }

  if (!url) {
    // File-type resource whose underlying object is missing from storage (e.g. the
    // upload never completed) or a link with no URL.
    return wantsRedirect
      ? errorPage('The file could not be found. Please let an administrator know so they can re-upload it.', 404)
      : NextResponse.json({ error: 'Could not generate link' }, { status: 500 })
  }

  if (wantsRedirect) {
    // Recordings/links open as-is; documents pass through the viewer.
    const dest = resolved.kind === 'file' ? viewerFor(url, resolved.title) : url
    return NextResponse.redirect(dest)
  }

  const kind = resolved.kind === 'link' ? 'link' : resolved.kind === 'recording' ? 'video' : 'file'
  return NextResponse.json({ url, title: resolved.title, kind })
}
