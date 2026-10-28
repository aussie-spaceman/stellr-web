import Link from 'next/link'
import type { AccountState, GroupStatus, GroupPersonStatus } from '@/lib/group-status'
import type { DocusignPill } from '@/lib/docusign-status'
import { formatUsd } from '@/lib/mentoring-format'

// "Your group" on the event page, for the teacher who registered it: each
// person's agreement, account and space access at a glance. Read-only — edits
// happen in My Stellr → Teams, and Stellr staff fix what only they can.

const AGREEMENT: Record<DocusignPill, { label: string; cls: string }> = {
  complete:     { label: 'Signed',              cls: 'bg-green-100 text-green-700' },
  on_file:      { label: 'Signed (on file)',    cls: 'bg-green-100 text-green-700' },
  issued:       { label: 'Waiting to be signed', cls: 'bg-orange-100 text-orange-700' },
  partial:      { label: 'Partly signed',       cls: 'bg-orange-100 text-orange-700' },
  not_issued:   { label: 'Not sent yet',        cls: 'bg-surface text-content-muted' },
  failed:       { label: 'Couldn’t send — check the guardian email', cls: 'bg-red-100 text-red-700' },
  bounced:      { label: 'Email bounced',       cls: 'bg-red-100 text-red-700' },
  declined:     { label: 'Declined',            cls: 'bg-red-100 text-red-700' },
  voided:       { label: 'Cancelled',           cls: 'bg-surface text-content-muted' },
  not_required: { label: 'Not needed',          cls: 'bg-surface text-content-muted' },
}

const ACCOUNT: Record<AccountState, { label: string; cls: string }> = {
  active:  { label: 'Active',                 cls: 'bg-green-100 text-green-700' },
  created: { label: 'Created — not signed in', cls: 'bg-orange-100 text-orange-700' },
  none:    { label: 'Not created yet',        cls: 'bg-surface text-content-muted' },
}

function Pill({ label, cls }: { label: string; cls: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
}

function PersonRow({ person }: { person: GroupPersonStatus }) {
  return (
    <tr className="border-t border-line align-top">
      <td className="py-2.5 pr-3 text-sm font-medium text-ink">
        {person.name}
        {person.isOrganiser && <span className="ml-1.5 text-xs font-normal text-content-muted">(you)</span>}
        {!person.isStudent && !person.isOrganiser && <span className="ml-1.5 text-xs font-normal text-content-muted">(adult)</span>}
      </td>
      <td className="py-2.5 pr-3"><Pill {...AGREEMENT[person.agreementPill]} /></td>
      <td className="py-2.5 pr-3"><Pill {...ACCOUNT[person.account]} /></td>
      <td className="py-2.5 text-sm text-content-secondary">
        {person.spaceAccess === null ? '—' : person.spaceAccess ? 'Yes' : 'No'}
      </td>
    </tr>
  )
}

export function GroupStatusSection({ groups }: { groups: GroupStatus[] }) {
  if (groups.length === 0) return null
  return (
    <section id="group" className="mt-6 scroll-mt-24">
      <h2 className="mb-3 text-sm font-subheading font-semibold text-content-muted">Your group</h2>
      <div className="space-y-4">
        {groups.map((g) => {
          const students = g.people.filter((p) => p.isStudent)
          const signed = students.filter((p) => p.agreementPill === 'complete' || p.agreementPill === 'on_file').length
          const active = students.filter((p) => p.account === 'active').length
          return (
            <div key={g.registrationId} className="rounded-lg border border-line bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold text-ink">{g.name}</h3>
                <p className="text-xs text-content-secondary">
                  {signed} of {students.length} consent forms signed · {active} of {students.length} students signed in ·{' '}
                  {!g.amountDueCents && !g.invoiceRequested
                    ? 'No fee'
                    : g.paid
                    ? 'Paid'
                    : g.invoiceRequested
                      ? `Invoice${g.amountDueCents ? ` ${formatUsd(g.amountDueCents)}` : ''} unpaid`
                      : 'Payment outstanding'}
                </p>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-content-muted">
                      <th className="pb-2 pr-3 font-semibold">Name</th>
                      <th className="pb-2 pr-3 font-semibold">Agreement</th>
                      <th className="pb-2 pr-3 font-semibold">Stellr account</th>
                      <th className="pb-2 font-semibold">Event space</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.people.map((p) => <PersonRow key={p.participantId} person={p} />)}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-content-secondary">
                Consent forms go to each student&rsquo;s parent or guardian. To correct a student&rsquo;s details, open{' '}
                <Link href="/account?tab=teams" className="font-medium text-primary underline underline-offset-2 hover:no-underline">
                  My Stellr → Teams
                </Link>
                .
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
