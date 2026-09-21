import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { assertNotImpersonating } from '@/lib/impersonation'
import { getCredentialByNumber, shareConsentFor, setVisibility } from '@/lib/credentials'

// POST /api/credentials/[number]/visibility  { visibility: 'public' | 'private' }
// Owner-only. Making it public is gated by canShare() inside setVisibility —
// age/consent is resolved here, never trusted from the client.
export async function POST(req: Request, { params }: { params: Promise<{ number: string }> }) {
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { visibility?: string }
  const visibility = body.visibility === 'public' ? 'public' : body.visibility === 'private' ? 'private' : null
  if (!visibility) return NextResponse.json({ error: 'visibility must be public or private' }, { status: 400 })

  const { number } = await params
  const db = supabaseServer()
  const cred = await getCredentialByNumber(db, number)
  if (!cred || cred.member_id !== member.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const consent = await shareConsentFor(db, cred)
  const result = await setVisibility(db, cred, visibility, consent)
  if (!result.ok) {
    return NextResponse.json({ error: `This credential cannot be made public (${result.reason.replace(/_/g, ' ')}).` }, { status: 403 })
  }
  return NextResponse.json({ ok: true, visibility: result.row.visibility })
}
