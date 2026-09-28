import { NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth } from '@/lib/activity-log'
import { createFromDefault, getEventEmail } from '@/lib/event-emails/store'

// /api/admin/events/[slug]/emails — the "Email Reminders" tab (admins + assigned
// event managers).
//   GET  → { emails, history }
//   POST { templateKey } → a new draft from one of the starter emails (or blank)
//   POST { duplicateOf } → a new draft copied from another email (attachments not copied)

type Ctx = { params: Promise<{ slug: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const db = supabaseServer()
  const [{ data: emails }, { data: history }] = await Promise.all([
    db.from('event_emails').select('*').eq('event_slug', slug).order('created_at', { ascending: true }),
    db
      .from('event_email_sends')
      .select('*')
      .eq('event_slug', slug)
      .order('started_at', { ascending: false })
      .limit(100),
  ])
  return NextResponse.json({ emails: emails ?? [], history: history ?? [] })
}

export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await req.json().catch(() => ({}))
  const actor = await actorFromAuth()
  const createdBy = actor.actorLabel ?? access.userId
  const db = supabaseServer()

  // Duplicate: copy a (typically sent) email back to a draft. Attachments are
  // not copied — removing one from the copy would delete the stored file the
  // original's history still names — so the author re-attaches what's current.
  if (typeof body?.duplicateOf === 'string') {
    const src = await getEventEmail(db, slug, body.duplicateOf)
    if (!src) return NextResponse.json({ error: 'Email not found' }, { status: 404 })
    const { data, error } = await db
      .from('event_emails')
      .insert({
        event_slug: slug,
        name: `${src.name} (copy)`,
        template_key: src.template_key,
        audiences: src.audiences,
        subject: src.subject,
        body_json: src.body_json,
        attachments: [],
        resend_docusign: src.resend_docusign,
        schedule_days_before: src.schedule_days_before,
        status: 'draft',
        created_by: createdBy,
      })
      .select('*')
      .single()
    if (error || !data) return NextResponse.json({ error: 'Could not duplicate the email' }, { status: 500 })
    return NextResponse.json({ email: data }, { status: 201 })
  }

  const templateKey = typeof body?.templateKey === 'string' ? body.templateKey : 'blank'
  const email = await createFromDefault(db, slug, templateKey, createdBy)
  if (!email) return NextResponse.json({ error: 'Could not create the email' }, { status: 500 })
  return NextResponse.json({ email }, { status: 201 })
}
