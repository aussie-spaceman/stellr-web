// Shared admin gate for /api/admin/* routes. Mirrors the inline
// requireAdmin check used elsewhere (role=admin in Clerk publicMetadata).

type Claims = Record<string, unknown> | null | undefined

function roleFromClaims(sessionClaims: Claims): string | undefined {
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role
}

export function isAdminClaims(sessionClaims: Claims): boolean {
  return roleFromClaims(sessionClaims) === 'admin'
}

// Event Managers get access to /admin/events only, and only for events
// they've been assigned to (event_manager_assignments table).
export function isEventManagerClaims(sessionClaims: Claims): boolean {
  return roleFromClaims(sessionClaims) === 'event_manager'
}

// Anyone allowed into the admin portal shell (nav varies by role).
export function hasAdminPortalAccess(sessionClaims: Claims): boolean {
  return isAdminClaims(sessionClaims) || isEventManagerClaims(sessionClaims)
}
