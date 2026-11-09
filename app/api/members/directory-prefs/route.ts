import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, memberIsMinor } from '@/lib/community'
import { assertNotImpersonating } from '@/lib/impersonation'
import { auditMutation } from '@/lib/audit/route'
import { selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

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
  return audited(req, { action: 'member.directory_prefs.update', table: 'member_directory_prefs' }, () => savePrefs(req))
}

async function savePrefs(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = prefsSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // deep review MEM-10 (safeguarding): a minor must not make themselves
  // discoverable. Refuse opting IN to the directory; turning visibility off is
  // always allowed (and is what we want for any minor already opted in).
  if (parsed.data.is_visible && memberIsMinor(member)) {
    return NextResponse.json(
      { error: 'The member directory is for adult members only.' },
      { status: 403 },
    )
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

// The audit event for this route (docs/TENANCY-S5.md, B16): written after the response,
// never for a 4xx, ids and short codes only. lib/community/self-service-audit decides
// what is written; the call stays here because the coverage gate reads it here.
async function audited(req: Request, spec: SelfServiceAudit, run: () => Promise<Response>): Promise<Response> {
  let res: Response | undefined
  try {
    return (res = await run())
  } finally {
    await record(req, res, spec)
  }
}

async function record(req: Request, res: Response | undefined, spec: SelfServiceAudit) {
  const event = await selfServiceEvent(req, res, spec)
  if (!event) return
  await auditMutation(event, { afterResponse: true })
}
