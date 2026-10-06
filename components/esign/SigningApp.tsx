'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@stellr/web-ui'
import { disclosureParagraphs, DISCLOSURE_TITLE } from '@/lib/esign/disclosure'
import { PdfViewer } from './PdfViewer'
import { SignaturePad } from './SignaturePad'

// Stellr signing: the page a signer reaches from their emailed link.
//
// The link carries its key in the URL fragment (#…), which the browser never
// sends to a server. This page reads it once, exchanges it for a short session
// cookie, and removes it from the address bar and history.
//
// Steps: (verify) → agree to sign electronically → read the document → fill
// in your details → review and sign. Every step is announced to screen
// readers, works without a pointer, and nothing is final until "Sign".

interface Field { name: string; label: string; type: string; required: boolean; value: string }
interface View {
  documentTitle: string
  eventTitle: string | null
  roleLabel: string
  signerName: string
  disclosureVersion: string
  consented: boolean
  attestation: string | null
  fields: Field[]
  textHtml: string | null
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'verify'; documentLabel: string; aboutSigner: boolean; retry: boolean }
  | { kind: 'not_yet' }
  | { kind: 'already_signed'; completed: boolean }
  | { kind: 'ready'; view: View }
  | { kind: 'done'; complete: boolean }
  | { kind: 'declined' }

type Step = 'consent' | 'read' | 'details' | 'sign'

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data: data as Record<string, unknown> }
}

export function SigningApp() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  // Held in memory only (never stored): what renews the session if it expires mid-way.
  const tokenRef = useRef<string | null>(null)
  const yearRef = useRef<string | null>(null)

  const loadContext = useCallback(async () => {
    const res = await fetch('/api/sign/context', { cache: 'no-store', credentials: 'same-origin' })
    const data = await res.json().catch(() => ({}))
    if (data.state === 'ready') setPhase({ kind: 'ready', view: data.view })
    else if (data.state === 'signed') setPhase({ kind: 'done', complete: !!data.completed })
    else setPhase({ kind: 'invalid' })
  }, [])

  const renew = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return false
    const { data } = await post('/api/sign/session', { token, birthYear: yearRef.current ?? undefined })
    return data.state === 'ready'
  }, [])

  const openSession = useCallback(async (birthYear?: string) => {
    const token = tokenRef.current
    if (!token) return loadContext()
    const { data } = await post('/api/sign/session', { token, birthYear })
    // Only a year that was accepted is kept: a wrong one resent on renewal
    // would count against the link's five tries.
    if (data.state === 'ready' && birthYear) yearRef.current = birthYear
    switch (data.state) {
      case 'ready': return loadContext()
      case 'verify': return setPhase({ kind: 'verify', documentLabel: String(data.documentLabel ?? 'form'), aboutSigner: !!data.aboutSigner, retry: !!data.retry })
      case 'not_yet': return setPhase({ kind: 'not_yet' })
      case 'already_signed': return setPhase({ kind: 'already_signed', completed: !!data.completed })
      default: return setPhase({ kind: 'invalid' })
    }
  }, [loadContext])

  useEffect(() => {
    const take = () => {
      const hash = window.location.hash.slice(1)
      if (!hash) return false
      tokenRef.current = decodeURIComponent(hash)
      // The key leaves the address bar and the history entry straight away.
      window.history.replaceState(null, '', window.location.pathname)
      return true
    }
    take()
    void openSession()
    // A second link opened in this tab (a parent with two children) changes
    // only the fragment, so the page would otherwise stay on the first
    // document. Start again from the new link.
    const onHashChange = () => {
      if (!take()) return
      setPhase({ kind: 'loading' })
      void openSession()
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [openSession])

  return (
    <main className="min-h-screen bg-surface px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-2xl" aria-live="polite">
        {phase.kind === 'loading' && <p className="text-content-muted">Opening your document…</p>}
        {phase.kind === 'invalid' && <InvalidLink />}
        {phase.kind === 'verify' && (
          <VerifyYear documentLabel={phase.documentLabel} aboutSigner={phase.aboutSigner} retry={phase.retry} onSubmit={(y) => openSession(y)} />
        )}
        {phase.kind === 'not_yet' && (
          <Notice title="Not your turn yet">
            Someone else needs to sign this first. We&rsquo;ll email you as soon as it&rsquo;s ready for you.
          </Notice>
        )}
        {phase.kind === 'already_signed' && (
          <Notice title="Already signed">
            {`This document has been signed with this link. ${phase.completed
              ? 'We emailed you a link to download your signed copy.'
              : 'We’ll email you a link to your copy once everyone has signed.'}`}
          </Notice>
        )}
        {phase.kind === 'ready' && (
          <Signing
            view={phase.view}
            onDone={(complete) => setPhase({ kind: 'done', complete })}
            onDeclined={() => setPhase({ kind: 'declined' })}
            onLost={() => setPhase({ kind: 'invalid' })}
            onRenew={renew}
          />
        )}
        {phase.kind === 'done' && <Done complete={phase.complete} />}
        {phase.kind === 'declined' && (
          <Notice title="You declined to sign">
            We&rsquo;ve let the Stellr team know. If that was a mistake, or you&rsquo;d like to talk it through, email{' '}
            <a className="text-primary-deep underline" href="mailto:privacy@stellreducation.org">privacy@stellreducation.org</a>.
          </Notice>
        )}
      </div>
    </main>
  )
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-ds-card border border-line bg-white p-6 sm:p-8">
      <h1 className="font-display text-2xl font-bold text-ink">{title}</h1>
      <p className="mt-3 text-content-body">{children}</p>
    </section>
  )
}

function InvalidLink() {
  return (
    <Notice title="This link can’t be used">
      It may have expired, already been used, or been replaced by a newer one. Check your email for the most recent
      message from Stellr Education, or email{' '}
      <a className="text-primary-deep underline" href="mailto:privacy@stellreducation.org">privacy@stellreducation.org</a>{' '}
      and we&rsquo;ll send you a new link.
    </Notice>
  )
}

function VerifyYear({ documentLabel, aboutSigner, retry, onSubmit }: { documentLabel: string; aboutSigner: boolean; retry: boolean; onSubmit: (year: string) => void }) {
  const [year, setYear] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <section className="rounded-ds-card border border-line bg-white p-6 sm:p-8">
      <h1 className="font-display text-2xl font-bold text-ink">One quick check</h1>
      <p className="mt-3 text-content-body">
        {aboutSigner
          ? `To make sure this ${documentLabel} reached you, enter the year you were born.`
          : `This ${documentLabel} includes a young person’s details. To make sure it reached the right person, enter the year they were born.`}
      </p>
      <form
        className="mt-6 space-y-4"
        onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSubmit(year.trim()); setBusy(false) }}
      >
        <label className="block text-sm font-semibold text-ink" htmlFor="birth-year">Year of birth</label>
        <input
          id="birth-year"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]{4}"
          maxLength={4}
          required
          value={year}
          onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))}
          aria-describedby={retry ? 'birth-year-error' : undefined}
          className="w-32 rounded-control border border-line px-3 py-2 text-ink"
        />
        {retry && (
          <p id="birth-year-error" role="alert" className="text-sm text-danger">
            That doesn&rsquo;t match. Check the year and try again.
          </p>
        )}
        <div><Button variant="primaryStrong" type="submit" disabled={busy || year.length !== 4}>Continue</Button></div>
      </form>
    </section>
  )
}

function Signing({ view, onDone, onDeclined, onLost, onRenew }: {
  view: View
  onDone: (complete: boolean) => void
  onDeclined: () => void
  onLost: () => void
  /** Opens a fresh session from the link; false when the link no longer works. */
  onRenew: () => Promise<boolean>
}) {
  const [step, setStep] = useState<Step>(view.consented ? 'read' : 'consent')
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(view.fields.map((f) => [f.name, f.value])),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  /** The typed name, when it differs from the name on the form and needs confirming. */
  const [nameDiffers, setNameDiffers] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Move focus to each step's heading, so keyboard and screen-reader users
  // land at the start of what changed.
  useEffect(() => { headingRef.current?.focus() }, [step])

  useEffect(() => {
    if (step === 'read') void fetch('/api/sign/viewed', { method: 'POST', credentials: 'same-origin' })
  }, [step])

  const lost = (status: number) => { if (status === 404) { onLost(); return true } return false }

  // The session lasts 30 minutes. Someone who reads slowly must not lose their
  // place (WCAG 2.2.1): when it has run out, open a fresh one from the link
  // this page already holds, and try once more.
  async function call(path: string, body: unknown) {
    const first = await post(path, body)
    if (first.status !== 404 || !(await onRenew())) return first
    return post(path, body)
  }

  async function consent(attest: boolean) {
    setBusy(true); setMessage(null)
    const { ok, status, data } = await call('/api/sign/consent', { disclosureVersion: view.disclosureVersion, attest })
    setBusy(false)
    if (lost(status)) return
    if (!ok) return setMessage(String(data.error ?? 'Something went wrong. Please try again.'))
    setStep('read')
  }

  async function sign(signature: string, confirmDifferentName = false, image: string | null = null) {
    setBusy(true); setMessage(null); setErrors({}); setNameDiffers(null)
    const { ok, status, data } = await call('/api/sign/submit', { values, signature, confirmDifferentName, signatureImage: image })
    setBusy(false)
    if (lost(status)) return
    if (!ok || data.ok === false) {
      const fieldErrors = (data.fieldErrors ?? {}) as Record<string, string>
      setErrors(fieldErrors)
      if (data.error === 'name_differs') return setNameDiffers(signature)
      setMessage(String(data.error ?? 'Something went wrong. Please try again.'))
      if (Object.keys(fieldErrors).some((k) => k !== 'signature')) setStep('details')
      return
    }
    onDone(!!data.complete)
  }

  async function decline(reason: string) {
    setBusy(true)
    const { status } = await call('/api/sign/decline', { reason })
    setBusy(false)
    if (lost(status)) return
    onDeclined()
  }

  const steps: { id: Step; label: string }[] = [
    { id: 'consent', label: 'Agree to sign online' },
    { id: 'read', label: 'Read' },
    ...(view.fields.length ? [{ id: 'details' as Step, label: 'Your details' }] : []),
    { id: 'sign', label: 'Sign' },
  ]
  const index = steps.findIndex((s) => s.id === step)

  return (
    <div className="space-y-6">
      <header>
        <p className="font-subheading text-xs font-semibold uppercase tracking-[0.14em] text-primary-deep">Stellr signing</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-ink">{view.documentTitle}</h1>
        <p className="mt-1 text-content-muted">
          {view.eventTitle ? `${view.eventTitle} · ` : ''}Signing as {view.signerName} ({view.roleLabel.toLowerCase()})
        </p>
        <ol className="mt-4 flex flex-wrap gap-2 text-xs" aria-label="Steps">
          {steps.map((s, i) => (
            <li
              key={s.id}
              aria-current={i === index ? 'step' : undefined}
              className={`rounded-pill px-3 py-1 font-semibold ${i === index ? 'bg-primary-deep text-white' : i < index ? 'bg-primary-soft text-primary-deep' : 'bg-white text-content-muted border border-line'}`}
            >
              {i + 1}. {s.label}
            </li>
          ))}
        </ol>
      </header>

      {message && <p role="alert" className="rounded-control bg-white border border-danger px-4 py-3 text-sm text-danger">{message}</p>}

      <section className="rounded-ds-card border border-line bg-white p-6 sm:p-8">
        {step === 'consent' && (
          <ConsentStep headingRef={headingRef} disclosureVersion={view.disclosureVersion} attestation={view.attestation} busy={busy} onAgree={consent} />
        )}
        {step === 'read' && (
          <ReadStep
            headingRef={headingRef}
            textHtml={view.textHtml}
            onNext={() => setStep(view.fields.length ? 'details' : 'sign')}
          />
        )}
        {step === 'details' && (
          <DetailsStep
            headingRef={headingRef}
            fields={view.fields}
            values={values}
            errors={errors}
            onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))}
            onBack={() => setStep('read')}
            onNext={() => {
              const missing = Object.fromEntries(
                view.fields.filter((f) => f.required && f.type !== 'checkbox' && !values[f.name]?.trim()).map((f) => [f.name, `Enter ${f.label.toLowerCase()}.`]),
              )
              setErrors(missing)
              const first = Object.keys(missing)[0]
              // Take the signer to the first thing to fix (WCAG 3.3.1).
              if (first) requestAnimationFrame(() => document.getElementById(`field-${first}`)?.focus())
              else setStep('sign')
            }}
          />
        )}
        {step === 'sign' && (
          <SignStep
            headingRef={headingRef}
            view={view}
            values={values}
            busy={busy}
            error={errors.signature}
            nameDiffers={nameDiffers}
            onBack={() => setStep(view.fields.length ? 'details' : 'read')}
            onSign={sign}
          />
        )}
      </section>

      <DeclineLink busy={busy} onDecline={decline} />
    </div>
  )
}

type HeadingRef = React.RefObject<HTMLHeadingElement | null>

function StepHeading({ headingRef, children }: { headingRef: HeadingRef; children: React.ReactNode }) {
  return (
    <h2 ref={headingRef} tabIndex={-1} className="font-display text-xl font-bold text-ink outline-none">
      {children}
    </h2>
  )
}

function ConsentStep({ headingRef, disclosureVersion, attestation, busy, onAgree }: {
  disclosureVersion: string
  headingRef: HeadingRef
  attestation: string | null
  busy: boolean
  onAgree: (attest: boolean) => void
}) {
  const [agreed, setAgreed] = useState(false)
  const [attested, setAttested] = useState(false)
  return (
    <div className="space-y-4">
      <StepHeading headingRef={headingRef}>{DISCLOSURE_TITLE}</StepHeading>
      <div className="space-y-3 text-sm text-content-body">
        {disclosureParagraphs(disclosureVersion).map((p) => <p key={p.slice(0, 24)}>{p}</p>)}
        <p>
          <a className="text-primary-deep underline" href="/privacy" target="_blank" rel="noopener noreferrer">Read our Privacy Policy</a>
        </p>
      </div>
      <label className="flex items-start gap-3 text-sm text-ink">
        <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>I have read this and agree to receive and sign this document electronically.</span>
      </label>
      {attestation && (
        <label className="flex items-start gap-3 text-sm text-ink">
          <input type="checkbox" className="mt-1" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
          <span>{attestation} I understand that signing in someone else&rsquo;s name is not permitted.</span>
        </label>
      )}
      <Button
        variant="primaryStrong"
        disabled={busy || !agreed || (!!attestation && !attested)}
        onClick={() => onAgree(attested)}
        aria-describedby="consent-hint"
      >
        Continue
      </Button>
      {(!agreed || (!!attestation && !attested)) && (
        <p id="consent-hint" className="text-sm text-content-muted">
          {attestation ? 'Tick both boxes to continue.' : 'Tick the box to continue.'}
        </p>
      )}
    </div>
  )
}

function ReadStep({ headingRef, textHtml, onNext }: { headingRef: HeadingRef; textHtml: string | null; onNext: () => void }) {
  const [showText, setShowText] = useState(false)
  return (
    <div className="space-y-4">
      <StepHeading headingRef={headingRef}>Read the document</StepHeading>
      <p className="text-sm text-content-body">
        Please read it in full before you sign. Your details are already filled in where we have them; you can correct
        them in the next step.
      </p>
      <PdfViewer src="/api/sign/document" title="The document to sign" />
      {textHtml && (
        <div>
          <button type="button" className="text-sm text-primary-deep underline" onClick={() => setShowText((v) => !v)} aria-expanded={showText}>
            {`${showText ? 'Hide' : 'Show'} the text version`}
          </button>
          {showText && (
            // Sandboxed: the text is shown, nothing in it can run.
            <iframe title="Text version of the document" sandbox="" srcDoc={textHtml} className="mt-3 h-[60vh] w-full rounded-control border border-line" />
          )}
        </div>
      )}
      <Button variant="primaryStrong" onClick={onNext}>I&rsquo;ve read it — continue</Button>
    </div>
  )
}

function DetailsStep({ headingRef, fields, values, errors, onChange, onBack, onNext }: {
  headingRef: HeadingRef
  fields: Field[]
  values: Record<string, string>
  errors: Record<string, string>
  onChange: (name: string, value: string) => void
  onBack: () => void
  onNext: () => void
}) {
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); onNext() }} noValidate>
      <StepHeading headingRef={headingRef}>Your details and choices</StepHeading>
      {fields.some((f) => f.required && f.type !== 'checkbox') && (
        <p className="text-sm text-content-muted">Fields marked <span className="text-danger">*</span> are required.</p>
      )}
      {fields.map((f) => {
        const id = `field-${f.name}`
        const err = errors[f.name]
        if (f.type === 'checkbox') {
          return (
            <div key={f.name}>
              <label className="flex items-start gap-3 text-sm text-ink">
                <input
                  id={id}
                  type="checkbox"
                  className="mt-1"
                  checked={values[f.name] === 'true'}
                  onChange={(e) => onChange(f.name, e.target.checked ? 'true' : 'false')}
                  aria-describedby={err ? `${id}-error` : undefined}
                />
                <span>{f.label}</span>
              </label>
              {err && <p id={`${id}-error`} className="mt-1 text-sm text-danger">{err}</p>}
            </div>
          )
        }
        return (
          <div key={f.name}>
            <label htmlFor={id} className="block text-sm font-semibold text-ink">
              {f.label}{f.required && <span className="text-danger" aria-hidden> *</span>}
            </label>
            <input
              id={id}
              type={f.type === 'email' ? 'email' : 'text'}
              value={values[f.name] ?? ''}
              required={f.required}
              aria-invalid={!!err}
              aria-describedby={err ? `${id}-error` : undefined}
              onChange={(e) => onChange(f.name, e.target.value)}
              className="mt-1 w-full rounded-control border border-line px-3 py-2 text-ink"
            />
            {err && <p id={`${id}-error`} className="mt-1 text-sm text-danger">{err}</p>}
          </div>
        )
      })}
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondaryStrong" onClick={onBack}>Back</Button>
        <Button variant="primaryStrong" type="submit">Continue</Button>
      </div>
    </form>
  )
}

function SignStep({ headingRef, view, values, busy, error, nameDiffers, onBack, onSign }: {
  headingRef: HeadingRef
  view: View
  values: Record<string, string>
  busy: boolean
  error?: string
  /** Set when the typed name differs from the one on the form. */
  nameDiffers: string | null
  onBack: () => void
  onSign: (signature: string, confirmDifferentName?: boolean, image?: string | null) => void
}) {
  const [signature, setSignature] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [mode, setMode] = useState<'type' | 'draw'>('type')
  const [drawing, setDrawing] = useState<string | null>(null)
  const image = mode === 'draw' ? drawing : null
  const ready = confirmed && signature.trim().length >= 2 && (mode === 'type' || !!drawing)
  const hint = signature.trim().length < 2
    ? 'Type your full name and tick the box to sign.'
    : mode === 'draw' && !drawing ? 'Draw your signature in the box, or choose to type it.' : 'Tick the box to sign.'
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); onSign(signature, false, image) }}>
      <StepHeading headingRef={headingRef}>Review and sign</StepHeading>
      {view.fields.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {view.fields.map((f) => (
            <div key={f.name}>
              <dt className="text-content-muted">{f.label}</dt>
              <dd className="font-semibold text-ink">
                {f.type === 'checkbox' ? (values[f.name] === 'true' ? 'Yes' : 'No') : values[f.name] || '—'}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-ink">How would you like to sign?</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink">
          <label className="flex items-center gap-2">
            <input type="radio" name="sign-mode" checked={mode === 'type'} onChange={() => setMode('type')} />
            Type my name
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="sign-mode" checked={mode === 'draw'} onChange={() => setMode('draw')} />
            Draw my signature
          </label>
        </div>
      </fieldset>
      {mode === 'draw' && (
        <div>
          <p id="pad-hint" className="mb-2 text-sm text-content-muted">
            Draw with your finger, a pen or the mouse. Only the finished picture is kept.
          </p>
          <SignaturePad onChange={setDrawing} describedBy="pad-hint" />
        </div>
      )}
      <div>
        <label htmlFor="signature" className="block text-sm font-semibold text-ink">
          {mode === 'draw' ? 'Type your full name as well' : 'Type your full name to sign'}
        </label>
        <input
          id="signature"
          autoComplete="name"
          value={signature}
          maxLength={120}
          onChange={(e) => setSignature(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? 'signature-error' : 'signature-hint'}
          className="mt-1 w-full rounded-control border border-line px-3 py-2 font-display text-xl text-ink"
          placeholder={view.signerName}
        />
        <p id="signature-hint" className="mt-1 text-xs text-content-muted">
          {mode === 'draw'
            ? 'Your name goes on the signing record beside your drawn signature.'
            : 'This is your legal signature on the document.'}
        </p>
        {error && <p id="signature-error" className="mt-1 text-sm text-danger">{error}</p>}
        {nameDiffers && nameDiffers === signature && (
          <div className="mt-3 space-y-2 rounded-control border border-line bg-surface p-3 text-sm text-ink">
            <p>
              {`If your name is spelled differently from the form, you can sign as “${nameDiffers}”. Only sign if you are ${view.signerName}; signing in someone else’s name is not permitted.`}
            </p>
            <Button type="button" variant="secondaryStrong" disabled={busy} onClick={() => onSign(signature, true, image)}>
              {`Sign as “${nameDiffers}”`}
            </Button>
          </div>
        )}
      </div>
      <label className="flex items-start gap-3 text-sm text-ink">
        <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>I have read the {view.documentTitle} and agree to it. I am signing it electronically as {view.signerName}.</span>
      </label>
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondaryStrong" onClick={onBack} disabled={busy}>Back</Button>
        <Button variant="primaryStrong" type="submit" disabled={busy || !ready} aria-describedby={ready ? undefined : 'sign-hint'}>
          {busy ? 'Signing…' : 'Sign'}
        </Button>
      </div>
      {!ready && <p id="sign-hint" className="text-sm text-content-muted">{hint}</p>}
    </form>
  )
}

function DeclineLink({ busy, onDecline }: { busy: boolean; onDecline: (reason: string) => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  if (!open) {
    return (
      <p className="text-sm text-content-muted">
        Don&rsquo;t want to sign?{' '}
        <button type="button" className="text-primary-deep underline" onClick={() => setOpen(true)}>Decline instead</button>{' '}
        or ask for a paper copy at{' '}
        <a className="text-primary-deep underline" href="mailto:privacy@stellreducation.org">privacy@stellreducation.org</a>.
      </p>
    )
  }
  return (
    <form
      className="space-y-3 rounded-ds-card border border-line bg-white p-5"
      onSubmit={(e) => { e.preventDefault(); onDecline(reason) }}
    >
      <label htmlFor="decline-reason" className="block text-sm font-semibold text-ink">Why are you declining? (optional)</label>
      <textarea
        id="decline-reason"
        value={reason}
        maxLength={500}
        onChange={(e) => setReason(e.target.value)}
        className="w-full rounded-control border border-line px-3 py-2 text-ink"
        rows={3}
      />
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondaryStrong" onClick={() => setOpen(false)}>Keep signing</Button>
        <Button type="submit" variant="softAmber" disabled={busy}>Decline to sign</Button>
      </div>
    </form>
  )
}

function Done({ complete }: { complete: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function download() {
    setBusy(true); setError(null)
    const { ok, data } = await post('/api/sign/copy', {})
    setBusy(false)
    if (!ok) return setError(String(data.message ?? data.error ?? 'Your copy is not ready yet. Try again in a minute.'))
    const a = document.createElement('a')
    a.href = String(data.url)
    a.rel = 'noopener noreferrer'
    a.click()
  }
  return (
    <section className="rounded-ds-card border border-line bg-white p-6 sm:p-8">
      <h1 className="font-display text-2xl font-bold text-ink">Signed. Thank you.</h1>
      <p className="mt-3 text-content-body">
        {complete
          ? 'Everyone has signed. We’ve emailed you a link to your copy, and you can download it now.'
          : 'We’ll email you a link to your copy once everyone has signed.'}
      </p>
      {complete && (
        <div className="mt-6">
          <Button variant="primaryStrong" onClick={download} disabled={busy}>{busy ? 'Preparing…' : 'Download your signed copy'}</Button>
          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        </div>
      )}
    </section>
  )
}
