// Shared admin gate for /api/admin/email/* routes. Mirrors the inline
// requireAdmin check used elsewhere (role=admin in Clerk publicMetadata).

export function isAdminClaims(sessionClaims: Record<string, unknown> | null | undefined): boolean {
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  return role === 'admin'
}
