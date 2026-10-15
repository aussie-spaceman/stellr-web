import { NextResponse, type NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { parseBody } from 'next-sanity/webhook'

// POST /api/webhooks/sanity — Sanity's publish webhook. The public pages are
// cached for up to an hour, and every Sanity read carries the 'sanity' tag
// (PUBLISHED_CACHE in lib/sanity.ts), so a publish expires them all at once and
// an edit shows on the next visit instead of within the hour.
//
// Set up in Sanity → API → Webhooks: trigger on create, update and delete,
// POST to this path, with a secret; the same secret goes in
// SANITY_REVALIDATE_SECRET. Without the variable the route refuses every call,
// and the pages still refresh hourly.

export async function POST(req: NextRequest) {
  const secret = process.env.SANITY_REVALIDATE_SECRET
  if (!secret) {
    console.error('[webhooks/sanity] SANITY_REVALIDATE_SECRET not set')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  let isValidSignature: boolean | null
  let body: { _type?: string } | null
  try {
    // Also waits out the Content Lake's eventual consistency, so the pages
    // that rebuild after this read the edit, not the version before it.
    ;({ isValidSignature, body } = await parseBody<{ _type?: string }>(req, secret, true))
  } catch {
    return NextResponse.json({ error: 'Unreadable body' }, { status: 400 })
  }
  if (!isValidSignature) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })

  // Expire now rather than serve one more stale copy: whoever published is
  // usually the next person to look.
  revalidateTag('sanity', { expire: 0 })
  return NextResponse.json({ revalidated: true, type: body?._type ?? null })
}
