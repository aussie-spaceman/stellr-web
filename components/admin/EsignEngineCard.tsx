'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge, Button } from '@stellr/web-ui'
import { formatDateShort } from '@/lib/utils'
import type { EngineSummary } from '@/lib/esign/state'

// Admin → Consent forms: which signing engine new agreements go to, how much
// of DocuSign's monthly allowance is used, and the health of the signed-record
// archive. The mode switch is the safety valve: "DocuSign only" turns the
// in-app engine off entirely.

const MODE_LABEL: Record<EngineSummary['state']['mode'], string> = {
  docusign_only: 'DocuSign only',
  auto: 'DocuSign, then Stellr when the allowance runs out',
  overflow_only: 'Stellr signing only',
}

const TYPE_LABEL: Record<string, string> = {
  minor: 'Parental consent',
  adult: 'Adult participation',
  mentor: 'Mentor',
  volunteer: 'Volunteer',
  membership: 'Membership',
}

export function EsignEngineCard() {
  const [summary, setSummary] = useState<EngineSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/esign/state', { cache: 'no-store' })
    if (res.ok) setSummary(await res.json())
    else setMsg({ text: 'Could not load the signing engine settings.', error: true })
  }, [])

  useEffect(() => { void load() }, [load])

  async function patch(body: Record<string, unknown>, done: string) {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/esign/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Update failed')
      setSummary(data)
      setMsg({ text: done, error: false })
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Update failed', error: true })
    } finally {
      setBusy(false)
    }
  }

  async function runMaintenance(dryRun: boolean) {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/esign/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Maintenance failed')
      const archive = data.archive as { eligible?: number; archived?: number; failed?: unknown[]; error?: string } | undefined
      const text = archive?.error
        ? `Archive step failed: ${archive.error}`
        : dryRun
          ? `${archive?.eligible ?? 0} signed document(s) waiting to be stored. Nothing was changed.`
          : `Stored ${archive?.archived ?? 0} of ${archive?.eligible ?? 0} signed document(s)${archive?.failed?.length ? `; ${archive.failed.length} failed` : ''}.`
      setMsg({ text, error: Boolean(archive?.error || archive?.failed?.length) })
      await load()
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Maintenance failed', error: true })
    } finally {
      setBusy(false)
    }
  }

  async function membershipBackfill(dryRun: boolean) {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/esign/membership-backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, limit: 25 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setMsg({
        text: dryRun
          ? `${data.outstanding} of ${data.candidates} members have no membership agreement signed or on its way.`
          : `Sent ${data.issued} membership agreement${data.issued === 1 ? '' : 's'}; ${Math.max(0, data.outstanding - data.issued)} still to go. Emails go out within the daily signing budget.`,
        error: false,
      })
      if (!dryRun) await load()
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Failed', error: true })
    } finally {
      setBusy(false)
    }
  }

  if (!summary) {
    return (
      <section className="rounded-xl border border-line bg-white p-5 text-sm text-content-muted">
        {msg?.text ?? 'Loading signing engine…'}
      </section>
    )
  }

  const { state } = summary
  const exhausted = !!state.exhaustedUntil && new Date(state.exhaustedUntil) > new Date()
  const remaining = Math.max(0, summary.usableAllowance - summary.estimatedUsed)
  const accountReported = state.accountSent !== null && state.accountSyncedAt

  return (
    <section className="rounded-xl border border-line bg-white p-5 space-y-4" aria-labelledby="esign-engine-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="esign-engine-heading" className="font-heading text-lg font-semibold text-ink">E-signature engine</h2>
          <p className="text-sm text-content-muted mt-0.5">
            New agreements are going to{' '}
            <strong className="text-ink">{summary.currentEngine === 'docusign' ? 'DocuSign' : 'Stellr signing'}</strong>.
          </p>
        </div>
        {exhausted ? (
          <Badge className="bg-pathway-amber-bg text-brand-gold-ink">
            DocuSign allowance used up until {formatDateShort(state.exhaustedUntil as string)}
          </Badge>
        ) : (
          <Badge>{remaining} DocuSign envelope{remaining === 1 ? '' : 's'} left this period</Badge>
        )}
      </div>

      {!summary.nativeAvailable && (
        <p className="text-sm text-content-muted">
          Stellr signing is not switched on in this deployment yet, so every agreement uses DocuSign.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-content-muted">Used this period</dt>
          <dd className="font-semibold text-ink">
            {summary.estimatedUsed} of {summary.usableAllowance + state.reserve}
          </dd>
        </div>
        <div>
          <dt className="text-content-muted">Period</dt>
          <dd className="text-ink">
            {formatDateShort(summary.periodStart)}
            {state.accountPeriodEnd ? ` to ${formatDateShort(state.accountPeriodEnd)}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-content-muted">DocuSign&rsquo;s own count</dt>
          <dd className="text-ink">
            {accountReported
              ? `${state.accountSent} sent (read ${formatDateShort(state.accountSyncedAt as string)})`
              : 'Not read yet'}
          </dd>
        </div>
        <div>
          <dt className="text-content-muted">Signed copies stored here</dt>
          <dd className="text-ink">
            {summary.storage.documents}
            {summary.archive.unarchived > 0 && (
              <span className="text-brand-gold-ink"> ({summary.archive.unarchived} waiting)</span>
            )}
          </dd>
        </div>
      </dl>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-content-muted">Signing emails waiting</dt>
          <dd className={summary.outbox.waiting > summary.outbox.dailyBudget ? 'font-semibold text-danger' : 'text-ink'}>
            {summary.outbox.waiting}
            {summary.outbox.waiting > 0 && ` (sends up to ${summary.outbox.dailyBudget} a day)`}
          </dd>
        </div>
        <div>
          <dt className="text-content-muted">Off-site backup</dt>
          <dd className={summary.backup.configured ? 'text-ink' : 'font-semibold text-danger'}>
            {summary.backup.configured
              ? summary.backup.unreplicated > 0 ? `${summary.backup.unreplicated} waiting to be copied` : 'Up to date'
              : 'Not set up'}
          </dd>
        </div>
        <div>
          <dt className="text-content-muted">Storage used</dt>
          <dd className="text-ink">
            {(summary.storage.bytes / 1024 ** 2).toFixed(1)} of {(summary.storage.limitBytes / 1024 ** 2).toFixed(0)} MB
          </dd>
        </div>
        <div>
          <dt className="text-content-muted">Kept after deletion requests</dt>
          <dd className="text-ink">{summary.restricted}</dd>
        </div>
      </dl>

      {!summary.backup.configured && (
        <p className="text-sm text-danger" role="status">
          Signed records have no off-site copy, and the database has no backups on the current plan. Set
          ESIGN_BACKUP_KEY and ESIGN_BACKUP_DRIVE_FOLDER_ID.
        </p>
      )}

      {summary.outbox.waiting > summary.outbox.dailyBudget && (
        <p className="text-sm text-danger" role="status">
          {`More signing emails are waiting than can go out today. Families will get their links over the next ${Math.ceil(summary.outbox.waiting / Math.max(1, summary.outbox.dailyBudget))} days, or sooner from their account if they have one.`}
        </p>
      )}

      {summary.storage.warn && (
        <p className="text-sm text-danger" role="status">
          Signed records use {(summary.storage.bytes / 1024 ** 2).toFixed(0)} MB of the{' '}
          {(summary.storage.limitBytes / 1024 ** 2).toFixed(0)} MB storage plan. Upgrade the Supabase plan before it fills.
        </p>
      )}

      {summary.archive.failing > 0 && (
        <p className="text-sm text-danger" role="status">
          {`${summary.archive.failing} signed document(s) could not be stored yet. They are retried daily.`}
        </p>
      )}

      <fieldset className="space-y-2" disabled={busy}>
        <legend className="text-sm font-semibold text-ink">Where new agreements go</legend>
        {(Object.keys(MODE_LABEL) as (keyof typeof MODE_LABEL)[]).map((mode) => (
          <label key={mode} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="esign-mode"
              checked={state.mode === mode}
              onChange={() => patch({ mode }, `New agreements now go to: ${MODE_LABEL[mode]}.`)}
            />
            {MODE_LABEL[mode]}
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-2" disabled={busy || state.mode === 'docusign_only'}>
        <legend className="text-sm font-semibold text-ink">Agreements Stellr signing may take</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {Object.entries(TYPE_LABEL).map(([type, label]) => {
            const on = state.overflowTypes.includes(type)
            return (
              <label key={type} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={type === 'membership'}
                  onChange={() => {
                    const next = on ? state.overflowTypes.filter((t) => t !== type) : [...state.overflowTypes, type]
                    void patch({ overflowTypes: next }, `${label} agreements ${on ? 'stay on DocuSign' : 'may now use Stellr signing'}.`)
                  }}
                />
                {label}
              </label>
            )
          })}
        </div>
        <p className="text-xs text-content-muted">The membership agreement always uses Stellr signing.</p>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        {exhausted && (
          <Button
            variant="softAmber"
            disabled={busy}
            onClick={() => patch({ clearExhausted: true }, 'DocuSign will be tried again for the next agreement.')}
          >
            Try DocuSign again
          </Button>
        )}
        <Button variant="softBlue" disabled={busy} onClick={() => runMaintenance(true)}>
          Check for unstored documents
        </Button>
        <Button variant="softBlue" disabled={busy} onClick={() => runMaintenance(false)}>
          Store signed documents now
        </Button>
        {summary.nativeAvailable && (
          <>
            <Button variant="softBlue" disabled={busy} onClick={() => membershipBackfill(true)}>
              Members without a membership agreement
            </Button>
            <Button variant="softBlue" disabled={busy} onClick={() => membershipBackfill(false)}>
              Send it to the next 25
            </Button>
          </>
        )}
      </div>

      {msg && (
        <p className={`text-sm ${msg.error ? 'text-danger' : 'text-ink'}`} role="status">{msg.text}</p>
      )}
    </section>
  )
}
