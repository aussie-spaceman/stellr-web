// "Add to Google Calendar" link builder (PRD §11: "links to add to members
// Google Calendar"). Pure URL construction — no per-user calendar OAuth. The
// emailed .ics (lib/ics) covers Outlook/Apple; this gives a one-click Google add.

function gcalFmt(d: Date): string {
  // Google expects UTC basic format: YYYYMMDDTHHMMSSZ
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function googleCalendarUrl(opts: {
  title: string
  start: Date
  end: Date
  details?: string
  location?: string
}): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: opts.title,
    dates: `${gcalFmt(opts.start)}/${gcalFmt(opts.end)}`,
  })
  if (opts.details) params.set('details', opts.details)
  if (opts.location) params.set('location', opts.location)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
