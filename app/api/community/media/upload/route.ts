import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { assertNotImpersonating } from '@/lib/impersonation'
import { claimUpload } from '@/lib/uploads'

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** Leading bytes of the four image formats we accept. */
function isAllowedImage(b: Uint8Array): boolean {
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true // PNG
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true // JPEG
  if (b.length >= 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return true // GIF
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true // WebP
  return false
}

// POST /api/community/media/upload — record an image a member uploaded to embed
// in a post/comment. The bytes went straight to storage via /api/uploads/sign,
// under community-media/<memberId>/; this claims and verifies the stored object
// and returns the access-gated proxy URL. Returns { src }.
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
  if (!storagePath.startsWith(`community-media/${member.id}/`)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const claimed = await claimUpload({
    purpose: 'community-media',
    storagePath,
    // The declared type can be spoofed and the signed URL accepts any bytes, so
    // confirm the stored object really is one of the image formats we allow.
    verify: (bytes) => isAllowedImage(bytes),
    verifyError: 'That file doesn’t look like a PNG, JPEG, GIF or WebP image.',
  })
  if ('error' in claimed) return NextResponse.json({ error: claimed.error }, { status: claimed.status })

  return NextResponse.json({ src: `/api/community/media/${storagePath.split('/').map(encodeURIComponent).join('/')}` })
}
