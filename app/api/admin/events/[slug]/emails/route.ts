import { NextResponse } from 'next/server'
import { requireEventRoute } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth } from '@/lib/activity-log'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { insertEventEmailCopy } from '@/lib/events/admin-records'
import { createFromDefault } from '@/lib/event-emails/store'
import { createFromSavedTemplate, getTemplate } from '@/lib/event-emails/templates'
import type { EventEmailRow } from '@/lib/event-emails/types'
import { loadEventRecord, loadScopedRows } from '@/lib/tenancy/load-scoped'

// /api/admin/events/[slug]/emails — the "Email Reminders" tab (admins + assigned
// event managers).
//   GET  → { emails, history }
//   POST { templateKey } → a new draft from one of the starter emails (or blank)
//   POST { savedTemplateId } → a new draft from a saved template (the tenant's, any event)
//   POST { duplicateOf } → a new draft copied from another email (attachments not copied)

const ROUTE = '/api/admin/events/[slug]/emails'

type Ctx = { params: Promise<{ slug: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response

  const db = supabaseServer()
  const [{ data: emails }, { data: history }] = await Promise.all([
    loadScopedRows(staff.scope, 'event_emails', { db, match: { event_slug: slug }, order: { column: 'created_at', ascending: true }, label: ROUTE }),
    loadScopedRows(staff.scope, 'event_email_sends', { db, match: { event_slug: slug }, order: { column: 'started_at', ascending: false }, limit: 100, label: ROUTE }),
  ])
  return NextResponse.json({ emails: emails ?? [], history: history ?? [] })
}

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_email.record.create', ...auditSubject(req, 'event_emails') }),
  createEmail,
)

async function createEmail(req: Request, { params }: Ctx) {
  const { slug } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response
  noteAuditSubject(req, { userId: staff.userId, tenantId: staff.tenantId, eventSlug: slug })

  const body = await req.json().catch(() => ({}))
  const actor = await actorFromAuth()
  const createdBy = actor.actorLabel ?? staff.userId
  const db = supabaseServer()

  // Duplicate: copy a (typically sent) email back to a draft. Attachments are
  // not copied — removing one from the copy would delete the stored file the
  // original's history still names — so the author re-attaches what's current.
  if (typeof body?.duplicateOf === 'string') {
    const src = await loadEventRecord<EventEmailRow>(staff, 'event_emails', body.duplicateOf, {
      db,
      notFound: () => NextResponse.json({ error: 'Email not found' }, { status: 404 }),
      label: ROUTE,
    })
    if (!src.ok) return src.response
    const { data, error } = await insertEventEmailCopy(db, slug, src.row, createdBy)
    if (error || !data) return NextResponse.json({ error: 'Could not duplicate the email' }, { status: 500 })
    noteAuditSubject(req, { id: data.id as string })
    return NextResponse.json({ email: data }, { status: 201 })
  }

  // A saved template: the tenant's, shared across its events.
  if (typeof body?.savedTemplateId === 'string') {
    const template = await getTemplate(db, staff.tenantId, body.savedTemplateId)
    if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    const email = await createFromSavedTemplate(db, slug, template, createdBy)
    if (!email) return NextResponse.json({ error: 'Could not create the email' }, { status: 500 })
    noteAuditSubject(req, { id: email.id })
    return NextResponse.json({ email }, { status: 201 })
  }

  const templateKey = typeof body?.templateKey === 'string' ? body.templateKey : 'blank'
  const email = await createFromDefault(db, slug, templateKey, createdBy)
  if (!email) return NextResponse.json({ error: 'Could not create the email' }, { status: 500 })
  noteAuditSubject(req, { id: email.id })
  return NextResponse.json({ email }, { status: 201 })
}
