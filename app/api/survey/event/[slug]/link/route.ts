import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { rateLimitGuard } from '@/lib/rate-limit'
import { distributionForEvent, loadDefinition, statusNow } from '@/lib/survey/distributions'
import { sendLinkEmail, type InvitationRow } from '@/lib/survey/send'

// POST /api/survey/event/[slug]/link { email } — the QR page's "email me my
// link". Sends only to the address the invitation was issued to, and answers
// the same whether or not one exists, so it can't be used to probe who attended.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const limited = rateLimitGuard(req, 'survey-link', { limit: 5, windowMs: 10 * 60_000 })
  if (limited) return limited
  const parsed = z.object({ email: z.string().email().max(254) }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  const { slug } = await params
  const db = supabaseServer()
  const d = await distributionForEvent(db, slug)
  if (d && statusNow(d) === 'open') {
    const { data } = await db
      .from('survey_invitations')
      .select('*')
      .eq('distribution_id', d.id)
      .ilike('email', parsed.data.email.trim())
      .neq('status', 'submitted')
      .limit(5)
    if (data?.length) {
      const { def } = await loadDefinition(db, d.definition_id)
      // A guardian address can hold several students' invitations: send each.
      for (const inv of data as InvitationRow[]) await sendLinkEmail(db, inv, d, def)
    }
  }
  return NextResponse.json({ ok: true })
}
