import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'

// Admin CRUD for tier_grant_rules (migration 025) — the grant-rules engine that
// powers the Membership Studio "Grant rules" tab. Every rule is "when <trigger>
// [matching <conditions>] grant <tier> for <duration>". The rule evaluator in
// lib/membership-grants.ts reads these at trigger time.

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

const TRIGGERS = ['signup', 'event_attendance', 'event_award', 'mentor_at_event', 'subscribe_website', 'graduation', 'manual', 'competition_registration', 'tier_purchased']
const DURATIONS = ['months', 'until_grad_july1', 'lifetime', 'match_source']
const GRANT_TARGETS = ['self', 'registered_students']

export async function GET() {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = supabaseServer()
  const { data } = await db
    .from('tier_grant_rules')
    .select('*')
    .order('trigger_type')
    .order('priority', { ascending: false })
  return NextResponse.json({ rules: data ?? [] })
}

export async function POST(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const b = await req.json().catch(() => ({}))
  if (!b.name || !b.trigger_type || !b.grant_tier_id) {
    return NextResponse.json({ error: 'name, trigger_type, grant_tier_id required' }, { status: 400 })
  }
  if (!TRIGGERS.includes(b.trigger_type)) return NextResponse.json({ error: 'invalid trigger_type' }, { status: 400 })
  if (b.duration_kind && !DURATIONS.includes(b.duration_kind)) {
    return NextResponse.json({ error: 'invalid duration_kind' }, { status: 400 })
  }
  if (b.grant_target && !GRANT_TARGETS.includes(b.grant_target)) {
    return NextResponse.json({ error: 'invalid grant_target' }, { status: 400 })
  }

  const admin = await getCurrentMember()
  const db = supabaseServer()
  const { data, error } = await db
    .from('tier_grant_rules')
    .insert({
      name: b.name,
      trigger_type: b.trigger_type,
      conditions: b.conditions ?? {},
      grant_tier_id: b.grant_tier_id,
      duration_kind: b.duration_kind ?? 'months',
      duration_months: b.duration_months ?? null,
      grant_target: b.grant_target ?? 'self',
      replaces_free: b.replaces_free ?? true,
      priority: b.priority ?? 0,
      is_active: b.is_active ?? true,
      created_by: admin?.id ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[membership/rules] insert error:', error)
    return NextResponse.json({ error: 'Could not create rule' }, { status: 500 })
  }
  return NextResponse.json({ id: data.id })
}

export async function PATCH(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const b = await req.json().catch(() => ({}))
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of ['name', 'trigger_type', 'conditions', 'grant_tier_id', 'duration_kind', 'duration_months', 'grant_target', 'replaces_free', 'priority', 'is_active']) {
    if (b[k] !== undefined) patch[k] = b[k]
  }
  if (patch.trigger_type && !TRIGGERS.includes(patch.trigger_type as string)) {
    return NextResponse.json({ error: 'invalid trigger_type' }, { status: 400 })
  }
  if (patch.grant_target && !GRANT_TARGETS.includes(patch.grant_target as string)) {
    return NextResponse.json({ error: 'invalid grant_target' }, { status: 400 })
  }

  const db = supabaseServer()
  const { error } = await db.from('tier_grant_rules').update(patch).eq('id', b.id)
  if (error) {
    console.error('[membership/rules] patch error:', error)
    return NextResponse.json({ error: 'Could not update rule' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = supabaseServer()
  const { error } = await db.from('tier_grant_rules').delete().eq('id', id)
  if (error) {
    console.error('[membership/rules] delete error:', error)
    return NextResponse.json({ error: 'Could not delete rule' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
