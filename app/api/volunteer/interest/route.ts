import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { getEventBySlug } from '@/lib/events/repo'
import { isVolunteer } from '@/lib/volunteer'
import { logActivity } from '@/lib/activity-log'
import { assertNotImpersonating } from '@/lib/impersonation'
import { loadEventTenantId } from '@/lib/authz/principal'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { recordOnHost } from '@/lib/tenancy/host-record'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

/**
 * POST { eventSlug, interested } — a volunteer raising (or withdrawing) their
 * hand to support an event or campaign. Assignment stays manual: admins see the
 * interest on the event's Volunteers panel and assign from there.
 *
 * Stellr's events only (S5 A10b; decision W7-12, default): another tenant's event, or
 * any event asked about from another tenant's host, answers as one that does not
 * exist. The owner comes from the events mirror, an unmirrored slug counting as
 * Stellr's; a failed read is a retryable 503, never Stellr's. The row carries its
 * tenant, and the change is audited on that tenant's chain.
 */
export const POST = withAudit(
  ({ args: [req] }: { args: [NextRequest] }) => ({ action: 'event_volunteer.interest.set', ...auditSubject(req, 'volunteer_event_interest'), actor: { session: true } }),
  setInterest,
)

async function setInterest(req: NextRequest) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!(await isVolunteer(member.id))) {
    return NextResponse.json({ error: 'Only volunteers can offer event support.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const eventSlug = String(body.eventSlug ?? '').trim()
  const interested = body.interested !== false
  if (!eventSlug) return NextResponse.json({ error: 'eventSlug required' }, { status: 400 })

  // Content comes from Sanity — verify the slug is a real published event/campaign.
  const event = await getEventBySlug(eventSlug).catch(() => null)
  const eventTitle = (event as { title?: string } | null)?.title
  if (!eventTitle) return NextResponse.json({ error: 'Event not found.' }, { status: 404 })

  const db = supabaseServer()
  let owner: string
  try {
    owner = await loadEventTenantId(db, eventSlug)
  } catch {
    console.error('[volunteer/interest] event owner lookup failed')
    return NextResponse.json({ error: 'This is temporarily unavailable. Please try again shortly.' }, { status: 503, headers: { 'Retry-After': '5' } })
  }
  if (owner !== STELLR_TENANT_ID) return NextResponse.json({ error: 'Event not found.' }, { status: 404 })
  if (!(await recordOnHost({ tenant_id: owner }))) return NextResponse.json({ error: 'Event not found.' }, { status: 404 })
  noteAuditSubject(req, { tenantId: owner, eventSlug, detail: { status: interested ? 'interested' : 'withdrawn' } })

  const { error } = await db.from('volunteer_event_interest').upsert(
    {
      tenant_id: owner,
      member_id: member.id,
      event_slug: eventSlug,
      event_title: eventTitle,
      status: interested ? 'interested' : 'withdrawn',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'member_id,event_slug' },
  )
  if (error) {
    console.error('[volunteer/interest] upsert error:', error)
    return NextResponse.json({ error: 'Could not save your interest.' }, { status: 500 })
  }

  await logActivity({
    memberId: member.id,
    category: 'event',
    action: interested ? 'volunteer_interest_offered' : 'volunteer_interest_withdrawn',
    summary: interested
      ? `Offered to volunteer at ${eventTitle}`
      : `Withdrew volunteer offer for ${eventTitle}`,
    metadata: { eventSlug, eventTitle },
    actorType: 'member',
    actorMemberId: member.id,
  }, db)

  return NextResponse.json({ ok: true, interested })
}
