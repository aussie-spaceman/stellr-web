import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { rateLimitGuard } from '@/lib/rate-limit'
import { getCredentialByNumber, recordCredentialEvent, type CredentialEventKind } from '@/lib/credentials'

// POST /api/credentials/[number]/events  { kind }
// Share-click telemetry from the owner's action bar. Unauthenticated on
// purpose (the click has already happened; a sign-in check would just lose
// it), so the kinds are a short allow-list and the route is rate-limited.
const CLIENT_KINDS: CredentialEventKind[] = ['linkedin_add', 'linkedin_share', 'copy_link']

export async function POST(req: Request, { params }: { params: Promise<{ number: string }> }) {
  const limited = rateLimitGuard(req, 'credential-events', { limit: 30, windowMs: 60_000 })
  if (limited) return limited

  const body = (await req.json().catch(() => ({}))) as { kind?: string }
  const kind = CLIENT_KINDS.find((k) => k === body.kind)
  if (!kind) return NextResponse.json({ error: 'Unknown kind' }, { status: 400 })

  const { number } = await params
  const db = supabaseServer()
  const cred = await getCredentialByNumber(db, number)
  if (!cred) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await recordCredentialEvent(db, cred.id, kind)
  return NextResponse.json({ ok: true })
}
