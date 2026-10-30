import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { getEventBySlug } from '@/lib/sanity'
import { getEventRoster } from '@/lib/event-admin'
import { loadOpenCheckIns, pickBannerEvent, todayUtc } from '@/lib/check-in-banner'
import { verifyCheckInCode } from '@/lib/check-in-codes'
import { checkInTime, meaningfulNote, type DeskContact, type DeskDetails, type DeskFlags, type DeskGroup } from '@/lib/check-in-desk'

// Check-in management for an event (admins + assigned event managers).
//   GET  — settings + live list of participants and school groups (polled by the
//          desk every 5 s), and where the check-in banner points (lib/check-in-banner.ts)
//   GET ?details=1 — what staff should know on arrival (agreement, payment,
//          medical and dietary notes) and each group's teacher contact. Heavier,
//          and it rarely changes, so the desk loads it once and every few minutes.
//   POST — { action: 'open' } | { action: 'close' } | { action: 'regenerate' }
//          Opening an in-person event closes any other in-person event's check-in,
//          so the banner has one place to go.
//          { action: 'manual', participantId, at? } | { action: 'undo', participantId }
//          { action: 'group_check_in', participantIds, at? } | { action: 'group_undo', participantIds }
//          { action: 'scan', code, at? } — a participant's code checks them in; a
//          group's code returns the group for the desk to confirm (lib/check-in-codes.ts)
//          { action: 'resources_url', url } — the event's Docs folder ('' clears it)
//
// `at` is when a tap happened on the desk. A tap that waited out a Wi-Fi drop
// keeps its real arrival time (lib/check-in-desk.ts checkInTime).

type Params = { params: Promise<{ slug: string }> }

/** A busload is 30; a whole event is under 150. Anything bigger is a mistake. */
const MAX_GROUP_IDS = 300

export async function GET(req: Request, { params }: Params) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const db = supabaseServer()
  if (new URL(req.url).searchParams.get('details') === '1') {
    try {
      return NextResponse.json(await loadDeskDetails(db, slug))
    } catch (err) {
      console.error('[check-in] details error:', err)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
  }

  const [{ data: settings }, { data: regs }, { data: merchRows }, openCheckIns] = await Promise.all([
    db.from('event_settings').select('check_in_token, check_in_open, resources_url').eq('event_slug', slug).maybeSingle(),
    db
      .from('registrations')
      .select(
        `id, type, school_name, group_name, teacher_first_name, teacher_last_name,
         participants(id, member_id, first_name, last_name, event_role, school_name, t_shirt_size, checked_in_at, check_in_method, merch_collected, event_companies(number, name))`
      )
      .eq('event_slug', slug)
      .neq('status', 'withdrawn'),
    // Event-merch line items (included + add-ons) keyed by member, to show at the desk.
    db
      .from('store_order_items')
      .select('name, qty, participant_member_id, store_orders!inner(event_slug)')
      .eq('store_orders.event_slug', slug)
      .not('participant_member_id', 'is', null),
    // Polled every few seconds: a hiccup here must not blank the desk list.
    loadOpenCheckIns(db).catch(() => []),
  ])

  const merchByMember = new Map<string, { name: string; qty: number }[]>()
  for (const m of (merchRows ?? []) as { name: string; qty: number; participant_member_id: string }[]) {
    const list = merchByMember.get(m.participant_member_id) ?? []
    list.push({ name: m.name, qty: m.qty })
    merchByMember.set(m.participant_member_id, list)
  }

  const participants = (regs ?? []).flatMap((r) =>
    ((r.participants as Record<string, unknown>[]) ?? []).map((p) => ({
      id: p.id,
      registrationId: r.id,
      firstName: p.first_name,
      lastName: p.last_name,
      eventRole: p.event_role,
      schoolName: (p.school_name as string | null) || null,
      shirtSize: p.t_shirt_size ?? null,
      checkedInAt: p.checked_in_at ?? null,
      checkInMethod: p.check_in_method ?? null,
      company: p.event_companies ?? null,
      merch: p.member_id ? merchByMember.get(p.member_id as string) ?? [] : [],
      merchCollected: (p.merch_collected as boolean) ?? false,
    }))
  )

  // School groups. A campaign registration is a group too; individuals aren't.
  const groups: DeskGroup[] = (regs ?? [])
    .filter((r) => r.type !== 'individual')
    .map((r) => ({
      id: r.id as string,
      label: ((r.group_name as string | null) || (r.school_name as string | null) || 'Group').trim(),
      teacher: [r.teacher_first_name, r.teacher_last_name].filter(Boolean).join(' ') || null,
    }))

  return NextResponse.json({
    checkInOpen: settings?.check_in_open ?? false,
    checkInToken: settings?.check_in_token ?? null,
    resourcesUrl: settings?.resources_url ?? null,
    participants,
    groups,
    bannerTarget: pickBannerEvent(openCheckIns, todayUtc())?.slug === slug,
    otherOpen: openCheckIns
      .filter((e) => e.inPerson && e.slug !== slug)
      .map((e) => ({ slug: e.slug, title: e.title ?? e.slug })),
  })
}

/**
 * Flags from the admin roster's own derivation (lib/event-admin), so the desk
 * and the roster never disagree about whether an agreement is signed or a
 * registration paid. Only people with something to flag are listed.
 */
async function loadDeskDetails(db: SupabaseClient, slug: string): Promise<DeskDetails> {
  const event = (await getEventBySlug(slug).catch(() => null)) as { date?: string } | null
  const [roster, { data: groupRegs }] = await Promise.all([
    getEventRoster(slug, event?.date),
    db
      .from('registrations')
      .select('id, teacher_first_name, teacher_last_name, teacher_email, teacher_member_id, participants(member_id, event_role, phone)')
      .eq('event_slug', slug)
      .neq('status', 'withdrawn')
      .neq('type', 'individual'),
  ])

  const flags: Record<string, DeskFlags> = {}
  for (const p of roster.groups.flatMap((g) => g.participants)) {
    const f: DeskFlags = {
      agreement: p.docusign === 'outstanding' ? p.docusign_label : null,
      agreementDetail: p.docusign === 'outstanding' ? p.docusign_detail : null,
      unpaid: p.paid ? null : p.payment_pill === 'invoice_issued' ? 'Invoice unpaid' : 'Payment outstanding',
      medical: meaningfulNote(p.health_conditions),
      dietary: p.dietary_requirements.map((d) => meaningfulNote(d)).filter((d): d is string => !!d),
    }
    if (f.agreement || f.unpaid || f.medical || f.dietary.length) flags[p.id] = f
  }

  // The teacher's phone: their own participant row on the group, else their
  // member profile.
  const regs = (groupRegs ?? []) as {
    id: string
    teacher_first_name: string | null
    teacher_last_name: string | null
    teacher_email: string | null
    teacher_member_id: string | null
    participants: { member_id: string | null; event_role: string | null; phone: string | null }[] | null
  }[]
  const needMember = regs.filter((r) => r.teacher_member_id).map((r) => r.teacher_member_id as string)
  const { data: members } = needMember.length
    ? await db.from('members').select('id, phone').in('id', needMember)
    : { data: [] as { id: string; phone: string | null }[] }
  const memberPhone = new Map((members ?? []).map((m) => [m.id as string, (m.phone as string | null) || null]))

  const contacts: Record<string, DeskContact> = {}
  for (const r of regs) {
    const people = r.participants ?? []
    const own =
      people.find((p) => r.teacher_member_id && p.member_id === r.teacher_member_id) ??
      people.find((p) => p.event_role === 'teacher')
    contacts[r.id] = {
      name: [r.teacher_first_name, r.teacher_last_name].filter(Boolean).join(' ') || null,
      phone: own?.phone?.trim() || (r.teacher_member_id ? memberPhone.get(r.teacher_member_id) ?? null : null),
      email: r.teacher_email || null,
    }
  }
  return { flags, contacts }
}

/** Every id belongs to a participant of this event. */
async function allInEvent(db: SupabaseClient, slug: string, ids: string[]): Promise<boolean> {
  const { data } = await db
    .from('participants')
    .select('id, registrations!inner(event_slug)')
    .in('id', ids)
    .eq('registrations.event_slug', slug)
  return new Set((data ?? []).map((r) => r.id as string)).size === new Set(ids).size
}

function idList(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_GROUP_IDS) return null
  return v.every((id) => typeof id === 'string' && id.length <= 64) ? (v as string[]) : null
}

export async function POST(req: Request, { params }: Params) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await req.json().catch(() => null)
  const action = body?.action
  const db = supabaseServer()

  if (action === 'open' || action === 'close' || action === 'regenerate') {
    const { data: settings } = await db
      .from('event_settings')
      .select('check_in_token')
      .eq('event_slug', slug)
      .maybeSingle()

    let closed: { slug: string; title: string }[] = []
    if (action === 'open') {
      // One banner, one event. A virtual event's check-in is its emailed
      // attendance link, so opening one leaves the in-person event alone.
      const event = (await getEventBySlug(slug)) as { setting?: string } | null
      if (event?.setting !== 'virtual') {
        const open = await loadOpenCheckIns(db).catch(() => null)
        if (!open) return NextResponse.json({ error: 'Database error' }, { status: 500 })
        closed = open.filter((e) => e.inPerson && e.slug !== slug).map((e) => ({ slug: e.slug, title: e.title ?? e.slug }))
        if (closed.length) {
          const { error } = await db
            .from('event_settings')
            .update({ check_in_open: false })
            .in('event_slug', closed.map((e) => e.slug))
          if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })
        }
      }
    }

    const update: Record<string, unknown> = { event_slug: slug }
    if (action === 'open') {
      update.check_in_open = true
      if (!settings?.check_in_token) update.check_in_token = randomBytes(16).toString('hex')
    } else if (action === 'close') {
      update.check_in_open = false
    } else {
      update.check_in_token = randomBytes(16).toString('hex')
    }

    const { error } = await db.from('event_settings').upsert(update, { onConflict: 'event_slug' })
    if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })
    return NextResponse.json({ ok: true, closed })
  }

  if (action === 'resources_url') {
    const raw = typeof body?.url === 'string' ? body.url.trim() : ''
    let url: string | null = null
    if (raw) {
      try {
        const parsed = new URL(raw)
        if (parsed.protocol !== 'https:') throw new Error('not https')
        url = parsed.toString()
      } catch {
        return NextResponse.json({ error: 'Enter a full https:// link' }, { status: 400 })
      }
    }
    const { error } = await db
      .from('event_settings')
      .upsert({ event_slug: slug, resources_url: url }, { onConflict: 'event_slug' })
    if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })
    return NextResponse.json({ ok: true, resourcesUrl: url })
  }

  if (action === 'merch_collected' || action === 'merch_uncollected') {
    const participantId = body?.participantId
    if (typeof participantId !== 'string') {
      return NextResponse.json({ error: 'participantId required' }, { status: 400 })
    }
    if (!(await allInEvent(db, slug, [participantId]))) {
      return NextResponse.json({ error: 'Participant not found for this event' }, { status: 404 })
    }

    const collected = action === 'merch_collected'
    const { error } = await db
      .from('participants')
      .update({ merch_collected: collected, merch_collected_at: collected ? new Date().toISOString() : null })
      .eq('id', participantId)
    if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'manual' || action === 'undo') {
    const participantId = body?.participantId
    if (typeof participantId !== 'string') {
      return NextResponse.json({ error: 'participantId required' }, { status: 400 })
    }
    // Confirm the participant belongs to this event before touching them
    if (!(await allInEvent(db, slug, [participantId]))) {
      return NextResponse.json({ error: 'Participant not found for this event' }, { status: 404 })
    }

    const { error } = await db
      .from('participants')
      .update(
        action === 'manual'
          ? { checked_in_at: checkInTime(body?.at), check_in_method: 'manual' }
          : { checked_in_at: null, check_in_method: null }
      )
      .eq('id', participantId)
    if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // A school group, confirmed at the desk: everyone the desk left ticked. Anyone
  // already in (their own phone, another desk) keeps their original time.
  if (action === 'group_check_in' || action === 'group_undo') {
    const ids = idList(body?.participantIds)
    if (!ids) return NextResponse.json({ error: 'participantIds required' }, { status: 400 })
    if (!(await allInEvent(db, slug, ids))) {
      return NextResponse.json({ error: 'Participant not found for this event' }, { status: 404 })
    }
    const { error } =
      action === 'group_check_in'
        ? await db
            .from('participants')
            .update({ checked_in_at: checkInTime(body?.at), check_in_method: 'manual' })
            .in('id', ids)
            .is('checked_in_at', null)
        : await db.from('participants').update({ checked_in_at: null, check_in_method: null }).in('id', ids)
    if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'scan') {
    const code = verifyCheckInCode(slug, typeof body?.code === 'string' ? body.code : null)
    if (!code) return NextResponse.json({ error: 'That code isn’t for this event.' }, { status: 404 })

    if (code.kind === 'g') {
      const { data: reg } = await db
        .from('registrations')
        .select('id')
        .eq('id', code.id)
        .eq('event_slug', slug)
        .neq('status', 'withdrawn')
        .maybeSingle()
      if (!reg) return NextResponse.json({ error: 'That group isn’t registered for this event.' }, { status: 404 })
      return NextResponse.json({ ok: true, kind: 'group', registrationId: reg.id })
    }

    const { data: p } = await db
      .from('participants')
      .select('id, checked_in_at, registrations!inner(event_slug, status)')
      .eq('id', code.id)
      .eq('registrations.event_slug', slug)
      .neq('registrations.status', 'withdrawn')
      .maybeSingle()
    if (!p) return NextResponse.json({ error: 'That person isn’t registered for this event.' }, { status: 404 })
    if (p.checked_in_at) {
      return NextResponse.json({ ok: true, kind: 'participant', participantId: p.id, alreadyCheckedIn: true, checkedInAt: p.checked_in_at })
    }
    const at = checkInTime(body?.at)
    const { error } = await db
      .from('participants')
      .update({ checked_in_at: at, check_in_method: 'manual' })
      .eq('id', p.id)
      .is('checked_in_at', null)
    if (error) return NextResponse.json({ error: 'Database error' }, { status: 500 })
    return NextResponse.json({ ok: true, kind: 'participant', participantId: p.id, alreadyCheckedIn: false, checkedInAt: at })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
