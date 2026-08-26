import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { impersonatedMemberId } from '@/lib/impersonation'

// GET /api/members/docusigns — returns DocuSign envelopes for the current member
export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = supabaseServer()

  // Honours an admin view-as session, so the portal shows THIS member's
  // envelopes rather than the admin's own (usually empty) list.
  const viewAsId = await impersonatedMemberId()
  const { data: member } = viewAsId
    ? await db.from('members').select('id').eq('id', viewAsId).maybeSingle()
    : await db
        .from('members')
        .select('id')
        .eq('clerk_user_id', userId)
        .eq('is_active', true)
        .maybeSingle()

  if (!member) return NextResponse.json({ envelopes: [] })

  const { data: envelopes } = await db
    .from('docusign_envelopes')
    .select('id, envelope_id, status, envelope_type, signer_name, signer_email, minor_name, event_title, event_slug, sent_at, completed_at, reminder_sent_at, reused_from, signers_total, signers_completed')
    .eq('member_id', member.id)
    .order('sent_at', { ascending: false })

  return NextResponse.json({ envelopes: envelopes ?? [] })
}
