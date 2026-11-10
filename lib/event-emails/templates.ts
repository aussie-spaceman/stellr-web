// Saved event email templates: an email written for one event, saved from its
// Email Reminders tab and offered as a starting point on every event of the
// same tenant. Admins and event managers save, update and delete them.
//
// What is kept is the reusable part of the email. Attachments are not: they
// are stored per event, and a template must never name another event's files.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AudienceKey, EventEmailRow } from './types'

export interface EventEmailTemplateRow {
  id: string
  tenant_id: string
  name: string
  audiences: AudienceKey[]
  subject: string
  body_json: unknown
  resend_docusign: boolean
  schedule_days_before: number | null
  source_event_slug: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

/** The columns a template copies from an event email. */
export function templateFieldsFromEmail(email: EventEmailRow) {
  return {
    audiences: email.audiences,
    subject: email.subject,
    body_json: email.body_json,
    resend_docusign: email.resend_docusign,
    schedule_days_before: email.schedule_days_before,
    source_event_slug: email.event_slug,
  }
}

export function cleanTemplateName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const name = v.replace(/\s+/g, ' ').trim().slice(0, 200)
  return name || null
}

/** One template, only if it belongs to this tenant. */
export async function getTemplate(db: SupabaseClient, tenantId: string, id: string): Promise<EventEmailTemplateRow | null> {
  const { data } = await db.from('event_email_templates').select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  return (data as EventEmailTemplateRow | null) ?? null
}

/** Saves one of an event's emails as a new template of `tenantId`. */
export async function insertTemplate(
  db: SupabaseClient,
  tenantId: string,
  name: string,
  email: EventEmailRow,
  by: string | null,
): Promise<EventEmailTemplateRow | null> {
  const { data, error } = await db
    .from('event_email_templates')
    .insert({ tenant_id: tenantId, name, ...templateFieldsFromEmail(email), created_by: by, updated_by: by })
    .select('*')
    .single()
  if (error) console.error('[event-email-templates] create failed:', error)
  return (data as EventEmailTemplateRow | null) ?? null
}

/** A new draft on `slug` from a saved template. Attachments start empty. */
export async function createFromSavedTemplate(
  db: SupabaseClient,
  slug: string,
  template: EventEmailTemplateRow,
  createdBy: string | null,
): Promise<EventEmailRow | null> {
  const { data, error } = await db
    .from('event_emails')
    .insert({
      event_slug: slug,
      name: template.name,
      template_key: 'saved',
      audiences: template.audiences,
      subject: template.subject,
      body_json: template.body_json,
      attachments: [],
      resend_docusign: template.resend_docusign,
      schedule_days_before: template.schedule_days_before,
      status: 'draft',
      created_by: createdBy,
    })
    .select('*')
    .single()
  if (error) console.error('[event-emails] create from saved template failed:', error)
  return (data as EventEmailRow | null) ?? null
}
