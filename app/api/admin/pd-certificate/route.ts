import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentUserIsAdmin } from '@/lib/admin-auth'
import { RESOURCES_BUCKET } from '@/lib/community'
import { claimUpload, discardUpload } from '@/lib/uploads'
import { parsePdLayout } from '@/lib/pd-certificate'
import {
  isPdPage,
  loadPdLayout,
  pdArtworkPath,
  pdArtworkStatus,
  pdTheme,
  pinDefaultPdPage,
  removePdEventPage,
  savePdLayout,
  type PdScope,
} from '@/lib/pd-certificate-store'

export const dynamic = 'force-dynamic'

// The educator PD certificate: front + back artwork and the field layout, for
// one theme's default (space | environmental), or — with `event` — one event's
// own files, each overriding the theme's (lib/pd-certificate-store). Admins only.
//   GET ?theme=[&event=]                       → { theme, pages (updated_at | null), layout (what prints),
//                                                 defaults: the theme's pages, with event }
//   PUT { theme, event?, page, storagePath }    → claim a staged upload (purpose pd-certificate-artwork)
//                                                 and make it that page
//   PUT { theme, event?, layout }               → save where the four fields sit on the front
//   DELETE ?theme=&event=&page=                 → drop an event's own page (it prints the theme's again)
// Replacing a theme's page first copies the outgoing one to every event that
// has issued PD certificates on it, so their downloads do not change.

const isPng = (b: Uint8Array) => b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
const isJpeg = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The scope a request names, or null for a malformed event slug. */
function scopeOf(theme: unknown, event: unknown): PdScope | null {
  if (event === undefined || event === null || event === '') return { theme: pdTheme(theme) }
  return typeof event === 'string' && SLUG_RE.test(event) ? { theme: pdTheme(theme), event } : null
}

export async function GET(req: Request) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const search = new URL(req.url).searchParams
  const scope = scopeOf(search.get('theme'), search.get('event'))
  if (!scope) return NextResponse.json({ error: 'Unknown event' }, { status: 400 })
  const db = supabaseServer()
  const [pages, layout, defaults] = await Promise.all([
    pdArtworkStatus(db, scope),
    loadPdLayout(db, scope.theme, scope.event),
    scope.event ? pdArtworkStatus(db, { theme: scope.theme }) : Promise.resolve(null),
  ])
  return NextResponse.json({ theme: scope.theme, pages, layout, defaults })
}

export async function PUT(req: Request) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as {
    theme?: unknown; event?: unknown; page?: unknown; storagePath?: unknown; layout?: unknown
  }
  const scope = scopeOf(body.theme, body.event)
  if (!scope) return NextResponse.json({ error: 'Unknown event' }, { status: 400 })
  const db = supabaseServer()

  if (body.layout !== undefined) {
    const layout = parsePdLayout(body.layout)
    if (!layout) return NextResponse.json({ error: 'A field position is out of range' }, { status: 400 })
    const err = await savePdLayout(db, scope, layout)
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

  if (!scope.event) {
    try {
      await pinDefaultPdPage(db, scope.theme, body.page)
    } catch (err) {
      console.error('[pd-certificate] pin failed:', err)
      await discardUpload(RESOURCES_BUCKET, storagePath)
      return NextResponse.json(
        { error: 'Events that already issued PD certificates could not keep this page, so it was not replaced. Try again.' },
        { status: 500 },
      )
    }
  }

  const { error } = await db.storage.from(RESOURCES_BUCKET).upload(pdArtworkPath(scope, body.page), claimed.bytes, {
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

export async function DELETE(req: Request) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const search = new URL(req.url).searchParams
  const scope = scopeOf(search.get('theme'), search.get('event'))
  const page = search.get('page')
  if (!scope?.event || !isPdPage(page)) {
    return NextResponse.json({ error: 'Say which event and page' }, { status: 400 })
  }
  const err = await removePdEventPage(supabaseServer(), { theme: scope.theme, event: scope.event }, page)
  if (err) {
    console.error('[pd-certificate] remove failed:', err)
    return NextResponse.json({ error: 'The page could not be removed. Try again.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
