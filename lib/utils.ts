export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
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
