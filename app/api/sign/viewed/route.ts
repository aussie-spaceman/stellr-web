import { supabaseServer } from '@/lib/supabase'
import { recordViewed } from '@/lib/esign/native/flow'
import { actingSession, json, requestMeta, sameOrigin, throttle } from '@/lib/esign/native/http'

// POST /api/sign/viewed — the page reports that a person has the document in
// front of them. Recorded from the page, not from opening the link: email
// security scanners fetch links automatically, and a scanner is not a parent.

export async function POST(req: Request) {
  const limited = throttle(req, 'viewed', 20)
  if (limited) return limited
  if (!sameOrigin(req)) return json({ error: 'Forbidden' }, 403)
  const db = supabaseServer()
  const ctx = await actingSession(db, req, 'act')
  if (!ctx) return json({ ok: false }, 404)
  await recordViewed(db, ctx, requestMeta(req))
  return json({ ok: true })
}
