// Fixture route handlers for the IDOR canary (scripts/idor-canary.mjs).
//
// Each one guards a record in one of the ways real routes do. Every guard line
// carries a `CANARY:<name>` marker: the canary job copies this file, deletes
// one marked line, and asserts test/idor/fixtures.test.ts then FAILS. That
// proves the harness can see a missing isolation guard, so a green run of the
// generated suite means something.
//
// Not served by Next (it lives under test/), never imported by app code.
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { currentUserIsAdmin } from '@/lib/admin-auth'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { assertPlatformAdmin, currentTenantId, requireEventAccess } from '@/lib/authz'
import { loadScoped } from '@/lib/tenancy/load-scoped'
import { makeScope, type ScopeContext } from '@/lib/tenancy/scope-context'

type Ctx = { params: Promise<{ id: string }> }

async function me() {
  const { userId } = await auth()
  if (!userId) return null
  const { data } = await supabaseServer().from('members').select('id').eq('clerk_user_id', userId).maybeSingle()
  return (data as { id: string } | null) ?? null
}

/** Owner filter in the query: the shape most member routes use. */
export const ownerFiltered = {
  async GET(_req: Request, { params }: Ctx) {
    const member = await me()
    if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    const { id } = await params
    const { data } = await supabaseServer()
      .from('registrations')
      .select('*')
      .eq('id', id)
      .eq('member_id', member.id) // CANARY:owner-filter
      .maybeSingle()
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ registration: data })
  },
}

/** Owner check after the read: load by id, then compare the owner. */
export const ownerChecked = {
  async GET(_req: Request, { params }: Ctx) {
    const member = await me()
    if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    const { id } = await params
    const { data } = await supabaseServer().from('teams').select('*').eq('id', id).maybeSingle()
    const team = data as { owner_member_id?: string } | null
    if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (team.owner_member_id !== member.id) return NextResponse.json({ error: 'Not found' }, { status: 404 }) // CANARY:owner-check
    return NextResponse.json({ team })
  },
}

/** Admin guard first: the stellr_only shape. */
export const adminGuarded = {
  async GET(_req: Request, { params }: Ctx) {
    if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // CANARY:admin-guard
    const { id } = await params
    const { data } = await supabaseServer().from('members').select('*').eq('id', id).maybeSingle()
    return NextResponse.json({ member: data })
  },
}

/** Tenant filter: the S5 tenantDb shape (the caller's tenant from context). */
export const tenantFiltered = {
  async GET(_req: Request, { params }: Ctx) {
    const member = await me()
    if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    const { id } = await params
    const { data } = await supabaseServer()
      .from('events')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', STELLR_TENANT_ID) // CANARY:tenant-filter
      .maybeSingle()
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ event: data })
  },
}

/** A scoped write: the update only reaches the caller's own row. */
export const scopedWrite = {
  async PATCH(_req: Request, { params }: Ctx) {
    const member = await me()
    if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    const { id } = await params
    const { error } = await supabaseServer()
      .from('event_participations')
      .update({ status: 'withdrawn' })
      .eq('id', id)
      .eq('member_id', member.id) // CANARY:write-filter
    if (error) return NextResponse.json({ error: 'Failed' }, { status: 500 })
    return NextResponse.json({ ok: true })
  },
}

// ── Staff personas: the shapes a route takes once it is tenant_staff or platform_admin ──

/** The caller's scope, from lib/authz: the tenant and, for an event manager, their events. */
async function staffScope(): Promise<ScopeContext | null> {
  const access = await requireEventAccess()
  if (!access.ok) return null
  return makeScope({
    tenantId: access.tenantId,
    eventSlugs: access.assignedSlugs,
    actor: { kind: access.isAdmin ? 'tenant_admin' : 'event_manager', memberId: null },
  })
}

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })
const forbidden = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 })

/** The conversion target: loadScoped, with the route's own not-found. Must pass as written. */
export const loadScopedRead = {
  async GET(_req: Request, { params }: Ctx) {
    const scope = await staffScope()
    if (!scope) return forbidden()
    const { id } = await params
    const loaded = await loadScoped(scope, 'registrations', id, { db: supabaseServer(), notFound })
    if (!loaded.ok) return loaded.response ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
    return NextResponse.json({ registration: loaded.row })
  },
}

/** Tenant and event filters written by hand. Each marked line is one a route could forget. */
export const staffFiltered = {
  async GET(_req: Request, { params }: Ctx) {
    const scope = await staffScope()
    if (!scope) return forbidden()
    const { id } = await params
    let q = supabaseServer().from('registrations').select('*').eq('id', id)
    q = q.eq('tenant_id', scope.tenantId) // CANARY:staff-tenant-filter
    if (scope.eventSlugs) q = q.in('event_slug', [...scope.eventSlugs]) // CANARY:staff-event-filter
    const { data } = await q.maybeSingle()
    if (!data) return notFound()
    return NextResponse.json({ registration: data })
  },
}

/** A record outside the scope answers as a missing one: no 403 to tell them apart. */
export const staffUniform = {
  async GET(_req: Request, { params }: Ctx) {
    const scope = await staffScope()
    if (!scope) return forbidden()
    const { id } = await params
    const { data } = await supabaseServer().from('registrations').select('*').eq('id', id).maybeSingle()
    let row = data as { tenant_id: string; event_slug: string } | null
    const inScope = (r: { tenant_id: string; event_slug: string }) =>
      r.tenant_id === scope.tenantId && (scope.eventSlugs === null || scope.eventSlugs.includes(r.event_slug))
    if (row && !inScope(row)) row = null // CANARY:staff-uniform
    if (!row) return notFound()
    if (!inScope(row)) return forbidden()
    return NextResponse.json({ ok: true })
  },
}

/** No id to name: a list. What keeps another tenant out is only the filter on the read. */
export const staffList = {
  async GET() {
    const scope = await staffScope()
    if (!scope) return forbidden()
    let q = supabaseServer().from('registrations').select('*')
    q = q.eq('tenant_id', scope.tenantId) // CANARY:staff-list-tenant-filter
    if (scope.eventSlugs) q = q.in('event_slug', [...scope.eventSlugs]) // CANARY:staff-list-event-filter
    const { data } = await q
    return NextResponse.json({ registrations: data })
  },
}

/** A platform route: the tenant admin's membership gets them nothing here. */
export const platformGuarded = {
  async GET(_req: Request, { params }: Ctx) {
    if (!(await assertPlatformAdmin()).ok) return forbidden() // CANARY:platform-guard
    const { id } = await params
    const { data } = await supabaseServer().from('schools').select('*').eq('id', id).maybeSingle()
    return NextResponse.json({ school: data })
  },
}

// ── Tenant hosts: anonymous and participant, on one host naming another's record ──

/** A capability link answers only on its own tenant's host. */
export const hostTokenScoped = {
  async GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params
    const { data } = await supabaseServer()
      .from('survey_invitations')
      .select('*')
      .eq('token', token)
      .eq('tenant_id', currentTenantId()) // CANARY:host-tenant-filter
      .maybeSingle()
    if (!data) return notFound()
    return NextResponse.json({ invitation: data })
  },
}

/** Another host's record answers as a missing one. */
export const hostUniform = {
  async GET(_req: Request, { params }: { params: Promise<{ number: string }> }) {
    const { number } = await params
    const { data } = await supabaseServer().from('credentials').select('tenant_id').eq('credential_number', number).maybeSingle()
    let row = data as { tenant_id: string } | null
    if (row && row.tenant_id !== currentTenantId()) row = null // CANARY:host-uniform
    if (!row) return notFound()
    if (row.tenant_id !== currentTenantId()) return forbidden()
    return NextResponse.json({ ok: true })
  },
}

/** The live idiom: Stellr's id written in, not the host's. Right on one host and wrong on the other. */
export const hostHardcodedStellr = {
  async GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params
    const { data } = await supabaseServer().from('survey_invitations').select('*').eq('token', token).eq('tenant_id', STELLR_TENANT_ID).maybeSingle()
    if (!data) return notFound()
    return NextResponse.json({ invitation: data })
  },
}

export const FIXTURES = {
  ownerFiltered,
  ownerChecked,
  adminGuarded,
  tenantFiltered,
  scopedWrite,
  loadScopedRead,
  staffFiltered,
  staffUniform,
  staffList,
  platformGuarded,
  hostTokenScoped,
  hostUniform,
  hostHardcodedStellr,
} as const
