import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentUserIsAdmin } from '@/lib/admin-auth'
import { RESOURCES_BUCKET } from '@/lib/community'
import { claimUpload, discardUpload } from '@/lib/uploads'
import { parsePdLayout } from '@/lib/pd-certificate'
import { isPdPage, loadPdLayout, pdArtworkPath, pdArtworkStatus, pdTheme, savePdLayout } from '@/lib/pd-certificate-store'

export const dynamic = 'force-dynamic'

// The educator PD certificate for one theme (space | environmental): front +
// back artwork and the field layout (lib/pd-certificate-store). Admins only.
//   GET ?theme=                         → { theme, pages: { front, back } (updated_at | null), layout }
//   PUT { theme, page, storagePath }    → claim a staged upload (purpose pd-certificate-artwork)
//                                         and make it that page
//   PUT { theme, layout }               → save where the four fields sit on the front

const isPng = (b: Uint8Array) => b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
const isJpeg = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff

export async function GET(req: Request) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const theme = pdTheme(new URL(req.url).searchParams.get('theme'))
  const db = supabaseServer()
  const [pages, layout] = await Promise.all([pdArtworkStatus(db, theme), loadPdLayout(db, theme)])
  return NextResponse.json({ theme, pages, layout })
}

export async function PUT(req: Request) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { theme?: unknown; page?: unknown; storagePath?: unknown; layout?: unknown }
  const theme = pdTheme(body.theme)
  const db = supabaseServer()

  if (body.layout !== undefined) {
    const layout = parsePdLayout(body.layout)
    if (!layout) return NextResponse.json({ error: 'A field position is out of range' }, { status: 400 })
    const err = await savePdLayout(db, theme, layout)
    if (err) {
      console.error('[pd-certificate] layout save failed:', err)
      return NextResponse.json({ error: 'The positions could not be saved. Try again.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, layout })
  }

  if (!isPdPage(body.page)) return NextResponse.json({ error: 'Say which page: front or back' }, { status: 400 })
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

  const { error } = await db.storage.from(RESOURCES_BUCKET).upload(pdArtworkPath(theme, body.page), claimed.bytes, {
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
