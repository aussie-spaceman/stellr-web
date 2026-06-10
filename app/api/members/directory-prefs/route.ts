import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'

const prefsSchema = z.object({
  is_visible: z.boolean(),
  show_school: z.boolean().optional(),
  show_region: z.boolean().optional(),
})

// GET /api/members/directory-prefs — fetch current member's prefs (or defaults)
export async function GET() {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = supabaseServer()
  const { data } = await db
    .from('member_directory_prefs')
    .select('is_visible, show_school, show_region')
    .eq('member_id', member.id)
    .maybeSingle()

  return NextResponse.json(data ?? { is_visible: false, show_school: true, show_region: true })
}

// PATCH /api/members/directory-prefs — upsert directory visibility preferences
export async function PATCH(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = prefsSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const db = supabaseServer()
  const { error } = await db
    .from('member_directory_prefs')
    .upsert(
      { member_id: member.id, ...parsed.data, updated_at: new Date().toISOString() },
      { onConflict: 'member_id' }
    )

  if (error) {
    console.error('[community] directory prefs upsert error:', error)
    return NextResponse.json({ error: 'Failed to save preferences' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
