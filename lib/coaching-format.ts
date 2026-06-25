// Pure, client-safe helpers for Coaching (no server imports). Coaching reuses
// most of lib/mentoring-format.ts (timezones, session formatting, USD); this holds
// the few coaching-specific bits used by client components.

/** Auto-name a workshop "<Coach> + <Member> Coaching" (editable later). */
export function autoWorkshopName(coachName: string | null, memberName: string | null): string {
  const c = coachName?.trim() || 'Coach'
  const m = memberName?.trim() || 'Member'
  return `${c} + ${m} Coaching`
}
