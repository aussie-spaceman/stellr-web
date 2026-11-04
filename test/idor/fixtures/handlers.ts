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

export const FIXTURES = { ownerFiltered, ownerChecked, adminGuarded, tenantFiltered, scopedWrite } as const
