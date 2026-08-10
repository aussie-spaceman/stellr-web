import { NextResponse } from 'next/server'
import { captureLead, logLine, readHubspotCookie } from '@/lib/hubspot'
import {
  HS,
  NOTIFY_STATUS,
  REGISTRATION_INTEREST,
  eventProperties,
  type LeadSource,
  type RegistrationInterest,
} from '@/lib/hubspot-fields'
import { getEventBySlug } from '@/lib/sanity'
import { rateLimitGuard, HOUR_MS } from '@/lib/rate-limit'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

// Newsletter / "Get Notified" subscriber capture. Two callers:
//   • the footer SubscribeForm — email only
//   • the event-detail notify modal — name, email, event slug, and whether the
//     visitor reached for Individual or Group registration
//
// The client sends only the slug and its intent. Every CRM property is derived
// server-side from the Sanity document, so a tampered request can't write
// arbitrary values into the portal's event taxonomy, and the mapping stays in
// one place instead of being duplicated into the browser bundle.
export async function POST(req: Request) {
  // Raised from 5/hour: this route sends no outbound email, and the previous
  // cap was low enough that a school computer lab or any shared NAT would lock
  // out real students after five signups.
  const limited = rateLimitGuard(req, 'subscribe', { limit: 30, windowMs: HOUR_MS })
  if (limited) return limited

  try {
    const { email, name, source, eventSlug, interest } = await req.json()
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
    }

    const cleanEmail = email.trim()
    const trimmedName = typeof name === 'string' ? name.trim() : ''
    const [firstName, ...rest] = trimmedName.split(/\s+/)

    const isEventNotify = source === 'event-notify' && typeof eventSlug === 'string' && eventSlug
    const leadSource: LeadSource = isEventNotify ? 'event_notify' : 'newsletter'

    const properties: Record<string, string> = {}
    let activity = 'Subscribed to Stellr updates via the website footer.'
    let logEntry = logLine(leadSource, 'Website footer subscribe')
    let pageName = 'Newsletter subscribe'
    let pageUri = SITE_URL

    if (isEventNotify) {
      // Resolve the event server-side. A slug we can't resolve is still worth
      // capturing — we just record the raw slug and skip the taxonomy rather
      // than inventing values for it.
      const event = await getEventBySlug(eventSlug).catch(() => null)

      const chosen: RegistrationInterest =
        interest === 'individual' || interest === 'group' ? interest : 'unspecified'

      properties[HS.notifyStatus] = NOTIFY_STATUS.requested
      properties[HS.notifyRequestedDate] = new Date().toISOString().slice(0, 10)
      properties[HS.registrationInterest] = REGISTRATION_INTEREST[chosen]

      if (event) {
        const mapped = eventProperties(event, eventSlug)
        Object.assign(properties, mapped.properties)
        if (mapped.unmapped.length) {
          // A missing portal option is a data-quality problem someone has to
          // fix; make it loud rather than shipping a half-tagged contact.
          console.warn(
            `[subscribe] Unmapped event fields for "${eventSlug}": ${mapped.unmapped.join(', ')}`,
          )
        }
      } else {
        properties[HS.eventSlug] = eventSlug
        console.warn(`[subscribe] Event not found in Sanity for slug "${eventSlug}"`)
      }

      const eventName = event?.title ?? eventSlug
      const interestLabel = REGISTRATION_INTEREST[chosen].toLowerCase()
      activity =
        `Requested registration updates for ${eventName}` +
        (chosen === 'unspecified' ? '.' : ` (${interestLabel} registration).`)
      logEntry = logLine(
        leadSource,
        `${eventSlug} · ${REGISTRATION_INTEREST[chosen]}`,
      )
      pageName = `Event notify — ${eventName}`
      pageUri = `${SITE_URL}/events/${eventSlug}`
    }

    const result = await captureLead({
      email: cleanEmail,
      firstName: firstName || undefined,
      lastName: rest.join(' ') || undefined,
      source: leadSource,
      lifecycleStage: 'subscriber',
      activity,
      properties,
      logEntry,
      context: {
        hutk: readHubspotCookie(req),
        pageUri,
        pageName,
      },
    })

    // Report the real outcome. Returning ok:true unconditionally is what let a
    // failed CRM write still show the visitor "You're on the list".
    if (!result.ok) {
      return NextResponse.json(
        { error: 'Could not record your request. Please try again.' },
        { status: 502 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
