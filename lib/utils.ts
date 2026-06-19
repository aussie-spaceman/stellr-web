export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// Fixed app timezone + locale so a date/time renders identically on the server
// and on the client. Bare `.toLocaleDateString()`/`.toLocaleString()` inherit the
// runtime's locale and timezone, which differ between the SSR host (UTC) and the
// browser — causing React #418 hydration errors and inconsistent day/format.
// Change this single constant if the organisation operates in another timezone.
export const APP_TIME_ZONE = 'Australia/Sydney'

/** Day-month-year for a timestamp/ISO string, e.g. "20 Jun 2026". */
export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: APP_TIME_ZONE,
  })
}

/** Date + time for a timestamp/ISO string, e.g. "20 Jun 2026, 10:00 am". */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: APP_TIME_ZONE,
  })
}

export function formatDateRange(start: string, end?: string): string {
  if (!end || start === end) return formatDate(start)
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}–${e.getDate()}, ${e.getFullYear()}`
  }
  return `${formatDate(start)} – ${formatDate(end)}`
}

export function registrationStatus(
  open: boolean,
  openDate?: string,
  closeDate?: string
): 'open' | 'coming-soon' | 'closed' {
  if (!open) {
    if (openDate && new Date(openDate) > new Date()) return 'coming-soon'
    return 'closed'
  }
  if (closeDate && new Date(closeDate) < new Date()) return 'closed'
  return 'open'
}
