// Shared vocabulary for the event "Email Reminders" tab. Pure — safe to import
// from client components.

export const AUDIENCES = [
  { key: 'participants',         label: 'All participants',             hint: 'Everyone on the roster with an email' },
  { key: 'guardians',            label: 'Parents / legal guardians',    hint: 'The nominated parent or guardian of each minor' },
  { key: 'mentors',              label: 'Mentors',                      hint: 'Assigned volunteers and this event’s event managers' },
  { key: 'docusign_outstanding', label: 'Outstanding DocuSigns',        hint: 'The participant and their parent/guardian' },
  { key: 'payment_outstanding',  label: 'Outstanding payments',         hint: 'The participant, their parent/guardian, and the teacher for group registrations' },
] as const

export type AudienceKey = (typeof AUDIENCES)[number]['key']

export function isAudienceKey(v: unknown): v is AudienceKey {
  return typeof v === 'string' && AUDIENCES.some((a) => a.key === v)
}

export type RecipientRole = 'participant' | 'guardian' | 'teacher' | 'volunteer' | 'event_manager'

export const ROLE_LABEL: Record<RecipientRole, string> = {
  participant:   'Participant',
  guardian:      'Parent/guardian',
  teacher:       'Teacher',
  volunteer:     'Volunteer',
  event_manager: 'Event manager',
}

export type EventEmailStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'skipped'

export interface EventEmailAttachment {
  path: string
  filename: string
  size: number
  contentType: string
}

export interface EventEmailRow {
  id: string
  event_slug: string
  name: string
  template_key: string | null
  audiences: AudienceKey[]
  subject: string
  body_json: unknown
  attachments: EventEmailAttachment[]
  resend_docusign: boolean
  schedule_days_before: number | null
  status: EventEmailStatus
  created_by: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

export interface EventEmailSendRow {
  id: string
  event_email_id: string | null
  email_name: string
  subject: string
  audiences: AudienceKey[]
  trigger: 'manual' | 'schedule' | 'test'
  triggered_by: string | null
  recipient_count: number
  sent_count: number
  failed_count: number
  docusign_resent: number
  recipients: { email: string; name: string; roles: RecipientRole[]; status: 'sent' | 'failed'; error?: string }[]
  started_at: string
  finished_at: string | null
}

/** Merge fields an author can use, in picker order. */
export const EVENT_MERGE_FIELDS = [
  { token: 'first_name',           example: 'Lily',                          label: 'Recipient first name' },
  { token: 'who_is_registered',    example: 'Luke and Lily are',             label: '“you are” / “Lily is” — who is registered' },
  { token: 'participant_names',    example: 'Luke and Lily',                 label: 'Registered participant(s)' },
  { token: 'event_name',           example: '2027 Colorado Space Design Challenge', label: 'Event name' },
  { token: 'event_venue',          example: 'STEM School Highlands Ranch',   label: 'Venue' },
  { token: 'event_city',           example: 'Highlands Ranch, CO',           label: 'City, state' },
  { token: 'event_date',           example: 'Saturday, October 3',           label: 'Event date' },
  { token: 'event_start_time',     example: '8:30 AM',                       label: 'Start time' },
  { token: 'event_end_time',       example: '5:30 PM',                       label: 'Finish time' },
  { token: 'days_to_go',           example: '7',                             label: 'Days until the event' },
  { token: 'payment_instructions', example: 'You can pay securely here: …',  label: 'Pay link or invoice note (payment emails)' },
  { token: 'portal_link',          example: 'https://app.stellreducation.org/sign-in', label: 'Stellr portal sign-in' },
  { token: 'event_link',           example: 'https://www.stellreducation.org/events/…', label: 'Public event page' },
] as const

export type EventMergeToken = (typeof EVENT_MERGE_FIELDS)[number]['token']

/** Longest a single send may run: Resend allows ~2 requests/second and a route has 60s. */
export const MAX_RECIPIENTS_PER_SEND = 75
