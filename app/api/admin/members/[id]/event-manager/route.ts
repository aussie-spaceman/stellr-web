import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { hasCapability, type Capability } from '@/lib/authz'
import { actorFromAuth } from '@/lib/activity-log'
import { withAudit } from '@/lib/audit/route'
import { getAllCampaigns, getAllEvents } from '@/lib/events/repo'
import { eventLastDay } from '@/lib/utils'
import {
  assignEventManager,
  defaultExpiryDate,
  EVENT_MANAGER_GRACE_DAYS,
  loadEligibility,
  loadMemberAssignments,
  removeEventManager,
} from '@/lib/event-manager'

export const dynamic = 'force-dynamic'

const ROUTE = '/api/admin/members/[id]/event-manager'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Classification → Event Manager on the admin member page. Admin only, in both
// directions: an Event Manager can't see or change anyone's assignments,
// including their own.
//
//   GET     → eligibility, current assignments, and the events that can be assigned
//   POST    { eventSlug, expiresOn? }   grant (default expiry: event end + 30 days)
//   PATCH   { eventSlug, expiresOn }    change the expiry (re-checks clearance)
//   DELETE  { eventSlug } | { all: true }  remove one, or every assignment (unticking the box)

// Reading a member's assignments is portal:read; changing them is event_managers:assign (Staff may).
async function guard(params: Promise<{ id: string }>, cap: Capability = 'event_managers:assign'): Promise<{ id: string } | NextResponse> {
  if (!(await hasCapability(cap, { route: ROUTE }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  return { id }
}

async function clerkIdFor(memberId: string): Promise<string | null> {
  const { data } = await supabaseServer().from('members').select('clerk_user_id').eq('id', memberId).maybeSingle()
  return (data as { clerk_user_id?: string | null } | null)?.clerk_user_id ?? null
}

interface EventOption {
  slug: string
  title: string
  lastDay: string | null
  defaultExpiresOn: string
}

/** Events an admin can assign: live events not more than 30 days past, and campaigns. */
async function eventOptions(now: Date): Promise<EventOption[]> {
  const [events, campaigns] = await Promise.all([getAllEvents().catch(() => []), getAllCampaigns().catch(() => [])])
  const cutoff = new Date(now.getTime() - EVENT_MANAGER_GRACE_DAYS * 86_400_000).toISOString().slice(0, 10)
  const all = [...(events ?? []), ...(campaigns ?? [])] as { title?: string; slug?: { current?: string }; date?: string; endDate?: string }[]
  const seen = new Set<string>()
  const out: EventOption[] = []
  for (const e of all) {
    const slug = e.slug?.current
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    const lastDay = eventLastDay(e)?.slice(0, 10) ?? null
    if (lastDay && lastDay < cutoff) continue
    out.push({ slug, title: e.title ?? slug, lastDay, defaultExpiresOn: defaultExpiryDate(e, now) })
  }
  return out.sort((a, b) => (a.lastDay ?? '9999').localeCompare(b.lastDay ?? '9999') || a.title.localeCompare(b.title))
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(params, 'portal:read')
  if (g instanceof NextResponse) return g
  const db = supabaseServer()
  const now = new Date()
  const [eligibility, clerkUserId, options] = await Promise.all([loadEligibility(db, g.id, now), clerkIdFor(g.id), eventOptions(now)])
  const assignments = clerkUserId ? await loadMemberAssignments(db, clerkUserId, now) : []
  const titleBySlug = new Map(options.map((o) => [o.slug, o.title]))
  return NextResponse.json({
    eligibility,
    assignments: assignments.map((a) => ({ ...a, eventTitle: titleBySlug.get(a.eventSlug) ?? a.eventSlug })),
    events: options,
  })
}

const assignSchema = z.object({
  eventSlug: z.string().trim().min(1, 'Choose an event').max(200),
  expiresOn: z.string().regex(ISO_DATE, 'Expiry date must be YYYY-MM-DD').nullish(),
})

// Platform audit, on top of the member's activity log (lib/event-manager): every
// answer but a 4xx is recorded, on Stellr's chain, against the member.
type Ctx = { params: Promise<{ id: string }> }
type Audited = { args: [Request, Ctx] }
const memberIdFromUrl = (req: Request) => new URL(req.url).pathname.split('/').at(-2) ?? null
const assignAudit = ({ args: [req] }: Audited) => ({
  action: 'role.event_manager.assign' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: { table: 'members', id: memberIdFromUrl(req) },
})
const updateAudit = ({ args: [req] }: Audited) => ({
  action: 'role.event_manager.update' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: { table: 'members', id: memberIdFromUrl(req) },
})
const removeAudit = ({ args: [req] }: Audited) => ({
  action: 'role.event_manager.remove' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: { table: 'members', id: memberIdFromUrl(req) },
})

export const POST = withAudit(assignAudit, async (req: Request, { params }: Ctx) => {
  const g = await guard(params)
  if (g instanceof NextResponse) return g
  const parsed = assignSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const result = await assignEventManager(supabaseServer(), {
    member: { id: g.id },
    eventSlug: parsed.data.eventSlug,
    expiresOn: parsed.data.expiresOn ?? null,
    actor: await actorFromAuth(),
  })
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
  return NextResponse.json(result, { status: result.created ? 201 : 200 })
})

const patchSchema = z.object({
  eventSlug: z.string().trim().min(1).max(200),
  expiresOn: z.string().regex(ISO_DATE, 'Expiry date must be YYYY-MM-DD'),
})

export const PATCH = withAudit(updateAudit, async (req: Request, { params }: Ctx) => {
  const g = await guard(params)
  if (g instanceof NextResponse) return g
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const result = await assignEventManager(supabaseServer(), {
    member: { id: g.id },
    eventSlug: parsed.data.eventSlug,
    expiresOn: parsed.data.expiresOn,
    requireExisting: true,
    actor: await actorFromAuth(),
  })
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
  return NextResponse.json(result)
})

const deleteSchema = z.union([z.object({ eventSlug: z.string().trim().min(1).max(200) }), z.object({ all: z.literal(true) })])

export const DELETE = withAudit(removeAudit, async (req: Request, { params }: Ctx) => {
  const g = await guard(params)
  if (g instanceof NextResponse) return g
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const db = supabaseServer()
  const clerkUserId = await clerkIdFor(g.id)
  if (!clerkUserId) return NextResponse.json({ ok: true, removed: 0 })
  const slugs =
    'all' in parsed.data ? (await loadMemberAssignments(db, clerkUserId)).map((a) => a.eventSlug) : [parsed.data.eventSlug]

  const actor = await actorFromAuth()
  let removed = 0
  for (const eventSlug of slugs) {
    const r = await removeEventManager(db, { clerkUserId, eventSlug, reason: 'admin', actor })
    if (!r.ok) return NextResponse.json({ error: r.error, removed }, { status: r.status })
    if (r.removed) removed++
  }
  return NextResponse.json({ ok: true, removed })
})
