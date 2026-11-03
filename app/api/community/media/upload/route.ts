import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { assertNotImpersonating } from '@/lib/impersonation'
import { supabaseServer } from '@/lib/supabase'
import { COMMUNITY_MEDIA_STAGING, claimUpload, discardUpload } from '@/lib/uploads'
import { contentTypeFor } from '@/lib/file-sniff'

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

// POST /api/community/media/upload — record an image a member uploaded to embed
// in a post/comment. The bytes went straight to storage via /api/uploads/sign,
// under community-media-staging/<memberId>/; this claims and verifies the stored
// object, republishes it to community-media/<memberId>/ — the only prefix the
// media proxy serves — and returns the access-gated proxy URL. Returns { src }.
//
// S0 content safety: the signed upload URL doesn't bind a content type, so the
// browser could PUT an SVG or HTML page there under any type and simply never
// call this route. Signing into a staging prefix means nothing reaches the proxy
// until it has passed claimUpload, and the published copy is written by the
// server under a type taken from the bytes, not the uploader's.
export async function POST(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  // The bytes went browser → storage via /api/uploads/sign; only the path lands
  // here, and claimUpload re-checks the object that actually arrived.
  const b = await req.json().catch(() => ({}))
  const storagePath = typeof b.storagePath === 'string' ? b.storagePath : ''
  const fileType = typeof b.fileType === 'string' ? b.fileType : ''
  if (!storagePath) return NextResponse.json({ error: 'storagePath required' }, { status: 400 })
  if (!ALLOWED.has(fileType)) return NextResponse.json({ error: 'Unsupported image type' }, { status: 415 })

  // Namespaced per member by the signing step; refuse anything else outright.
  const stagingPrefix = `${COMMUNITY_MEDIA_STAGING}/${member.id}/`
  if (!storagePath.startsWith(stagingPrefix)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // The declared type can be spoofed and the signed URL accepts any bytes; the
  // purpose accepts only stored objects that really are PNG, JPEG, GIF or WebP.
  const claimed = await claimUpload({ purpose: 'community-media', storagePath, expectedPrefix: stagingPrefix })
  if ('error' in claimed) return NextResponse.json({ error: claimed.error }, { status: claimed.status })

  const publishedPath = `community-media/${member.id}/${storagePath.slice(stagingPrefix.length)}`
  const { error } = await supabaseServer()
    .storage.from(claimed.bucket)
    .upload(publishedPath, claimed.bytes, { contentType: contentTypeFor(claimed.format), upsert: false })
  await discardUpload(claimed.bucket, storagePath)
  if (error) {
    console.error('[community] media publish failed:', error)
    return NextResponse.json({ error: 'Could not save the image. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ src: `/api/community/media/${publishedPath.split('/').map(encodeURIComponent).join('/')}` })
}
