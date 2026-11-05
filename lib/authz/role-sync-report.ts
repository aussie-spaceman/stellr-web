import { captureRequestError } from '@/lib/app-errors'
import type { RoleSyncResult } from './role-sync'

/**
 * Make a failed dual-write visible, for a route. The admin action has already
 * succeeded and its response does not change, so the failure goes where staff
 * look: the runtime log, app_errors (which the daily error digest emails), and
 * the action's own activity-log row (roleSyncMetadata). Not in lib/authz/role-sync
 * so scripts need not load lib/app-errors and the email code behind it.
 *
 * Fixed labels and a Postgres code only: no ids, no database message.
 * `map-tenancy-roles --check` names who drifted. Never throws.
 */
export async function reportRoleSyncFailure(action: string, result: RoleSyncResult, request: { method: string; routePath: string }): Promise<void> {
  if (result.ok) return
  const message = `role_sync_failed ${action} step=${result.step} code=${result.code}`
  console.error(`[role-sync] ${request.method} ${request.routePath}: ${message}`)
  await captureRequestError(new Error(message), { method: request.method }, { routePath: request.routePath })
}

/** Extra activity-log metadata: nothing on success, so a normal row is unchanged. */
export function roleSyncMetadata(result: RoleSyncResult): { membership_sync?: 'failed' } {
  return result.ok ? {} : { membership_sync: 'failed' }
}
