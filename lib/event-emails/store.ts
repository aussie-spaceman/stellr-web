// Row access for event emails, shared by the API routes. Every lookup is
// scoped to the event slug in the URL, so an event manager for one event can
// never read or send another event's email by guessing its id.

import type { SupabaseClient } from '@supabase/supabase-js'
import { BLANK_DEFAULT, EVENT_EMAIL_DEFAULTS, markdownToTiptap } from './defaults'
import type { EventEmailRow } from './types'

export async function getEventEmail(db: SupabaseClient, slug: string, id: string): Promise<EventEmailRow | null> {
  const { data } = await db.from('event_emails').select('*').eq('id', id).eq('event_slug', slug).maybeSingle()
  return (data as EventEmailRow | null) ?? null
}

/** Statuses an author may still change. */
export const EDITABLE: EventEmailRow['status'][] = ['draft', 'scheduled', 'cancelled']

export async function createFromDefault(
  db: SupabaseClient,
  slug: string,
  templateKey: string,
  createdBy: string | null,
): Promise<EventEmailRow | null> {
  const d = EVENT_EMAIL_DEFAULTS.find((t) => t.key === templateKey) ?? BLANK_DEFAULT
  const { data, error } = await db
    .from('event_emails')
    .insert({
      event_slug: slug,
      name: d.name,
      template_key: d.key,
      audiences: d.audiences,
      subject: d.subject,
      body_json: markdownToTiptap(d.body),
      resend_docusign: d.resendDocusign,
      schedule_days_before: d.scheduleDaysBefore,
      status: 'draft',
      created_by: createdBy,
    })
    .select('*')
    .single()
  if (error) console.error('[event-emails] create failed:', error)
  return (data as EventEmailRow | null) ?? null
}
