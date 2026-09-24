import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { getSignedInMember } from '@/lib/community'
import { sendAccountInvite } from '@/lib/member-invite'

// POST /api/admin/members/[id]/invite — (re)send the "complete your account"
// email to a member whose profile is still missing DOB or gender.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const actor = await getSignedInMember()
  const result = await sendAccountInvite(supabaseServer(), id, { actorMemberId: actor?.id ?? null })

  if (result.sent) return NextResponse.json({ ok: true })
  switch (result.reason) {
    case 'not_found':
      return NextResponse.json({ error: 'Member not found, or has no email' }, { status: 404 })
    case 'complete':
      return NextResponse.json({ error: 'This member has already completed their profile' }, { status: 409 })
    case 'cooldown':
      return NextResponse.json({ error: 'An invite went out in the last 10 minutes — give it a moment' }, { status: 429 })
    default:
      return NextResponse.json({ error: 'The email could not be sent' }, { status: 502 })
  }
}
