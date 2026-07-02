import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { getCurrentMember } from '@/lib/community'
import { sendEmail, campaignRegistrationEmail } from '@/lib/email'
import { seasonLabel, deadlineInfo } from '@/lib/campaigns'

const APP_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

/**
 * Register a group for a Campaign. Campaigns are free (no payment step) and
 * included with membership, so this only records the registration and fires a
 * confirmation email. Reachable from all three entry points (member signup,
 * dashboard, /events) — each assumes an existing, signed-in member.
 */
export async function POST(req: NextRequest) {
  try {
    const member = await getCurrentMember()
    if (!member) {
      return NextResponse.json({ error: 'You need to be signed in to register.' }, { status: 401 })
    }

    const body = await req.json()
    const campaignSlug = String(body.campaignSlug ?? '').trim()
    const groupName = String(body.groupName ?? '').trim()
    const role = String(body.role ?? '').trim() || 'Educator'
    const studentCount = Number.isFinite(Number(body.studentCount))
      ? Math.max(0, Math.trunc(Number(body.studentCount)))
      : null

    if (!campaignSlug) return NextResponse.json({ error: 'Missing campaign.' }, { status: 400 })
    if (!groupName) return NextResponse.json({ error: 'A group or class name is required.' }, { status: 400 })

    // Content comes from Sanity — verify the slug is a real, published campaign.
    const campaign = await getEventBySlug(campaignSlug).catch(() => null)
    if (!campaign || campaign.activityType !== 'campaign') {
      return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 })
    }

    const db = supabaseServer()

    // Idempotent per (campaign, member): re-registering updates the existing row
    // rather than creating a duplicate (the unique index enforces this too).
    const { data: existing } = await db
      .from('registrations')
      .select('id')
      .eq('type', 'campaign')
      .eq('event_slug', campaignSlug)
      .eq('teacher_member_id', member.id)
      .maybeSingle()

    const rowFields = {
      event_slug: campaignSlug,
      event_title: campaign.title as string,
      type: 'campaign',
      status: 'confirmed',
      teacher_first_name: member.first_name,
      teacher_last_name: member.last_name,
      teacher_email: member.email,
      teacher_member_id: member.id,
      group_name: groupName,
      contact_role: role,
      student_count: studentCount,
    }

    let registrationId: string
    if (existing) {
      registrationId = existing.id
      await db.from('registrations').update(rowFields).eq('id', existing.id)
    } else {
      const { data: inserted, error } = await db
        .from('registrations')
        .insert(rowFields)
        .select('id')
        .single()
      if (error || !inserted) {
        console.error('[campaigns/register] insert failed:', error)
        return NextResponse.json({ error: 'Could not complete registration.' }, { status: 500 })
      }
      registrationId = inserted.id
    }

    // Confirmation email (best-effort — never fail the registration on send error).
    if (member.email) {
      try {
        const content = campaignRegistrationEmail({
          contactFirstName: member.first_name ?? 'there',
          groupName,
          campaignTitle: campaign.title as string,
          seasonLabel: seasonLabel(campaign.season, campaign.campaignYear),
          deadlineLabel: deadlineInfo(campaign.deadline)?.label ?? 'the deadline',
          workspaceUrl: `${APP_URL}/campaigns/${campaignSlug}`,
        })
        await sendEmail({ to: member.email, ...content })
      } catch (err) {
        console.error('[campaigns/register] email send failed:', err)
      }
    }

    return NextResponse.json({ ok: true, registrationId })
  } catch (err) {
    console.error('[campaigns/register] error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
