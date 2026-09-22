import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { CREDENTIAL_COLUMNS, credentialState, type CredentialRow } from '@/lib/credentials'
import { recipientForCredential, sendCredentialIssuedEmail } from '@/lib/credentials-notify'

// POST /api/admin/credentials/[id]/resend — re-send the "credential issued"
// email to the holder (guardian for a minor). Same scoping as revoke.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const { data } = await db.from('credentials').select(CREDENTIAL_COLUMNS).eq('id', id).maybeSingle()
  const cred = data as CredentialRow | null
  if (!cred) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const access = await requireEventAccess(cred.event_slug ?? undefined)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  if (!cred.event_slug && !access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (credentialState(cred) !== 'valid') return NextResponse.json({ error: 'Only a valid credential can be re-sent' }, { status: 400 })

  const to = await recipientForCredential(db, cred)
  if (!to) return NextResponse.json({ error: 'No holder on record to send to' }, { status: 400 })

  const sent = await sendCredentialIssuedEmail(db, cred, to)
  if (!sent) return NextResponse.json({ error: 'No email address on record' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
