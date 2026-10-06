import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { assertNotImpersonating } from '@/lib/impersonation'
import { logActivity } from '@/lib/activity-log'
import { showsPrivacyToggles } from '@/lib/survey/privacy-prefs'

// PATCH /api/members/privacy-prefs — a student's own quote and photo/media
// permissions (V2.3 §1.7). Students 13+ only; read-only while viewing as.
const Body = z.object({ allow_quotes: z.boolean().optional(), allow_media: z.boolean().optional() }).refine((b) => b.allow_quotes !== undefined || b.allow_media !== undefined)

export async function PATCH(req: Request) {
  const blocked = await assertNotImpersonating()
  if (blocked) return blocked
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!showsPrivacyToggles(member)) return NextResponse.json({ error: 'Not available for this account' }, { status: 403 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const db = supabaseServer()
  const { error } = await db.from('member_privacy_prefs').upsert({ member_id: member.id, ...parsed.data }, { onConflict: 'member_id' })
  if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  const changes = Object.entries(parsed.data).map(([k, v]) => `${k === 'allow_quotes' ? 'quoting' : 'photo/media use'} ${v ? 'on' : 'off'}`)
  await logActivity({ memberId: member.id, actorType: 'member', category: 'account', action: 'privacy_prefs_updated', summary: `Turned ${changes.join(', ')}`, metadata: parsed.data })
  return NextResponse.json({ ok: true })
}
