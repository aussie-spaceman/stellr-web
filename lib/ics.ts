// Minimal iCalendar (.ics) builder for coaching/mentoring invites
// (FR-COM-11/12: "calendar invites shared with all participants").
//
// We attach an .ics to the confirmation email rather than using Google Calendar
// OAuth — it adds the event to Google Calendar, Outlook, and Apple Calendar alike
// with no per-user auth. Returns a base64 string ready for an email attachment.

export interface IcsEvent {
  uid: string
  title: string
  start: Date
  end: Date
  description?: string
  /** Join URL added to the event location + body. */
  url?: string
  organizerEmail?: string
  attendeeEmails?: string[]
}

function fmt(d: Date): string {
  // UTC, basic format: YYYYMMDDTHHMMSSZ
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export function buildIcs(e: IcsEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Stellr Education//Community//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(e.start)}`,
    `DTEND:${fmt(e.end)}`,
    `SUMMARY:${escape(e.title)}`,
  ]
  if (e.description || e.url) {
    const body = [e.description, e.url ? `Join: ${e.url}` : ''].filter(Boolean).join('\n')
    lines.push(`DESCRIPTION:${escape(body)}`)
  }
  if (e.url) lines.push(`LOCATION:${escape(e.url)}`)
  if (e.organizerEmail) lines.push(`ORGANIZER:mailto:${e.organizerEmail}`)
  for (const a of e.attendeeEmails ?? []) {
    lines.push(`ATTENDEE;RSVP=TRUE;ROLE=REQ-PARTICIPANT:mailto:${a}`)
  }
  lines.push('STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR')

  // CRLF line endings per RFC 5545.
  return lines.join('\r\n')
}

/** Build an .ics and return it base64-encoded for an email attachment. */
export function buildIcsAttachment(e: IcsEvent): { filename: string; content: string; contentType: string } {
  const ics = buildIcs(e)
  return {
    filename: 'invite.ics',
    content: Buffer.from(ics, 'utf-8').toString('base64'),
    contentType: 'text/calendar; method=REQUEST',
  }
}
