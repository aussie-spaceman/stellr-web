import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

// GET /api/members/my-groups — registrations owned by the current member
export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id, email, event_role')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!member) return NextResponse.json({ groups: [] })

  // Fetch registrations where this member is the primary registrant
  const { data: registrations } = await db
    .from('registrations')
    .select(`
      id, event_slug, event_title, status, created_at,
      registrant_role, teacher_poc_first_name, teacher_poc_last_name, teacher_poc_email,
      member_pays_individually, details_method, invoice_requested,
      participants(id, first_name, last_name, email, event_role, individual_payment_status, join_completed_at)
    `)
    .eq('teacher_email', member.email)
    .eq('type', 'group')
    .order('created_at', { ascending: false })

  if (!registrations) return NextResponse.json({ groups: [] })

  // Attach join tokens for email_link registrations
  const emailLinkRegIds = registrations
    .filter(r => r.details_method === 'email_link')
    .map(r => r.id)

  let joinTokenMap: Record<string, string> = {}
  if (emailLinkRegIds.length > 0) {
    const { data: tokens } = await db
      .from('group_join_tokens')
      .select('registration_id, token, expires_at')
      .in('registration_id', emailLinkRegIds)

    if (tokens) {
      for (const t of tokens) {
        if (new Date(t.expires_at) > new Date()) {
          joinTokenMap[t.registration_id] = `${SITE_URL}/register/${
            registrations.find(r => r.id === t.registration_id)?.event_slug ?? ''
          }/join/${t.token}`
        }
      }
    }
  }

  const groups = registrations.map(reg => ({
    ...reg,
    joinUrl: joinTokenMap[reg.id] ?? null,
  }))

  return NextResponse.json({ groups })
}
