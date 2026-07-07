import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { attachAllowed, type AccessObjectType } from '@/lib/access-objects'
import { ALL_TIER_NAMES } from '@/lib/tiers'

// Admin CRUD for tier_grant_rules (migration 025) — the grant-rules engine that
// powers the Membership Studio "Grant rules" tab. Every rule is "when <trigger>
// [matching <conditions>] grant <tier> for <duration>". The rule evaluator in
// lib/membership-grants.ts reads these at trigger time.

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

const TRIGGERS = ['signup', 'event_attendance', 'event_award', 'mentor_at_event', 'subscribe_website', 'graduation', 'manual', 'competition_registration', 'tier_purchased', 'object_created']
const DURATIONS = ['months', 'until_grad_july1', 'lifetime', 'match_source', 'until_date']
const GRANT_TARGETS = ['self', 'registered_students']
const GRANT_KINDS = ['tier', 'credits', 'attach_object', 'roster_add']
const CREDIT_TYPES = ['mentoring', 'workshop']
const OBJECT_TYPES = ['space', 'course', 'workshop', 'cohort', 'event', 'campaign', 'resource']

/**
 * Object-anchored rule validation (admin/access convergence). Checks the shape
 * of object_created / attach_object / roster_add fields and rejects attach
 * rules the relationship matrix forbids — the same gate the attach endpoints
 * enforce at write time, applied here at rule-save time.
 */
async function validateObjectRule(b: Record<string, unknown>): Promise<string | null> {
  const trigger = b.trigger_type as string | undefined
  const grantKind = (b.grant_kind as string | undefined) ?? 'tier'

  if (trigger === 'object_created' && !OBJECT_TYPES.includes(b.object_type as string)) {
    return 'object_created rules need a valid object_type'
  }
  if (b.tier_min && !ALL_TIER_NAMES.includes(b.tier_min as string)) {
    return 'tier_min must be a canonical tier name'
  }
  if (grantKind === 'attach_object' || grantKind === 'roster_add') {
    if (!OBJECT_TYPES.includes(b.grant_object_type as string)) {
      return 'grant_object_type required for attach/roster rules'
    }
    if (!b.grant_object_ref && !b.is_dynamic) {
      return 'grant_object_ref required (or mark the rule dynamic)'
    }
    if (grantKind === 'attach_object' && b.object_type) {
      const ok = await attachAllowed(b.object_type as AccessObjectType, b.grant_object_type as AccessObjectType)
      if (!ok) {
        return `A ${b.grant_object_type} cannot be attached to a ${b.object_type} (relationship matrix)`
      }
    }
  }
  return null
}

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
  const grantKind = b.grant_kind ?? 'tier'
  if (!b.name || !b.trigger_type) {
    return NextResponse.json({ error: 'name, trigger_type required' }, { status: 400 })
  }
  if (!GRANT_KINDS.includes(grantKind)) return NextResponse.json({ error: 'invalid grant_kind' }, { status: 400 })
  if (grantKind === 'tier' && !b.grant_tier_id) {
    return NextResponse.json({ error: 'grant_tier_id required for a tier rule' }, { status: 400 })
  }
  if (grantKind === 'credits') {
    if (!CREDIT_TYPES.includes(b.grant_credit_type)) return NextResponse.json({ error: 'invalid grant_credit_type' }, { status: 400 })
    if (!(Number(b.grant_quantity) > 0)) return NextResponse.json({ error: 'grant_quantity must be > 0' }, { status: 400 })
  }
  if (!TRIGGERS.includes(b.trigger_type)) return NextResponse.json({ error: 'invalid trigger_type' }, { status: 400 })
  if (b.duration_kind && !DURATIONS.includes(b.duration_kind)) {
    return NextResponse.json({ error: 'invalid duration_kind' }, { status: 400 })
  }
  if (b.grant_target && !GRANT_TARGETS.includes(b.grant_target)) {
    return NextResponse.json({ error: 'invalid grant_target' }, { status: 400 })
  }
  const objectRuleError = await validateObjectRule(b)
  if (objectRuleError) return NextResponse.json({ error: objectRuleError }, { status: 400 })

  const admin = await getCurrentMember()
  const db = supabaseServer()
  const isCredits = grantKind === 'credits'
  const isObjectGrant = grantKind === 'attach_object' || grantKind === 'roster_add'
  const { data, error } = await db
    .from('tier_grant_rules')
    .insert({
      name: b.name,
      trigger_type: b.trigger_type,
      conditions: b.conditions ?? {},
      grant_kind: grantKind,
      grant_tier_id: isCredits || isObjectGrant ? null : b.grant_tier_id,
      grant_credit_type: isCredits ? b.grant_credit_type : null,
      grant_quantity: isCredits ? Math.floor(Number(b.grant_quantity)) : null,
      object_type: b.object_type ?? null,
      object_anchor_ref: b.object_anchor_ref ?? null,
      tier_min: b.tier_min ?? null,
      grant_object_type: isObjectGrant ? b.grant_object_type : null,
      grant_object_ref: isObjectGrant ? (b.grant_object_ref ?? null) : null,
      grant_role: grantKind === 'roster_add' ? (b.grant_role ?? null) : null,
      is_dynamic: b.is_dynamic ?? false,
      duration_kind: b.duration_kind ?? 'months',
      duration_months: b.duration_months ?? null,
      duration_until: b.duration_until ?? null,
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
  for (const k of ['name', 'trigger_type', 'conditions', 'grant_kind', 'grant_tier_id', 'grant_credit_type', 'grant_quantity', 'duration_kind', 'duration_months', 'duration_until', 'grant_target', 'replaces_free', 'priority', 'is_active', 'object_type', 'object_anchor_ref', 'tier_min', 'grant_object_type', 'grant_object_ref', 'grant_role', 'is_dynamic']) {
    if (b[k] !== undefined) patch[k] = b[k]
  }
  if (patch.trigger_type && !TRIGGERS.includes(patch.trigger_type as string)) {
    return NextResponse.json({ error: 'invalid trigger_type' }, { status: 400 })
  }
  if (patch.grant_target && !GRANT_TARGETS.includes(patch.grant_target as string)) {
    return NextResponse.json({ error: 'invalid grant_target' }, { status: 400 })
  }
  if (patch.grant_kind && !GRANT_KINDS.includes(patch.grant_kind as string)) {
    return NextResponse.json({ error: 'invalid grant_kind' }, { status: 400 })
  }
  if (patch.grant_credit_type && !CREDIT_TYPES.includes(patch.grant_credit_type as string)) {
    return NextResponse.json({ error: 'invalid grant_credit_type' }, { status: 400 })
  }
  const objectRuleError = await validateObjectRule(patch)
  if (objectRuleError) return NextResponse.json({ error: objectRuleError }, { status: 400 })

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
