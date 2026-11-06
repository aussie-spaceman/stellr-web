// The catalogue of platform audit actions (docs/TENANCY-S5.md, C7).
//
// Every audit event names one of these, so a reader of the log can rely on the
// vocabulary: `<area>.<thing>.<verb>`, dotted lower-case, which is the shape the
// action CHECK on platform_audit_events accepts. auditMutation and withAudit
// (lib/audit/route.ts) take only these; the IDOR suite fails on any other name.
//
// A PR that audits a new route appends its actions here in the same PR, under
// its area. Keep an action once it has been written: rows are never erased, so
// a renamed action would split the history.

export const AUDIT_ACTIONS = [
  // Support: view-as (app/api/admin/impersonation)
  'support.impersonate.start',
  'support.impersonate.stop',

  // Crons (B12) and webhooks (A13)
  'cron.run.finish',
  'webhook.event.process',

  // Registration (A7, A8)
  'registration.individual.create',
  'registration.group.create',
  'registration.group_join.create',
  'registration.payment.start',
  'registration.seat_payment.start',
  'registration.participant.create',
  'registration.participant.update',
  'registration.payment_method.change',

  // Consent and uploads (A14)
  'consent.request.send',
  'consent.request.settle',
  'upload.sign.create',

  // Public and store writes (B18)
  'email.unsubscribe.apply',
  'store.order.fulfilment_update',
  'campaign.submission.create',
  'scholarship.application.create',
  'store.checkout.create',
  'store.order.reship',
  'store.order.stale_reship_cancel',
  'privacy.request.create',
  'privacy.request.confirm',
  'teacher_grant.application.create',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

const CATALOGUE: ReadonlySet<string> = new Set(AUDIT_ACTIONS)

export function isCataloguedAction(action: string): action is AuditAction {
  return CATALOGUE.has(action)
}
