import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, memberCanAccess } from '@/lib/community'

// POST /api/community/training/progress
// Body: { itemId: string, status: 'completed' | 'in_progress' }
// Records the member's progress on a single training item (FR-COM-10).
export async function POST(req: Request) {
  const member = await getCurrentMember()
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
  const ok = await memberCanAccess(member, 'training_module', item.module_id as string, minRank, 'view')
  if (!ok) return NextResponse.json({ error: 'Upgrade required' }, { status: 403 })

  const { error } = await db.rpc('set_training_progress', {
    p_member_id: member.id,
    p_item_id: itemId,
    p_status: status,
  })
  if (error) {
    console.error('[training] progress error:', error)
    return NextResponse.json({ error: 'Could not save progress' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
