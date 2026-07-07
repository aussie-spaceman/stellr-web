import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { getMemberAccessSummary } from '@/lib/member-access'
import { addGlobalRole, getGlobalRoleNames, ROLES_BY_BRACKET, type MemberRole } from '@/lib/member-roles'
import { TIERS_BY_BRACKET, type AgeBracket } from '@/lib/tiers'

// /api/admin/access/people/[id] — everything the Person 360 renders in one
// call: profile + bracket, tier memberships, global roles, and the resolved
// Effective Access rows (lib/member-access.ts). POST/DELETE manage the global
// role chips; tier chips write through the existing memberships routes.

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const db = supabaseServer()

  const [{ data: member }, roles, summary, { data: memberships }] = await Promise.all([
    db.from('members').select('id, first_name, last_name, email, age_bracket').eq('id', id).maybeSingle(),
    getGlobalRoleNames(id),
    getMemberAccessSummary(id),
    db.from('member_memberships')
      .select('id, tier_id, expires_at, renewal_status, membership_tiers(name, is_free)')
      .eq('member_id', id)
      .eq('renewal_status', 'active'),
  ])
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const today = new Date().toISOString().split('T')[0]
  const active = (memberships ?? [])
    .filter((m) => !m.expires_at || m.expires_at >= today)
    .map((m) => {
      const tier = Array.isArray(m.membership_tiers) ? m.membership_tiers[0] : m.membership_tiers
      return { membershipId: m.id, tierId: m.tier_id, tierName: tier?.name ?? null, expiresAt: m.expires_at }
    })

  const bracket = (member.age_bracket as AgeBracket | null) ?? null
  return NextResponse.json({
    member,
    bracket,
    allowedTiers: bracket ? TIERS_BY_BRACKET[bracket] : null,
    allowedRoles: bracket ? ROLES_BY_BRACKET[bracket] : null,
    roles,
    memberships: active,
    rows: summary.rows,
  })
}

const roleSchema = z.object({ role: z.string() })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const parsed = roleSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const db = supabaseServer()
  const result = await addGlobalRole(db, id, parsed.data.role as MemberRole, 'admin')
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const parsed = roleSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const role = parsed.data.role as MemberRole

  if (role === 'member') {
    return NextResponse.json({ error: 'The base member role cannot be removed.' }, { status: 400 })
  }

  const db = supabaseServer()
  await db.from('member_roles').delete()
    .eq('member_id', id).eq('role', role).eq('scope', 'global')
  return NextResponse.json({ ok: true })
}
