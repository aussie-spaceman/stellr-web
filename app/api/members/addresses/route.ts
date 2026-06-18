import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentStoreMember } from '@/lib/store/auth'

export const dynamic = 'force-dynamic'

// Member-facing shipping address book (used by direct-to-consumer checkout and
// non-attendance reship). A member can only see and edit their own addresses.

const FIELDS = ['label', 'line1', 'line2', 'city', 'state', 'postcode', 'country', 'is_default'] as const

export async function GET() {
  const member = await currentStoreMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = supabaseServer()
  const { data, error } = await db
    .from('member_addresses')
    .select('*')
    .eq('member_id', member.id)
    .order('is_default', { ascending: false })
  if (error) return NextResponse.json({ error: 'Could not load addresses' }, { status: 500 })
  return NextResponse.json({ addresses: data ?? [] })
}

async function clearDefault(memberId: string, exceptId?: string) {
  const db = supabaseServer()
  let q = db.from('member_addresses').update({ is_default: false }).eq('member_id', memberId)
  if (exceptId) q = q.neq('id', exceptId)
  await q
}

export async function POST(req: Request) {
  const member = await currentStoreMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (!body?.line1 || !body?.city || !body?.state || !body?.postcode) {
    return NextResponse.json({ error: 'line1, city, state and postcode are required' }, { status: 400 })
  }
  const db = supabaseServer()
  const row: Record<string, unknown> = { member_id: member.id }
  for (const f of FIELDS) if (body[f] !== undefined) row[f] = body[f]
  const { data, error } = await db.from('member_addresses').insert(row).select('id').single()
  if (error) return NextResponse.json({ error: 'Could not save address' }, { status: 500 })
  if (body.is_default) await clearDefault(member.id, (data as { id: string }).id)
  return NextResponse.json({ id: (data as { id: string }).id })
}

export async function PATCH(req: Request) {
  const member = await currentStoreMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = supabaseServer()
  const patch: Record<string, unknown> = {}
  for (const f of FIELDS) if (body[f] !== undefined) patch[f] = body[f]
  // Scope the update to the caller's own row.
  const { error } = await db.from('member_addresses').update(patch).eq('id', body.id).eq('member_id', member.id)
  if (error) return NextResponse.json({ error: 'Could not update address' }, { status: 500 })
  if (body.is_default) await clearDefault(member.id, body.id)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const member = await currentStoreMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = supabaseServer()
  const { error } = await db.from('member_addresses').delete().eq('id', id).eq('member_id', member.id)
  if (error) return NextResponse.json({ error: 'Could not delete address' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
