import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

// GET /api/members/exists?email= — does this email already have a usable Stellr
// account (a member row linked to a Clerk login)? Used by the group-join form to
// prompt an invited person who already has an account to sign in and connect it,
// rather than silently provisioning a second passwordless account.
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')?.trim().toLowerCase()
  if (!email) return NextResponse.json({ hasAccount: false })

  const db = supabaseServer()
  const { data } = await db
    .from('members')
    .select('id, clerk_user_id')
    .eq('email', email)
    .eq('is_active', true)
    .maybeSingle()

  return NextResponse.json({ hasAccount: !!data?.clerk_user_id })
}
