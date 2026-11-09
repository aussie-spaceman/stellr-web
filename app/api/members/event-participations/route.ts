import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { assertNotImpersonating } from '@/lib/impersonation'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// POST /api/members/event-participations — member adds a new event activity record
export async function POST(req: Request) {
  return audited(req, { action: 'member.event_participation.create', table: 'event_participations' }, () => addParticipation(req))
}

async function addParticipation(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — see lib/impersonation.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const { event_year, event_location, team_name, award } = body

  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .single()

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const { data, error } = await db
    .from('event_participations')
    .insert({
      member_id: member.id,
      event_year: event_year || null,
      event_location: event_location || null,
      team_name: team_name || null,
      award: award || null,
      status: 'pending',
    })
    .select()
    .single()

  if (error) {
    console.error('Event participation insert error:', error)
    return NextResponse.json({ error: 'Failed to create record' }, { status: 500 })
  }

  noteAudit(req, { targetId: (data as { id?: string } | null)?.id ?? null })
  return NextResponse.json({ participation: data })
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
