import type { AuditAction } from '@/lib/audit/actions'
import type { AuditMutation } from '@/lib/audit/route'

// The audit events for an organiser's team writes, app/api/members/teams/** (S5 A8).
// Each route wraps its handler in withAudit(teamAuditSpec(action), handler), so every
// answer but a 4xx is recorded, behind PLATFORM_AUDIT_ENABLED and after the response.
// The handler notes, once it has placed the group, which registration it acted on and
// whose it is, so the event goes on that tenant's chain with the registration as its
// target. Before that note (a throw before the group was read, say) the event names the
// session, no target, and the platform chain, marked unresolved.
//
// The registration id only: who was added, edited or removed stays out of the event,
// since they may be a minor and the row can never be erased.

interface Noted {
  registrationId: string
  tenantId: string
  userId: string | null
}

const noted = new WeakMap<Request, Noted>()

/** Record what this request acted on, once the handler has placed the group. */
export function teamAudit(req: Request, n: Noted): void {
  noted.set(req, n)
}

// One spec per route, by name: the coverage gate (lib/security/audit-coverage.ts) reads
// an imported name as a spec that always answers, where it cannot read a call.
export const TEAM_PARTICIPANT_CREATE_AUDIT = teamAuditSpec('registration.participant.create')
export const TEAM_PARTICIPANT_UPDATE_AUDIT = teamAuditSpec('registration.participant.update')
export const TEAM_PARTICIPANT_REMOVE_AUDIT = teamAuditSpec('registration.participant.remove')
export const TEAM_SHEET_SYNC_AUDIT = teamAuditSpec('registration.roster.sheet_sync')
export const TEAM_AGREEMENT_RESEND_AUDIT = teamAuditSpec('agreement.reminder.send')
export const TEAM_SEAT_PAYMENT_LINK_AUDIT = teamAuditSpec('registration.seat_payment_link.create')

/** withAudit's spec for a team route. */
function teamAuditSpec(action: AuditAction) {
  return ({ args: [req] }: { args: [Request, ...unknown[]] }): AuditMutation => {
    const n = noted.get(req)
    return {
      action,
      actor: n ? { userId: n.userId } : { session: true },
      tenant: { tenantId: n?.tenantId ?? null },
      target: { table: 'registrations', id: n?.registrationId ?? null },
      metadata: n ? null : { tenant_unresolved: true },
    }
  }
}
