import { NextResponse } from 'next/server'
import { requireEventRoute } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth } from '@/lib/activity-log'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { cleanTemplateName, getTemplate, templateFieldsFromEmail } from '@/lib/event-emails/templates'
import type { EventEmailRow } from '@/lib/event-emails/types'
import { loadEventRecord, scopedRowWrite } from '@/lib/tenancy/load-scoped'

// /api/admin/events/[slug]/email-templates/[id] — one saved template. The event
// in the URL is where the author is working; the template is the tenant's.
//   PATCH { fromEmailId?, name? } → overwrite it from one of this event's emails, and/or rename it
//   DELETE → remove it (emails already made from it are unaffected)

const ROUTE = '/api/admin/events/[slug]/email-templates/[id]'

type Ctx = { params: Promise<{ slug: string; id: string }> }

const notFound = () => NextResponse.json({ error: 'Template not found' }, { status: 404 })

export const PATCH = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_email.template.update', ...auditSubject(req, 'event_email_templates') }),
  updateTemplate,
)

async function updateTemplate(req: Request, { params }: Ctx) {
  const { slug, id } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response
  noteAuditSubject(req, { userId: staff.userId, tenantId: staff.tenantId, eventSlug: slug, id })

  const db = supabaseServer()
  if (!(await getTemplate(db, staff.tenantId, id))) return notFound()

  const body = await req.json().catch(() => ({}))
  const update: Record<string, unknown> = {}
  if (body?.name !== undefined) {
    const name = cleanTemplateName(body.name)
    if (!name) return NextResponse.json({ error: 'Give the template a name' }, { status: 400 })
    update.name = name
  }
  if (typeof body?.fromEmailId === 'string') {
    const src = await loadEventRecord<EventEmailRow>(staff, 'event_emails', body.fromEmailId, {
      db,
      notFound: () => NextResponse.json({ error: 'Email not found' }, { status: 404 }),
      label: ROUTE,
    })
    if (!src.ok) return src.response
    Object.assign(update, templateFieldsFromEmail(src.row))
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })

  const actor = await actorFromAuth()
  update.updated_by = actor.actorLabel ?? staff.userId
  const { data, error } = await scopedRowWrite(staff.scope, 'event_email_templates', id, { db })
    .update(update)
    .select('*')
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not save the template' }, { status: 500 })
  if (!data) return notFound()
  return NextResponse.json({ template: data })
}

export const DELETE = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_email.template.delete', ...auditSubject(req, 'event_email_templates') }),
  deleteTemplate,
)

async function deleteTemplate(req: Request, { params }: Ctx) {
  const { slug, id } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response
  noteAuditSubject(req, { userId: staff.userId, tenantId: staff.tenantId, eventSlug: slug, id })

  const db = supabaseServer()
  if (!(await getTemplate(db, staff.tenantId, id))) return notFound()
  const { error } = await scopedRowWrite(staff.scope, 'event_email_templates', id, { db }).delete()
  if (error) return NextResponse.json({ error: 'Could not delete the template' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
