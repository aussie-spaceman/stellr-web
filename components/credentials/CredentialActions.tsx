'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Linkedin, Share2, Copy, Check, FileDown, Eye, EyeOff, Info } from 'lucide-react'
import { Button, Eyebrow } from '@stellr/web-ui'
import { pushDataLayer } from '@/lib/analytics'
import type { CredentialVisibility, ShareBlock, CredentialEventKind } from '@/lib/credentials-core'

// Owner-only action bar on the credential page. Everything a badge platform
// puts in its "share" modal, without the modal: visibility, the two LinkedIn
// links, the details to type by hand, copy link, PDF.

const BLOCK_COPY: Record<ShareBlock, string> = {
  revoked:          'This credential has been revoked, so it can no longer be shared.',
  withdrawn:        'This credential has been withdrawn.',
  expired:          'This credential has expired, so it can no longer be shared.',
  minor_no_consent: 'Sharing needs a signed Stellr consent form on file. It is part of the paperwork for your next Stellr event — nothing extra to do.',
  minor_declined:   'Your parent or guardian has asked that this stay private. If that changes, they can email privacy@stellreducation.org.',
}

interface Props {
  number: string
  url: string
  visibility: CredentialVisibility
  /** Why the credential cannot be made public, or null when it can. */
  shareBlock: ShareBlock | null
  /** Age gate (16+) for the LinkedIn buttons, separate from consent. */
  linkedInOk: boolean
  addToProfileUrl: string
  shareUrl: string
  manual: { name: string; organization: string; issueDate: string; credentialId: string; credentialUrl: string }
}

export function CredentialActions(p: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'link' | 'details' | null>(null)
  const [showManual, setShowManual] = useState(false)

  const isPublic = p.visibility === 'public'

  function track(kind: CredentialEventKind) {
    pushDataLayer({ event: 'credential_share', share_kind: kind })
    void fetch(`/api/credentials/${encodeURIComponent(p.number)}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind }),
      keepalive: true,
    }).catch(() => {})
  }

  function setVisibility(next: CredentialVisibility) {
    setError(null)
    start(async () => {
      const res = await fetch(`/api/credentials/${encodeURIComponent(p.number)}/visibility`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ visibility: next }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? 'Could not update visibility.')
        return
      }
      router.refresh()
    })
  }

  async function copy(text: string, what: 'link' | 'details') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(null), 2000)
      if (what === 'link') track('copy_link')
    } catch {
      setError('Copy failed — select the text and copy it by hand.')
    }
  }

  const manualText = [
    `Name: ${p.manual.name}`,
    `Issuing organization: ${p.manual.organization}`,
    `Issue date: ${p.manual.issueDate}`,
    `Credential ID: ${p.manual.credentialId}`,
    `Credential URL: ${p.manual.credentialUrl}`,
  ].join('\n')

  return (
    <div className="mt-10 rounded-ds-card border border-line bg-white p-6">
      <Eyebrow>Your credential</Eyebrow>

      {/* ── Visibility ────────────────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-ink">
          {isPublic ? <Eye size={16} className="text-enviro-green-text" aria-hidden="true" /> : <EyeOff size={16} className="text-content-muted" aria-hidden="true" />}
          <span className="font-semibold">{isPublic ? 'Public' : 'Private'}</span>
          <span className="text-content-muted">
            {isPublic ? '— anyone with the link can see it.' : '— only you can see it.'}
          </span>
        </div>
        {p.shareBlock ? null : (
          <Button
            variant={isPublic ? 'secondary' : 'primary'}
            className="!px-4 !py-2"
            disabled={pending}
            onClick={() => setVisibility(isPublic ? 'private' : 'public')}
          >
            {pending ? 'Saving…' : isPublic ? 'Make private' : 'Make public'}
          </Button>
        )}
      </div>
      {p.shareBlock && (
        <p className="mt-3 flex gap-2 text-sm text-content-secondary">
          <Info size={16} className="shrink-0 mt-0.5 text-content-muted" aria-hidden="true" />
          {BLOCK_COPY[p.shareBlock]}
        </p>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <p className="mt-3 text-xs text-content-muted">
        Public pages show your name, the credential, and the issue date. Once you add a credential
        to LinkedIn or share it there, LinkedIn&rsquo;s terms apply and we can&rsquo;t remove it for
        you — making this page private changes it here only.{' '}
        <a href="/privacy#credentials" className="underline hover:text-ink">How credentials are shared</a>
      </p>

      {/* ── Share ─────────────────────────────────────────────────────── */}
      {isPublic && (
        <div className="mt-6 border-t border-line-light pt-6">
          <div className="flex flex-wrap gap-3">
            {p.linkedInOk && (
              <>
                <Button
                  href={p.addToProfileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="!px-4 !py-2"
                  onClick={() => track('linkedin_add')}
                >
                  <Linkedin size={16} aria-hidden="true" />
                  Add to LinkedIn profile
                </Button>
                <Button
                  variant="secondary"
                  href={p.shareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="!px-4 !py-2"
                  onClick={() => track('linkedin_share')}
                >
                  <Share2 size={16} aria-hidden="true" />
                  Share on LinkedIn
                </Button>
              </>
            )}
            <Button variant="softBlue" className="!py-2" onClick={() => copy(p.url, 'link')}>
              {copied === 'link' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              {copied === 'link' ? 'Copied' : 'Copy link'}
            </Button>
            <Button variant="softBlue" className="!py-2" href={`/api/credentials/${encodeURIComponent(p.number)}/pdf`}>
              <FileDown size={16} aria-hidden="true" />
              Download PDF
            </Button>
          </div>

          {p.linkedInOk ? (
            <div className="mt-5">
              <button
                type="button"
                className="text-sm font-semibold text-primary hover:underline"
                onClick={() => setShowManual((v) => !v)}
                aria-expanded={showManual}
              >
                {showManual ? 'Hide the details' : 'LinkedIn didn’t fill in the form? Show the details to type'}
              </button>
              {showManual && (
                <div className="mt-3 rounded-lg border border-line bg-surface p-4">
                  <dl className="grid gap-2 text-sm sm:grid-cols-[180px_1fr]">
                    <dt className="text-content-muted">Name</dt><dd className="text-ink">{p.manual.name}</dd>
                    <dt className="text-content-muted">Issuing organization</dt><dd className="text-ink">{p.manual.organization}</dd>
                    <dt className="text-content-muted">Issue date</dt><dd className="text-ink">{p.manual.issueDate}</dd>
                    <dt className="text-content-muted">Credential ID</dt><dd className="font-mono text-ink">{p.manual.credentialId}</dd>
                    <dt className="text-content-muted">Credential URL</dt><dd className="break-all text-ink">{p.manual.credentialUrl}</dd>
                  </dl>
                  <button
                    type="button"
                    className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                    onClick={() => copy(manualText, 'details')}
                  >
                    {copied === 'details' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                    {copied === 'details' ? 'Copied' : 'Copy all'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-content-muted">
              LinkedIn is for members aged 16 and over. Until then, the link and the PDF are yours to share.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
