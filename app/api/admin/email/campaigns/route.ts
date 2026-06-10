import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { getCurrentMember } from '@/lib/community'

const audienceSchema = z.object({
  activeOnly: z.boolean().optional(),
  excludeMinors: z.boolean().optional(),
  tierIds: z.array(z.string().uuid()).nullable().optional(),
})

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    templateId: z.string().uuid(),
    triggerType: z.enum(['scheduled', 'event']),
    scheduledAt: z.string().datetime().optional(),
    eventKey: z.string().trim().min(1).max(100).optional(),
    audience: audienceSchema.optional(),
  })
  .refine((d) => d.triggerType !== 'scheduled' || !!d.scheduledAt, { message: 'scheduledAt required for scheduled campaigns', path: ['scheduledAt'] })
  .refine((d) => d.triggerType !== 'event' || !!d.eventKey, { message: 'eventKey required for event campaigns', path: ['eventKey'] })

// GET /api/admin/email/campaigns — list with template name + send tallies.
export async function GET() {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = supabaseServer()
  const { data: campaigns } = await db
    .from('email_campaigns')
    .select('id, name, trigger_type, scheduled_at, event_key, status, audience, sent_at, created_at, email_templates(name)')
    .neq('status', 'archived')
    .order('created_at', { ascending: false })

  // Attach sent counts in one grouped pass.
  const ids = (campaigns ?? []).map((c) => c.id)
  const counts = new Map<string, number>()
  if (ids.length) {
    const { data: sends } = await db.from('email_campaign_sends').select('campaign_id').in('campaign_id', ids).eq('status', 'sent')
    for (const s of sends ?? []) counts.set(s.campaign_id, (counts.get(s.campaign_id) ?? 0) + 1)
  }

  const out = (campaigns ?? []).map((c) => {
    const tpl = Array.isArray(c.email_templates) ? c.email_templates[0] : c.email_templates
    return { ...c, templateName: (tpl as { name: string } | null)?.name ?? '—', sentCount: counts.get(c.id) ?? 0 }
  })

  return NextResponse.json({ campaigns: out })
}

// POST /api/admin/email/campaigns — create a campaign in draft.
export async function POST(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }
  const { name, templateId, triggerType, scheduledAt, eventKey, audience } = parsed.data

  const db = supabaseServer()
  const admin = await getCurrentMember()
  const { data, error } = await db
    .from('email_campaigns')
    .insert({
      name,
      template_id: templateId,
      trigger_type: triggerType,
      scheduled_at: scheduledAt ?? null,
      event_key: triggerType === 'event' ? eventKey : null,
      audience: audience ?? {},
      status: 'draft',
      created_by: admin?.id ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[email-campaigns] insert error:', error.message)
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 })
  }
  return NextResponse.json({ id: data.id })
}
