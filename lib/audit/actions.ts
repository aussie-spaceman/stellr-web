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

  // A member's own account (B16): app/api/members, except teams (A8)
  'member.address.create',
  'member.address.update',
  'member.address.delete',
  'member.payment_link.create',
  'member.compliance_document.create',
  'member.compliance_document.delete',
  'member.compliance_license.update',
  'member.deletion_request.create',
  'member.directory_prefs.update',
  'member.agreement.download',
  'member.event_participation.create',
  'member.event_participation.delete',
  'member.profile.update',
  'member.onboarding.submit',
  'member.privacy_prefs.update',
  'member.registration.withdraw_preview',
  'member.registration.withdraw',
  'member.survey.open',
  'member.survey.save',
  'member.survey.submit',
  'member.survey_quote.withdraw',

  // Community (B16): app/api/community
  'community.chat_message.create',
  'community.chat_message.delete',
  'community.chat_message.flag',
  'community.coaching.manage',
  'community.coaching_session.request',
  'community.coaching_request.create',
  'community.coaching_request.book',
  'community.coaching.topup',
  'community.cohort_invite.respond',
  'community.comment.create',
  'community.content.flag',
  'community.host_availability.create',
  'community.host_availability.delete',
  'community.host_session.manage',
  'community.media.publish',
  'community.mentoring_cohort.create',
  'community.mentoring.manage',
  'community.mentoring.register',
  'community.mentoring.topup',
  'community.notifications.mark_read',
  'community.post.create',
  'community.post.update',
  'community.reaction.toggle',
  'community.resource.attach',
  'community.resource.download',
  'community.resource_attachment.rename',
  'community.resource.contribute',
  'community.session_action.toggle',
  'community.space_invite.respond',
  'community.space.join',
  'community.training_item.flag',
  'community.training.group_nudge',
  'community.training.progress',

  // Stellr-only community, academy, training and entitlements admin (C13)
  'coaching.request.decline',
  'coaching.request.match',
  'coaching.workshop.ensure',
  'community.cohort.manage',
  'community.flag.resolve',
  'community.gate.delete',
  'community.gate.set',
  'community.resource.create',
  'community.resource.delete',
  'community.resource.update',
  'community.space.configure',
  'community.space.create',
  'community.space.delete',
  'community.space.update',
  'community.space_resource.add',
  'community.workshop.manage',
  'container.content.add',
  'container.content.remove',
  'entitlement.allocation.update',
  'entitlement.discount.delete',
  'entitlement.discount.save',
  'membership.rule.create',
  'membership.rule.delete',
  'membership.rule.update',
  'training.assignment.delete',
  'training.assignment.save',
  'training.assignment.update',
  'training.cert_template.clear',
  'training.cert_template.set',
  'training.item.create',
  'training.item.delete',
  'training.item.update',
  'training.item_resource.create',
  'training.item_resource.delete',
  'training.module.create',
  'training.module.update',
  'training.recording.delete',
  'training.recording.update',
  'training.reminder.send',
  'training.section.create',
  'training.section.delete',
  'training.section.update',

  // Platform-destined admin: deletion, privacy, merge, schools and staff roles (C15)
  'deletion.entity.delete',
  'deletion.request.review',
  'member.record.merge',
  'privacy.request.resolve',
  'school.record.update',
  'staff.role.grant',
  'staff.role.revoke',

  // Events admin: records by id inside an event (C16)
  'agreement.credential_sharing.set',
  'agreement.record.download',
  'agreement.recipient.correct',
  'agreement.recipient.sync',
  'agreement.reminder.send',
  'campaign.email.send',
  'credential.email.resend',
  'credential.record.revoke',
  'event_manager.assignment.create',
  'event_manager.assignment.delete',
  'event_participation.record.delete',
  'event_participation.record.update',
  'refund.preview.read',
  'registration.group_setup.finish',
  'registration.invoice.change',
  'registration.invoice.read',
  'registration.participant.staff_add',
  'survey.quote.withdraw',

  // Events admin: paperwork and communications under an event (C17)
  'agreement.participant.reissue',
  'credential.pd.issue',
  'event.reminder.send',
  'event_email.attachment.add',
  'event_email.catch_up.read',
  'event_email.catch_up.send',
  'event_email.message.send',
  'event_email.preview.read',
  'event_email.record.create',
  'event_email.record.delete',
  'event_email.record.update',
  'event_volunteer.assignment.create',
  'event_volunteer.assignment.delete',
  'participant.guardian_email.correct',
  'registration.invoice_paid.set',
  'registration.pay_link.send',
  'survey.distribution.change',
  'survey.distribution.read',
  'team_profile.invite.send',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

const CATALOGUE: ReadonlySet<string> = new Set(AUDIT_ACTIONS)

export function isCataloguedAction(action: string): action is AuditAction {
  return CATALOGUE.has(action)
}
