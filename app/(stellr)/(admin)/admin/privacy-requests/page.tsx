import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { formatDateShort } from '@/lib/utils'
import { findMatches, KIND_LABEL, type RequestKind } from '@/lib/privacy-requests'
import { PrivacyRequestActions } from '@/components/admin/PrivacyRequestActions'

export const metadata = { title: 'Admin — Privacy requests' }

// Confirmed privacy requests (review, correction, deletion, withdrawal), each
// with the records that carry the requester's address, newest first. Every
// one must be answered within 30 days of confirmation. Unconfirmed requests
// are not shown: until the emailed link is followed, nobody acts on them.

const DUE_DAYS = 30

export default async function PrivacyRequestsPage() {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') redirect('/account')

  const db = supabaseServer()
  const { data } = await db
    .from('privacy_requests')
    .select('id, created_at, kind, relationship, requester_name, requester_email, subject_name, details, status, verified_at, handled_by, handled_at, resolution_note')
    .neq('status', 'unverified')
    .order('verified_at', { ascending: false })
    .limit(200)
  const requests = data ?? []
  const open = requests.filter((r) => r.status === 'verified' || r.status === 'in_progress')
  const matches = new Map(await Promise.all(open.map(async (r) => [r.id as string, await findMatches(db, r.requester_email as string)] as const)))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-ink">Privacy requests</h1>
        <p className="mt-0.5 text-sm text-content-muted">
          {`Confirmed requests to see, correct or delete information, or to withdraw a consent. Answer each within ${DUE_DAYS} days of confirmation. ${open.length} open.`}
        </p>
      </div>

      {requests.length === 0 && <p className="rounded-xl border border-line bg-white p-5 text-sm text-content-muted">No confirmed requests.</p>}

      {requests.map((r) => {
        const due = r.verified_at ? new Date(new Date(r.verified_at).getTime() + DUE_DAYS * 86_400_000) : null
        const isOpen = r.status === 'verified' || r.status === 'in_progress'
        const overdue = isOpen && due && due < new Date()
        return (
          <section key={r.id} className="space-y-3 rounded-xl border border-line bg-white p-5" aria-label={`Request from ${r.requester_name}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-heading text-base font-semibold text-ink">{KIND_LABEL[r.kind as RequestKind]}</h2>
                <p className="text-sm text-ink">
                  {`${r.requester_name} (${r.requester_email})${r.relationship === 'parent_guardian' ? `, parent or guardian of ${r.subject_name}` : ''}`}
                </p>
              </div>
              <p className={`text-sm ${overdue ? 'font-semibold text-danger' : 'text-content-muted'}`}>
                {isOpen
                  ? `Confirmed ${formatDateShort(r.verified_at as string)} · answer by ${formatDateShort(due!.toISOString())}${overdue ? ' (overdue)' : ''}`
                  : `${r.status === 'completed' ? 'Completed' : 'Refused'} ${formatDateShort(r.handled_at as string)} by ${r.handled_by}`}
              </p>
            </div>
            {r.details && <p className="whitespace-pre-line rounded-control bg-surface p-3 text-sm text-ink">{r.details}</p>}
            {isOpen ? (
              <>
                <div className="text-sm">
                  <p className="font-semibold text-ink">Records with this address</p>
                  {(matches.get(r.id) ?? []).length === 0 ? (
                    <p className="text-content-muted">None found. The address may differ from the one used to register: reply to ask.</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {(matches.get(r.id) ?? []).map((m) => (
                        <li key={`${m.kind}-${m.id}-${m.via}`} className="text-ink">
                          {m.kind === 'member'
                            ? <a className="text-primary-deep underline" href={`/admin/members/${m.id}`}>{m.name}</a>
                            : <span>{m.name}</span>}
                          <span className="text-content-muted">{` · ${m.context} · matched by ${m.via}`}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <PrivacyRequestActions id={r.id} status={r.status as string} />
              </>
            ) : (
              r.resolution_note && <p className="text-sm text-content-muted">{r.resolution_note}</p>
            )}
          </section>
        )
      })}
    </div>
  )
}
