import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Check, ShieldAlert, ShieldOff, Clock, Lock } from 'lucide-react'
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
import { certificateGateFor } from '@/lib/survey/certificate-gate'
import { verifyCredentialViewToken, FAMILY_LINK_PARAM } from '@/lib/credentials-link'
import { viewAsBannerProps } from '@/lib/impersonation'
import { ImpersonationBanner } from '@/components/admin/ImpersonationBanner'
import { describeStandard, formatPdHours, type PdStandard } from '@/lib/pd-standards'

// The credential page IS the product: the URL on a LinkedIn profile, the link
// a verifier opens, the card a feed post shows. Private by default; the owner
// turns it on. Design: docs/PLAN-credentials-linkedin-2026-09-21.md §3.5.
//
// Never indexed (D4): a K-12 audience, and the value is in the link, not in
// search. LinkedIn's scraper ignores robots, so previews still render.
//
// The issued email links here with ?k=<token> (lib/credentials-link.ts), so a
// guardian with no Stellr login can see their child's private credential.
// No referrer, so the token never leaves in a Referer header.
//
// An admin viewing as a member opens this on the app host (proxy.ts keeps it
// there while the view-as cookie is set), so it resolves the member, not the
// admin, and carries the same banner as the portal.
export const dynamic = 'force-dynamic'

type Params = {
  params: Promise<{ number: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

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
    referrer: 'no-referrer',
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

export default async function CredentialPage({ params, searchParams }: Params) {
  const { number } = await params
  const key = (await searchParams)[FAMILY_LINK_PARAM]
  const db = supabaseServer()
  const cred = await getCredentialByNumber(db, number)
  if (!cred) notFound()

  const member = await getCurrentMember()
  const viewAs = await viewAsBannerProps(member)
  const banner = viewAs ? <ImpersonationBanner {...viewAs} /> : null
  const isOwner = !!member && !!cred.owner_member_id && member.id === cred.owner_member_id
  const state = credentialState(cred)

  // ── Withdrawn: the number still answers, the person is gone ─────────────
  if (state === 'withdrawn') {
    return (
      <Shell eyebrow="Credential" title="This credential has been withdrawn" banner={banner}>
        <p className="text-content-secondary leading-relaxed">
          Credential <span className="font-mono text-ink">{cred.number}</span> was issued by {cred.issuer} and has
          since been withdrawn at the holder&rsquo;s request. It is no longer valid.
        </p>
      </Shell>
    )
  }

  // ── Private: the holder has not turned it on ───────────────────────────
  // The emailed family link opens it read-only; anything else stops here.
  const familyView =
    cred.visibility === 'private' && !isOwner && verifyCredentialViewToken(cred.id, typeof key === 'string' ? key : null)
  if (cred.visibility === 'private' && !isOwner && !familyView) {
    return (
      <Shell eyebrow="Credential" title="This credential is private" banner={banner}>
        <p className="text-content-secondary leading-relaxed">
          Credential <span className="font-mono text-ink">{cred.number}</span>{' '}exists, but its holder has not made it
          public. If it&rsquo;s yours, sign in to Stellr to see it. If it&rsquo;s your child&rsquo;s, open it from the
          button in the email Stellr sent you.
        </p>
      </Shell>
    )
  }

  // A family view is not a verifier's view; only public opens are counted.
  if (!isOwner && !familyView) void recordCredentialEvent(db, cred.id, 'view')

  const consent = await shareConsentFor(db, cred)
  const share = canShare(cred, consent)
  const linkedInOk = canUseLinkedIn(cred.date_of_birth)
  const url = credentialUrl(cred.number)
  const gate = isOwner ? await certificateGateFor(db, member!.id, cred) : { gated: false as const }
  const { label, className, Icon } = STATE_BADGE[state]
  const pills = [cred.issuer, `Issued ${formatDate(cred.issued_at)}`]
  if (cred.role_label) pills.push(cred.role_label)
  if (cred.award) pills.push(cred.award)
  const pdHours = cred.source === 'pd' && cred.pd_hours ? Number(cred.pd_hours) : null
  if (pdHours) pills.push(`${formatPdHours(pdHours)} PD ${pdHours === 1 ? 'hour' : 'hours'}`)

  return (
    <>
      {banner}
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
            {familyView && (
              <div className="mb-8 flex gap-3 rounded-ds-card border border-line bg-white p-4 text-sm text-content-secondary">
                <Lock size={18} className="mt-0.5 shrink-0 text-content-muted" aria-hidden="true" />
                <p className="leading-relaxed">
                  This credential is private. You can see it because you opened the link in Stellr&rsquo;s email,
                  so please don&rsquo;t share that link.
                  {share.ok && (
                    <> To make it public, {cred.recipient_name.split(' ')[0]} signs in to Stellr and turns on sharing.</>
                  )}
                </p>
              </div>
            )}
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

            {pdHours && (
              <div className="mt-8">
                <Eyebrow>Professional development</Eyebrow>
                <p className="mt-2 text-content-secondary leading-relaxed">
                  {formatPdHours(pdHours)} {pdHours === 1 ? 'hour' : 'hours'}
                  {cred.activity_title && <> supporting {cred.activity_title}</>}
                  {cred.activity_date && <> on {formatDate(cred.activity_date)}</>}
                  {cred.activity_location && <>, {cred.activity_location}</>}.
                </p>
              </div>
            )}

            {cred.standards.length > 0 && (
              <div className="mt-8">
                <Eyebrow>Aligned to</Eyebrow>
                {groupStandards(cred.standards).map(([group, items]) => (
                  <div key={group} className="mt-3">
                    <p className="text-sm font-semibold text-ink">{group}</p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {items.map((s) => (
                        <li key={s.code} className="rounded-pill border border-line bg-white px-3 py-1 text-sm text-ink">
                          <span className="font-semibold">{s.code}</span>
                          {s.label && <span className="text-content-secondary"> · {s.label}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
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
                surveyFirst={gate.gated ? { href: gate.surveyUrl, eventTitle: gate.eventTitle } : null}
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
              {pdHours && <Row label="PD hours">{formatPdHours(pdHours)}</Row>}
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

function Shell({
  eyebrow,
  title,
  banner,
  children,
}: {
  eyebrow: string
  title: string
  banner: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <>
      {banner}
      <Hero breadcrumb={eyebrow} title={title} glow={false} />
      <section className="bg-surface section-padding">
        <div className="container-max max-w-content">{children}</div>
      </section>
    </>
  )
}

/** Stored codes under the headings the certificate back uses, in stored order. */
function groupStandards(codes: string[]): [string, PdStandard[]][] {
  const groups = new Map<string, PdStandard[]>()
  for (const s of codes.map(describeStandard)) groups.set(s.group, [...(groups.get(s.group) ?? []), s])
  return [...groups]
}
