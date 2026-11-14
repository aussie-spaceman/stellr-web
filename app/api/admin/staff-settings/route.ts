import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { isStellrAdmin } from '@/lib/authz'
import { withAudit } from '@/lib/audit/route'

export const dynamic = 'force-dynamic'

const ROUTE = '/api/admin/staff-settings'

// The Staff role's one setting: which Academy training module every Staff member
// completes (lib/staff.ts). Until one is chosen nobody can activate. Admin only
// (roles:manage), like granting Staff.
//
//   GET → the chosen module and the modules to choose from
//   PUT { trainingModuleId: uuid | null }

export async function GET() {
  if (!(await isStellrAdmin({ route: ROUTE }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = supabaseServer()
  const [settings, modules] = await Promise.all([
    db.from('staff_role_settings').select('training_module_id, updated_at').eq('id', true).maybeSingle(),
    db.from('training_modules').select('id, title').order('title'),
  ])
  if (settings.error || modules.error) return NextResponse.json({ error: 'Could not load the Staff settings.' }, { status: 500 })
  return NextResponse.json({
    trainingModuleId: (settings.data as { training_module_id: string | null } | null)?.training_module_id ?? null,
    modules: (modules.data ?? []) as { id: string; title: string }[],
  })
}

const schema = z.object({ trainingModuleId: z.string().uuid().nullable() })

export const PUT = withAudit(
  () => ({ action: 'staff.settings.update' as const, actor: { session: true } as const, tenant: { stellr: true } as const, target: { table: 'staff_role_settings', id: null } }),
  async (req: Request) => {
    if (!(await isStellrAdmin({ route: ROUTE }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const parsed = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Choose a training module.' }, { status: 400 })
    const db = supabaseServer()
    const { userId } = await auth()
    const { data: me } = userId ? await db.from('members').select('id').eq('clerk_user_id', userId).maybeSingle() : { data: null }
    const { error } = await db
      .from('staff_role_settings')
      .upsert({ id: true, training_module_id: parsed.data.trainingModuleId, updated_by: (me as { id: string } | null)?.id ?? null, updated_at: new Date().toISOString() })
    if (error) return NextResponse.json({ error: 'Could not save the setting.' }, { status: 500 })
    return NextResponse.json({ ok: true })
  },
)
