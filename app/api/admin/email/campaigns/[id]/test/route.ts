import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { sendEmail, MARKETING_FROM } from '@/lib/email'
import { renderCampaignEmail } from '@/lib/email-render'
import { MERGE_FIELDS } from '@/lib/email-vars'
import { loadTemplate, appUrl } from '@/lib/email-campaigns'

const schema = z.object({ email: z.string().email() })

// POST /api/admin/email/campaigns/[id]/test — send a one-off preview to `email`
// using example merge values. Does NOT write the send ledger or touch members.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })

  const db = supabaseServer()
  const { data: campaign } = await db.from('email_campaigns').select('template_id').eq('id', id).maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const template = await loadTemplate(campaign.template_id)
  if (!template) return NextResponse.json({ error: 'Template not found or archived' }, { status: 404 })

  const exampleVars: Record<string, string> = Object.fromEntries(MERGE_FIELDS.map((f) => [f.token, f.example]))
  const unsub = `${appUrl()}/api/email/unsubscribe?token=example-preview-token`
  exampleVars.unsubscribeUrl = unsub

  try {
    const { subject, html, text } = renderCampaignEmail(template, exampleVars, unsub)
    await sendEmail({ to: parsed.data.email, from: MARKETING_FROM, subject: `[TEST] ${subject}`, html, text })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to send test' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
