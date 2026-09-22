import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Check, ShieldAlert, ShieldOff, Clock } from 'lucide-react'
import { Hero, Eyebrow, Badge } from '@stellr/web-ui'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import {
  getCredentialByNumber,
  credentialState,
  shareConsentFor,
  canShare,
  canUseLinkedIn,
  credentialUrl,
  recordCredentialEvent,
  type CredentialState,
} from '@/lib/credentials'
import { linkedInAddToProfileUrl, linkedInShareUrl, linkedInManualDetails } from '@/lib/linkedin'
import { formatDate } from '@/lib/utils'
import { CredentialBadgeArt } from '@/components/credentials/CredentialBadgeArt'
import { CredentialActions } from '@/components/credentials/CredentialActions'

// The credential page IS the product: the URL on a LinkedIn profile, the link
// a verifier opens, the card a feed post shows. Private by default; the owner
// turns it on. Design: docs/PLAN-credentials-linkedin-2026-09-21.md §3.5.
//
// Never indexed (D4): a K-12 audience, and the value is in the link, not in
// search. LinkedIn's scraper ignores robots, so previews still render.
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ number: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { number } = await params
  const cred = await getCredentialByNumber(supabaseServer(), number)
  const showable = cred && cred.visibility === 'public' && !cred.tombstoned_at
  const title = showable ? `${cred.recipient_name} — ${cred.title}` : 'Stellr credential'
  const description = showable
    ? `${cred.title}, issued by ${cred.issuer} on ${formatDate(cred.issued_at)}. Verify at stellreducation.org.`
    : 'A verifiable credential issued by Stellr Education.'
  return {
    title,
    description,
    robots: { index: false, follow: false },
    alternates: cred ? { canonical: credentialUrl(cred.number) } : undefined,
    openGraph: { title, description, type: 'website', url: cred ? credentialUrl(cred.number) : undefined },
  }
}

const STATE_BADGE: Record<CredentialState, { label: string; className: string; Icon: typeof Check }> = {
  valid:     { label: 'Valid',     className: 'bg-enviro-green-bg text-enviro-green-text', Icon: Check },
  expired:   { label: 'Expired',   className: 'bg-pathway-amber-bg text-pathway-amber-deep', Icon: Clock },
  revoked:   { label: 'Revoked',   className: 'bg-danger/10 text-danger', Icon: ShieldAlert },
  withdrawn: { label: 'Withdrawn', className: 'bg-surface text-content-muted', Icon: ShieldOff },
}

export default async function CredentialPage({ params }: Params) {
  const { number } = await params
  const db = supabaseServer()
  const cred = await getCredentialByNumber(db, number)
  if (!cred) notFound()

  const member = await getCurrentMember()
  const isOwner = !!member && !!cred.member_id && member.id === cred.member_id
  const state = credentialState(cred)

  // ── Withdrawn: the number still answers, the person is gone ─────────────
  if (state === 'withdrawn') {
    return (
      <Shell eyebrow="Credential" title="This credential has been withdrawn">
        <p className="text-content-secondary leading-relaxed">
          Credential <span className="font-mono text-ink">{cred.number}</span> was issued by {cred.issuer} and has
          since been withdrawn at the holder&rsquo;s request. It is no longer valid.
        </p>
      </Shell>
    )
  }

  // ── Private: the holder has not turned it on ───────────────────────────
  if (cred.visibility === 'private' && !isOwner) {
    return (
      <Shell eyebrow="Credential" title="This credential is private">
        <p className="text-content-secondary leading-relaxed">
          Credential <span className="font-mono text-ink">{cred.number}</span> exists, but its holder has not made it
          public. If you were sent this link, ask them to turn on sharing from their Stellr account.
        </p>
      </Shell>
    )
  }

  if (!isOwner) void recordCredentialEvent(db, cred.id, 'view')

  const consent = await shareConsentFor(db, cred)
  const share = canShare(cred, consent)
  const linkedInOk = canUseLinkedIn(cred.date_of_birth)
  const url = credentialUrl(cred.number)
  const { label, className, Icon } = STATE_BADGE[state]
  const pills = [cred.issuer, `Issued ${formatDate(cred.issued_at)}`]
  if (cred.role_label) pills.push(cred.role_label)
  if (cred.award) pills.push(cred.award)

  return (
    <>
      <Hero
        breadcrumb="Verified credential"
        title={cred.title}
        lead={
          <>
            Awarded to <span className="text-white font-semibold">{cred.recipient_name}</span>
          </>
        }
        pills={pills}
        media={
          <div className="flex justify-center lg:justify-end">
            <CredentialBadgeArt theme={cred.theme} title={cred.title} size={260} />
          </div>
        }
      />

      <section className="bg-surface section-padding">
        <div className="container-max max-w-content grid gap-10 lg:grid-cols-[1fr_320px] items-start">
          <div>
            <div className="flex items-center gap-3">
              <Badge className={className}>
                <Icon size={14} className="mr-1" aria-hidden="true" />
                {label}
              </Badge>
              {state === 'revoked' && cred.revoked_at && (
                <span className="text-sm text-content-muted">on {formatDate(cred.revoked_at)}</span>
              )}
              {state === 'expired' && cred.expires_at && (
                <span className="text-sm text-content-muted">on {formatDate(cred.expires_at)}</span>
              )}
            </div>

            {cred.description && (
              <p className="mt-6 text-content-secondary leading-relaxed">{cred.description}</p>
            )}

            {cred.criteria && (
              <div className="mt-8">
                <Eyebrow>How it was earned</Eyebrow>
                <p className="mt-2 text-content-secondary leading-relaxed">{cred.criteria}</p>
              </div>
            )}

            {cred.skills.length > 0 && (
              <div className="mt-8">
                <Eyebrow>Skills</Eyebrow>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {cred.skills.map((s) => (
                    <li key={s} className="rounded-pill border border-line bg-white px-3 py-1 text-sm text-ink">
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {isOwner && (
              <CredentialActions
                number={cred.number}
                url={url}
                visibility={cred.visibility}
                shareBlock={share.ok ? null : share.reason}
                linkedInOk={linkedInOk}
                addToProfileUrl={linkedInAddToProfileUrl(cred)}
                shareUrl={linkedInShareUrl(url)}
                manual={linkedInManualDetails(cred)}
              />
            )}
          </div>

          <aside className="rounded-ds-card border border-line bg-white p-6">
            <Eyebrow>Verification</Eyebrow>
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Credential ID"><span className="font-mono">{cred.number}</span></Row>
              <Row label="Issued by">{cred.issuer}</Row>
              <Row label="Issued on">{formatDate(cred.issued_at)}</Row>
              {cred.expires_at && <Row label="Expires">{formatDate(cred.expires_at)}</Row>}
              <Row label="Holder">{cred.recipient_name}</Row>
            </dl>
            <p className="mt-5 text-xs text-content-muted leading-relaxed">
              This page is served by Stellr Education. A credential is genuine only if this address shows it as
              valid — a PDF or screenshot on its own is not proof.
            </p>
          </aside>
        </div>
      </section>
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-content-muted">{label}</dt>
      <dd className="text-ink text-right">{children}</dd>
    </div>
  )
}

function Shell({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <>
      <Hero breadcrumb={eyebrow} title={title} glow={false} />
      <section className="bg-surface section-padding">
        <div className="container-max max-w-content">{children}</div>
      </section>
    </>
  )
}
