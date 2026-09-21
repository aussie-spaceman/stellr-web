import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Eye, EyeOff, Award } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { listMemberCredentials, credentialState, type CredentialState } from '@/lib/credentials'
import { formatDateShort } from '@/lib/utils'

export const metadata = { title: 'Credentials' }

// The member's wallet: every credential they hold, with state and visibility.
// Sharing lives on the credential page itself (one place for owner and
// verifier alike), so this is a list, not a second control surface.

const STATE_LABEL: Record<CredentialState, { text: string; className: string }> = {
  valid:     { text: 'Valid',     className: 'bg-enviro-green-bg text-enviro-green-text' },
  expired:   { text: 'Expired',   className: 'bg-pathway-amber-bg text-pathway-amber-deep' },
  revoked:   { text: 'Revoked',   className: 'bg-danger/10 text-danger' },
  withdrawn: { text: 'Withdrawn', className: 'bg-surface text-content-muted' },
}

export default async function CredentialsPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const rows = await listMemberCredentials(supabaseServer(), member.id)

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">Credentials</h1>
        <p className="mt-1 text-sm text-brand-muted-soft">
          What you have earned with Stellr — course completions and event participation. Each one has a page you
          can make public, share, and add to LinkedIn.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-ds-card border border-line bg-white p-8 text-center">
          <Award size={28} className="mx-auto text-content-faint" aria-hidden="true" />
          <p className="mt-3 font-semibold text-ink">No credentials yet</p>
          <p className="mt-1 text-sm text-content-secondary">
            Finish a course in Training, or take part in an event, and it will appear here.
          </p>
          <Link href="/community/training" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            Go to Training <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <ul className="rounded-ds-card border border-line bg-white divide-y divide-line-light">
          {rows.map((c) => {
            const state = credentialState(c)
            const s = STATE_LABEL[state]
            const isPublic = c.visibility === 'public'
            return (
              <li key={c.id}>
                <Link
                  href={`/credentials/${encodeURIComponent(c.number)}`}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-surface transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink truncate">{c.title}</p>
                    <p className="mt-0.5 text-sm text-content-muted">
                      {c.issuer} · {formatDateShort(c.issued_at)} · <span className="font-mono">{c.number}</span>
                    </p>
                  </div>
                  <span className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs font-bold uppercase tracking-[0.05em] ${s.className}`}>
                    {s.text}
                  </span>
                  <span className="hidden sm:inline-flex items-center gap-1 text-xs text-content-muted" title={isPublic ? 'Public' : 'Private'}>
                    {isPublic ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
                    {isPublic ? 'Public' : 'Private'}
                  </span>
                  <ArrowRight size={16} className="text-content-faint" aria-hidden="true" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
