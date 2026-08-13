import type { JSONContent } from '@tiptap/react'

export interface EmailTemplate {
  id: string
  key: string
  name: string
  subject: string
  body_json: JSONContent | null
  updated_at: string
}

export interface AudienceFilter {
  activeOnly?: boolean
  excludeMinors?: boolean
  tierIds?: string[] | null
}

export interface EmailCampaign {
  id: string
  name: string
  trigger_type: 'scheduled' | 'event'
  scheduled_at: string | null
  event_key: string | null
  /** Event campaigns only: days after the event before sending. 0 = immediate. */
  delay_days: number
  /** Event campaigns only: label grouping the steps of one drip sequence. */
  sequence_key: string | null
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'archived'
  audience: AudienceFilter
  sent_at: string | null
  created_at: string
  templateName: string
}

export interface Tier {
  id: string
  name: string
  sort_order: number | null
}
