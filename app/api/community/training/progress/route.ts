import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { memberCanAccess } from '@/lib/community'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { autoCompleteTrainingAction } from '@/lib/sessions'
import { ensureCertificate } from '@/lib/training-portal'
import { assertNotImpersonating } from '@/lib/impersonation'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// POST /api/community/training/progress
// Body: { itemId: string, status: 'completed' | 'in_progress' }
// Records the member's progress on a single training item (FR-COM-10).
export async function POST(req: Request) {
  return audited(req, { action: 'community.training.progress', table: 'training_items' }, () => saveProgress(req))
}

async function saveProgress(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { itemId, status } = await req.json().catch(() => ({}))
  if (!itemId || (status !== 'completed' && status !== 'in_progress')) {
    return NextResponse.json({ error: 'itemId and valid status required' }, { status: 400 })
  }

  const db = supabaseServer()

  // Confirm the item exists and the member can access its module before writing.
  const { data: item } = await db
    .from('training_items')
    .select('id, module_id, training_modules(min_tier_rank)')
    .eq('id', itemId)
    .maybeSingle()
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const mod = Array.isArray(item.training_modules) ? item.training_modules[0] : item.training_modules
  const minRank = (mod as { min_tier_rank?: number } | null)?.min_tier_rank ?? 0
  const ok = await memberCanAccess(member, 'training_module', item.module_id as string, minRank)
  if (!ok) return NextResponse.json({ error: 'Upgrade required' }, { status: 403 })
  noteAudit(req, { targetId: itemId, metadata: { completed: status === 'completed' } })

  const { error } = await db.rpc('set_training_progress', {
    p_member_id: member.id,
    p_item_id: itemId,
    p_status: status,
  })
  if (error) {
    console.error('[training] progress error:', error)
    return NextResponse.json({ error: 'Could not save progress' }, { status: 500 })
  }

  if (status === 'completed') {
    const moduleId = item.module_id as string
    const { count } = await db
      .from('training_items')
      .select('id', { count: 'exact', head: true })
      .eq('module_id', moduleId)
    const { count: doneCount } = await db
      .from('training_progress')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', member.id)
      .eq('status', 'completed')
      .in('item_id', (await db.from('training_items').select('id').eq('module_id', moduleId)).data?.map((r) => r.id) ?? [])
    if (count != null && doneCount != null && doneCount >= count) {
      await autoCompleteTrainingAction(member.id, moduleId)
    }
    // Auto-issue a completion certificate once every published lesson is done.
    await ensureCertificate(member.id, moduleId)
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
