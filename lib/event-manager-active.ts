// Which event_manager_assignments rows are still in force. Dependency-free so
// the authz readers (lib/authz/principal.ts, lib/event-access.ts, audiences)
// can apply it without importing the Event Manager service (lib/event-manager.ts),
// which imports them.
//
// A row is in force when it has no expiry (granted before expiries existed, 9
// Nov 2026) or its expiry is in the future. Readers that decide access or send
// mail to managers apply activeAssignmentFilter, so access ends at expires_at
// even before the daily sweep deletes the row.

/** PostgREST `or` filter for rows still in force. */
export function activeAssignmentFilter(now: Date = new Date()): string {
  return `expires_at.is.null,expires_at.gt.${now.toISOString()}`
}

export function isAssignmentActive(row: { expires_at?: string | null }, now: Date = new Date()): boolean {
  return !row.expires_at || new Date(row.expires_at) > now
}
