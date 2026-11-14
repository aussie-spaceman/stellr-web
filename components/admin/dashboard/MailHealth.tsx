// Mail that may not be going out, for the admin dashboard (/admin): an outbox
// whose latest run failed or that has not succeeded in time
// (resend-quota-outbox.5), and other tenants' signing invitations held for want
// of a sender (B14b). Server component: it only renders what lib/admin-digest
// loaded. Counts and times only, never an address or a tenant's details.

import { AlertTriangle, MailWarning } from 'lucide-react'
import { stuckOutboxes, type OutboxHealth } from '@/lib/admin-digest'
import { formatDateTime } from '@/lib/utils'

function outboxSentence(o: OutboxHealth): string {
  return o.state === 'failed'
    ? `The latest run failed (${formatDateTime(o.lastRunAt)}).`
    : `No successful run in the last ${o.windowHours} hours.`
}

export function MailHealth({
  outboxes,
  heldSigningInvites,
  showHeld,
}: {
  outboxes: readonly OutboxHealth[] | undefined
  heldSigningInvites: number | null | undefined
  /** Platform admins only: the held count concerns other tenants. */
  showHeld: boolean
}) {
  const stuck = stuckOutboxes(outboxes)
  const held = showHeld && heldSigningInvites ? heldSigningInvites : 0
  if (stuck.length === 0 && held === 0) return null

  return (
    <section aria-labelledby="mail-health-heading" className="space-y-3">
      <h2 id="mail-health-heading" className="sr-only">Mail needing a look</h2>
      {stuck.map((o) => (
        <div
          key={o.key}
          role="alert"
          className={`flex gap-3 rounded-ds-card border px-4 py-3 text-sm ${
            o.state === 'failed' ? 'border-danger/30 bg-danger/5 text-danger' : 'border-pathway-amber bg-pathway-amber-bg text-gold-ink'
          }`}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p>
              <strong>{o.label}:</strong> {outboxSentence(o)}{' '}
              {o.lastSuccessAt
                ? <>Last successful run {formatDateTime(o.lastSuccessAt)}.</>
                : <>No successful run on record.</>}
            </p>
            {o.detail && <p className="mt-1 text-xs">{o.detail}.</p>}
          </div>
        </div>
      ))}
      {held > 0 && (
        <div role="status" className="flex gap-3 rounded-ds-card border border-pathway-amber bg-pathway-amber-bg px-4 py-3 text-sm text-gold-ink">
          <MailWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0">
            <strong>
              {held.toLocaleString()} signing invitation{held === 1 ? '' : 's'} held.
            </strong>{' '}
            {held === 1 ? 'It is' : 'They are'} for other organisers with no email sender set up yet, so nothing has been sent.
            {' '}{held === 1 ? 'It goes' : 'They go'} out once the organiser&rsquo;s sender is in place.
          </p>
        </div>
      )}
    </section>
  )
}
