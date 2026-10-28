import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { finishGroupSetup, previewGroupSetup, SETUP_STEPS, type SetupStep } from '@/lib/group-registration-setup'

// "Finish registration setup" for a group (admins + the event's managers).
//   GET  → { items: [{ step, needed, summary }] } — what is missing, nothing sent.
//   POST { steps: SetupStep[] } → { results: { [step]: outcome } }
// Each step checks what exists first, so a repeat run never double-invoices.
// See lib/group-registration-setup.ts.
export const maxDuration = 300

const bodySchema = z.object({ steps: z.array(z.enum(SETUP_STEPS as [SetupStep, ...SetupStep[]])).min(1) })

type Db = ReturnType<typeof supabaseServer>

async function guard(db: Db, id: string): Promise<{ slug: string; teacherMemberId: string | null } | NextResponse> {
  const access = await requireEventAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const { data: reg } = await db.from('registrations').select('event_slug, type, teacher_member_id').eq('id', id).maybeSingle()
  if (!reg || reg.type !== 'group') return NextResponse.json({ error: 'Group registration not found' }, { status: 404 })
  if (!access.isAdmin && !(access.assignedSlugs ?? []).includes(reg.event_slug as string)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return { slug: reg.event_slug as string, teacherMemberId: (reg.teacher_member_id as string | null) ?? null }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const g = await guard(db, id)
  if (g instanceof NextResponse) return g
  const items = await previewGroupSetup(db, id)
  if (!items) return NextResponse.json({ error: 'Group registration not found' }, { status: 404 })
  return NextResponse.json({ items })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const g = await guard(db, id)
  if (g instanceof NextResponse) return g

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Choose at least one step' }, { status: 400 })

  const results = await finishGroupSetup(db, id, parsed.data.steps)
  if (!results) return NextResponse.json({ error: 'Group registration not found' }, { status: 404 })

  if (g.teacherMemberId) {
    const actor = await actorFromAuth()
    await logActivity(
      {
        memberId: g.teacherMemberId,
        category: 'event',
        action: 'group_setup_finished',
        summary: `Group registration setup finished for ${g.slug}: ${Object.entries(results).map(([k, v]) => `${k} ${v}`).join('; ')}`,
        metadata: { registrationId: id, eventSlug: g.slug, results },
        ...actor,
      },
      db,
    )
  }
  return NextResponse.json({ results })
}
