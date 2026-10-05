/**
 * The slice of a Sanity event the survey needs, read fresh (no CDN).
 */
import { getEventBySlug, getEventsForSurveySchedule } from '@/lib/sanity'
import { eventLastDay } from './schedule'
import { eventTimeZone } from './timezone'

export interface SurveyEvent {
  slug: string
  title: string
  date: string | null
  endDate: string | null
  lastDay: string | null
  timeZone: string
  state: string | null
  cancelled: boolean
  isCampaign: boolean
}

type RawEvent = {
  title?: string
  slug?: { current?: string } | string
  date?: string | null
  endDate?: string | null
  state?: string | null
  country?: string | null
  status?: string | null
  activityType?: string | null
}

export function toSurveyEvent(raw: RawEvent): SurveyEvent | null {
  const slug = typeof raw.slug === 'string' ? raw.slug : raw.slug?.current
  if (!slug) return null
  return {
    slug,
    title: raw.title ?? slug,
    date: raw.date ?? null,
    endDate: raw.endDate ?? null,
    lastDay: eventLastDay(raw),
    timeZone: eventTimeZone(raw),
    state: raw.state ?? null,
    cancelled: raw.status === 'cancelled',
    isCampaign: raw.activityType === 'campaign',
  }
}

export async function loadSurveyEvent(slug: string): Promise<SurveyEvent | null> {
  const raw = (await getEventBySlug(slug)) as RawEvent | null
  return raw ? toSurveyEvent(raw) : null
}

/** Every live (non-campaign) event Sanity knows, for the scheduling sweep. */
export async function loadAllSurveyEvents(): Promise<SurveyEvent[]> {
  const all = ((await getEventsForSurveySchedule()) ?? []) as RawEvent[]
  return all.map(toSurveyEvent).filter((e): e is SurveyEvent => !!e && !e.isCampaign)
}
