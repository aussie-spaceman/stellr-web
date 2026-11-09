import { NextResponse } from 'next/server'
import { notifyMember } from '@/lib/notify'
import { isStellrAdmin } from '@/lib/authz'
import { escapeHtml } from '@/lib/email-layout'
import { withAudit } from '@/lib/audit/route'

// What this request acted on, which withAudit's spec cannot read for itself: the body has gone.
const recipients = new WeakMap<Request, number>()

export const POST = withAudit(
  ({ args: [req] }) => ({
    action: 'training.reminder.send',
    actor: { session: true },
    tenant: { stellr: true },
    target: { table: 'members', id: null },
    metadata: { recipients: recipients.get(req) ?? null },
  }),
  sendTrainingReminders,
)

// POST /api/admin/training/bulk-notify
// Body: { memberIds: string[], objectLabel?: string, channels?: { email?, sms? } }
// Sends a training reminder to selected incomplete participants. Delivery honours
// each member's notification prefs across in-app / email / SMS; the channels hint
// records the admin's intent in the message.
async function sendTrainingReminders(req: Request) {
  if (!(await isStellrAdmin({ route: '/api/admin/training/bulk-notify' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const memberIds: string[] = Array.isArray(b.memberIds) ? b.memberIds : []
  if (memberIds.length === 0) return NextResponse.json({ error: 'memberIds required' }, { status: 400 })
  recipients.set(req, memberIds.length)
  const label = typeof b.objectLabel === 'string' && b.objectLabel ? b.objectLabel : 'your event'

  await Promise.all(
    memberIds.map((memberId) =>
      notifyMember(memberId, {
        type: 'session_reminder',
        body: `Reminder: please complete your required training for ${label}.`,
        email: {
          // deep review INTPUB-N1: `label` is the admin-supplied objectLabel and
          // this html reaches notify pre-built, so escape it here.
          subject: 'Required training reminder',
          html: `<p>Hi,</p><p>This is a reminder to complete your required training for <strong>${escapeHtml(label)}</strong>. Sign in to Stellr and open Academy &rsaquo; Training.</p>`,
          text: `Reminder: complete your required training for ${label}.`,
        },
      })
    )
  )
  return NextResponse.json({ notified: memberIds.length })
}
