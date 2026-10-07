import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentUserIsAdmin } from '@/lib/admin-auth'
import { RESOURCES_BUCKET } from '@/lib/community'
import { claimUpload, discardUpload } from '@/lib/uploads'
import { PD_ARTWORK_PATH } from '@/lib/pd-certificate'

export const dynamic = 'force-dynamic'

// The one educator PD certificate background (decision Q6, 7 Oct 2026). It is
// global, not per event, so it lives at a fixed path rather than in a table:
// GET says whether it exists; PUT { storagePath } claims a staged upload
// (purpose pd-certificate-artwork) and copies it over the current one.

const isPng = (b: Uint8Array) => b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
const isJpeg = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff

export async function GET() {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { data } = await supabaseServer().storage.from(RESOURCES_BUCKET).list('pd-certificate', { search: 'current' })
  const current = (data ?? []).find((f) => f.name === 'current')
  return NextResponse.json({ hasArtwork: !!current, updatedAt: current?.updated_at ?? null })
}

export async function PUT(req: Request) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { storagePath?: unknown }
  const storagePath = typeof body.storagePath === 'string' ? body.storagePath : ''
  if (!storagePath.startsWith('pd-certificate/staged-')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const claimed = await claimUpload({
    purpose: 'pd-certificate-artwork',
    storagePath,
    // A signed URL accepts any bytes; the renderer can only use these two.
    verify: (bytes) => isPng(bytes) || isJpeg(bytes),
    verifyError: 'That file doesn’t look like a PNG or JPEG image.',
  })
  if ('error' in claimed) return NextResponse.json({ error: claimed.error }, { status: claimed.status })

  const { error } = await supabaseServer().storage.from(RESOURCES_BUCKET).upload(PD_ARTWORK_PATH, claimed.bytes, {
    upsert: true,
    contentType: isPng(claimed.bytes) ? 'image/png' : 'image/jpeg',
  })
  await discardUpload(RESOURCES_BUCKET, storagePath)
  if (error) {
    console.error('[pd-certificate] artwork replace failed:', error)
    return NextResponse.json({ error: 'The artwork could not be saved. Try again.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
