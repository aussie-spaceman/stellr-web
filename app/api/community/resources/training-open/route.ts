import { NextResponse } from 'next/server'
import { getCurrentMember, signedDownloadUrl } from '@/lib/community'
import { resolveTrainingOpen } from '@/lib/resources-catalogue'

// GET /api/community/resources/training-open?ref=tr:<id>|rec:<itemId>
// Opens a read-only training lesson resource / recording surfaced in the global
// catalogue. Access is re-checked at request time (enrolled in the module). Files
// and recordings stream via a short-lived signed URL; links return their URL.
export async function GET(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const ref = new URL(req.url).searchParams.get('ref') ?? ''
  const resolved = await resolveTrainingOpen(member, ref)
  if (!resolved) return NextResponse.json({ error: 'No access to this resource' }, { status: 403 })

  let url: string | null
  if (resolved.kind === 'link') {
    url = resolved.url
  } else {
    url = await signedDownloadUrl(resolved.storagePath)
    if (!url) return NextResponse.json({ error: 'Could not generate link' }, { status: 500 })
  }

  const kind = resolved.kind === 'link' ? 'link' : resolved.kind === 'recording' ? 'video' : 'file'
  return NextResponse.json({ url, title: resolved.title, kind })
}
