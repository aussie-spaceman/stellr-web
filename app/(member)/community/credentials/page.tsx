import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Eye, EyeOff, Award, FileDown } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { listMemberCredentials, credentialState, type CredentialState } from '@/lib/credentials'
import { formatDateShort } from '@/lib/utils'

export const metadata = { title: 'Credentials' }

// The member's wallet: every credential they hold, with state and visibility.
// Sharing lives on the credential page itself (one place for owner and
// verifier alike), so this is a list, not a second control surface — apart
// from the certificate download, which is the holder's own copy whether the
// page is public or not.

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
          What you have earned with Stellr — course completions, event participation and awards. Each one has a
          certificate to download and a page you can make public, share, and add to LinkedIn.
        </p>
        <p className="mt-2 text-xs text-content-muted">
          Every credential is private until you make it public. For students under 18, a parent or guardian can ask
          for credentials to stay private.{' '}
          <Link href="/privacy#credentials" className="underline hover:text-ink">How credentials are shared</Link>
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
              <li key={c.id} className="flex items-center hover:bg-surface transition-colors">
                <Link
                  href={`/credentials/${encodeURIComponent(c.number)}`}
                  className="flex min-w-0 flex-1 items-center gap-4 py-4 pl-5 pr-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink truncate">{c.title}</p>
                    <p className="mt-0.5 text-sm text-content-muted">
                      {c.issuer} · {formatDateShort(c.issued_at)} · <span className="font-mono">{c.number}</span>
                    </p>
                  </div>
                  {c.award_type && c.award_type !== 'participation' && (
                    <span className="hidden md:inline-flex items-center gap-1 rounded-pill bg-star-gold/20 px-2.5 py-0.5 text-xs font-bold uppercase tracking-[0.05em] text-ink">
                      <Award size={12} aria-hidden="true" /> Award
                    </span>
                  )}
                  <span className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs font-bold uppercase tracking-[0.05em] ${s.className}`}>
                    {s.text}
                  </span>
                  <span className="hidden sm:inline-flex items-center gap-1 text-xs text-content-muted" title={isPublic ? 'Public' : 'Private'}>
                    {isPublic ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
                    {isPublic ? 'Public' : 'Private'}
                  </span>
                  <ArrowRight size={16} className="text-content-faint" aria-hidden="true" />
                </Link>
                {state === 'valid' || state === 'expired' ? (
                  <a
                    href={`/api/credentials/${encodeURIComponent(c.number)}/pdf`}
                    className="mr-3 inline-flex items-center gap-1 rounded-ds-card px-2 py-2 text-xs font-semibold text-primary hover:underline"
                    aria-label="Download certificate"
                    title="Download certificate (PDF)"
                  >
                    <FileDown size={16} aria-hidden="true" />
                    <span className="hidden sm:inline">PDF</span>
                  </a>
                ) : (
                  <span className="mr-3 w-[52px]" aria-hidden="true" />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
