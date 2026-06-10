import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'

const audienceSchema = z.object({
  activeOnly: z.boolean().optional(),
  excludeMinors: z.boolean().optional(),
  tierIds: z.array(z.string().uuid()).nullable().optional(),
})

// `action` drives status transitions; field edits are only allowed while a
// campaign hasn't sent yet (draft/scheduled/paused).
const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  audience: audienceSchema.optional(),
  action: z.enum(['activate', 'pause', 'archive']).optional(),
})

const EDITABLE = new Set(['draft', 'scheduled', 'paused'])

// PATCH /api/admin/email/campaigns/[id] — edit fields and/or transition status.
//   activate: draft|paused → scheduled (goes live; cron/event engine picks it up)
//   pause:    scheduled     → paused
//   archive:  any           → archived (hidden, template freed)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { name, scheduledAt, audience, action } = parsed.data

  const db = supabaseServer()
  const { data: campaign } = await db
    .from('email_campaigns')
    .select('id, status, trigger_type, scheduled_at')
    .eq('id', id)
    .maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (name !== undefined || scheduledAt !== undefined || audience !== undefined) {
    if (!EDITABLE.has(campaign.status)) {
      return NextResponse.json({ error: `Cannot edit a campaign that is "${campaign.status}".` }, { status: 409 })
    }
    if (name !== undefined) update.name = name
    if (scheduledAt !== undefined) update.scheduled_at = scheduledAt
    if (audience !== undefined) update.audience = audience
  }

  if (action === 'activate') {
    if (!['draft', 'paused'].includes(campaign.status)) {
      return NextResponse.json({ error: `Cannot activate from "${campaign.status}".` }, { status: 409 })
    }
    const when = (scheduledAt ?? campaign.scheduled_at) as string | null
    if (campaign.trigger_type === 'scheduled' && !when) {
      return NextResponse.json({ error: 'Set a send time before activating.' }, { status: 400 })
    }
    update.status = 'scheduled'
  } else if (action === 'pause') {
    if (campaign.status !== 'scheduled') return NextResponse.json({ error: 'Only scheduled campaigns can be paused.' }, { status: 409 })
    update.status = 'paused'
  } else if (action === 'archive') {
    update.status = 'archived'
  }

  const { error } = await db.from('email_campaigns').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: 'Failed to update campaign' }, { status: 500 })
  return NextResponse.json({ ok: true, status: update.status ?? campaign.status })
}

// DELETE /api/admin/email/campaigns/[id] — archive (soft). Keeps the send ledger.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  const db = supabaseServer()
  const { error } = await db.from('email_campaigns').update({ status: 'archived' }).eq('id', id)
  if (error) return NextResponse.json({ error: 'Failed to archive' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
