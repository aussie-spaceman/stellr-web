// When the weekly digest goes out: Friday at midday in Denver.
//
// Vercel cron expressions are UTC and can't follow daylight saving, and Hobby
// fires a job at some point within its scheduled hour. So vercel.json runs the
// job at both 18:00 UTC (noon MDT) and 19:00 UTC (noon MST), and the job sends
// only from whichever run lands in Denver's 12 o'clock hour. A run already
// recorded as sent that day stops a second send.

const TZ = 'America/Denver'

/** Denver's weekday ("Fri") and 24-hour hour for an instant. */
export function denverClock(at: Date): { weekday: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(at)
  return {
    weekday: parts.find((p) => p.type === 'weekday')?.value ?? '',
    hour: Number(parts.find((p) => p.type === 'hour')?.value),
  }
}

export function isDigestSendTime(at: Date): boolean {
  const { weekday, hour } = denverClock(at)
  return weekday === 'Fri' && hour === 12
}
