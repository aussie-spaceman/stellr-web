import { NextResponse } from 'next/server'
import { requireEventRoute } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth } from '@/lib/activity-log'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { cleanTemplateName, insertTemplate, type EventEmailTemplateRow } from '@/lib/event-emails/templates'
import type { EventEmailRow } from '@/lib/event-emails/types'
import { loadEventRecord, loadScopedRows } from '@/lib/tenancy/load-scoped'

// /api/admin/events/[slug]/email-templates — saved event email templates,
// shared across every event of the tenant (admins + this event's managers).
//   GET  → { templates }
//   POST { fromEmailId, name } → save one of this event's emails as a new template

const ROUTE = '/api/admin/events/[slug]/email-templates'

type Ctx = { params: Promise<{ slug: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response

  const { data, error } = await loadScopedRows<EventEmailTemplateRow>(staff.scope, 'event_email_templates', {
    db: supabaseServer(),
    match: { tenant_id: staff.tenantId },
    order: { column: 'name', ascending: true },
    label: ROUTE,
  })
  if (error) return NextResponse.json({ error: 'Could not load templates' }, { status: 500 })
  return NextResponse.json({ templates: data ?? [] })
}

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_email.template.create', ...auditSubject(req, 'event_email_templates') }),
  createTemplate,
)

async function createTemplate(req: Request, { params }: Ctx) {
  const { slug } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response
  noteAuditSubject(req, { userId: staff.userId, tenantId: staff.tenantId, eventSlug: slug })

  const body = await req.json().catch(() => ({}))
  const name = cleanTemplateName(body?.name)
  if (!name) return NextResponse.json({ error: 'Give the template a name' }, { status: 400 })
  if (typeof body?.fromEmailId !== 'string') return NextResponse.json({ error: 'Which email should be saved?' }, { status: 400 })

  const db = supabaseServer()
  const src = await loadEventRecord<EventEmailRow>(staff, 'event_emails', body.fromEmailId, {
    db,
    notFound: () => NextResponse.json({ error: 'Email not found' }, { status: 404 }),
    label: ROUTE,
  })
  if (!src.ok) return src.response

  const actor = await actorFromAuth()
  const template = await insertTemplate(db, staff.tenantId, name, src.row, actor.actorLabel ?? staff.userId)
  if (!template) return NextResponse.json({ error: 'Could not save the template' }, { status: 500 })
  noteAuditSubject(req, { id: template.id })
  return NextResponse.json({ template }, { status: 201 })
}
