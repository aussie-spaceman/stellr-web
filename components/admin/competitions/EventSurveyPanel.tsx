'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import type { AdminSurveyView, CompletionRow } from '@/lib/survey/admin'
import { versionName } from '@/lib/survey/definition'
import { formatDateInZone, formatInZone, zonedTimeToUtc } from '@/lib/survey/timezone'

// The event's "Survey" tab (handover A1/A2): when the post-event survey goes
// live and closes, who it will reach, bringing it forward, pausing or closing
// it, per-person progress with resend, exports (admins) and the event-day QR.

type View = AdminSurveyView & { isAdmin: boolean }

const STATUS: Record<string, { label: string; className: string }> = {
  scheduled: { label: 'Scheduled', className: 'bg-primary-soft text-primary' },
  open: { label: 'Open', className: 'bg-enviro-green-bg text-enviro-green-text' },
  paused: { label: 'Paused', className: 'bg-pathway-amber-bg text-brand-gold-ink' },
  closed: { label: 'Closed', className: 'bg-brand-hairline text-brand-muted' },
}

const ROLE_LABEL: Record<string, string> = { student: 'Students', mentor: 'Mentors', adult: 'Adults' }
const DAY = 86_400_000

function when(iso: string | null | undefined, tz: string) {
  return iso ? formatInZone(iso, tz) : '—'
}

export function EventSurveyPanel({ eventSlug, appUrl }: { eventSlug: string; appUrl: string }) {
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [goLive, setGoLive] = useState('')
  const [confirm, setConfirm] = useState<null | { kind: 'send_now' | 'set_go_live' | 'close'; opensAt?: Date }>(null)
  const [confirmGate, setConfirmGate] = useState(false)
  const [acceptOlder, setAcceptOlder] = useState(false)
  const [confirmLate, setConfirmLate] = useState(false)
  const [confirmOverride, setConfirmOverride] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const api = `/api/admin/events/${eventSlug}/survey`

  const load = useCallback(async () => {
    const res = await fetch(api, { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) setError(data.error ?? 'Could not load the survey.')
    else setView(data as View)
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const qrUrl = `${appUrl}/survey/event/${eventSlug}`
  useEffect(() => {
    QRCode.toDataURL(qrUrl, { width: 480, margin: 1 }).then(setQr).catch(() => setQr(null))
  }, [qrUrl])

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setError(data.error ?? 'That didn’t work.')
      else {
        if (data.run) setNotice(`Survey is live: ${data.run.newInvitations} invitations created, ${data.run.tally.invited} sent${data.run.tally.deferred ? `, ${data.run.tally.deferred} queued for tomorrow` : ''}.`)
        else if (data.warning) setNotice(`Survey is live. Invitations will go out on the next run (${data.warning}).`)
        else setNotice('Saved.')
        await load()
      }
    } finally {
      setBusy(null)
      setConfirm(null)
      setConfirmGate(false)
      setConfirmLate(false)
      setConfirmOverride(false)
    }
  }

  const d = view?.distribution
  const tz = d?.event_time_zone ?? 'America/Denver'

  const proposed = useMemo(() => (goLive ? new Date(goLive) : null), [goLive])

  if (error && !view) return <p className="text-sm text-danger">{error}</p>
  if (!view) return <p className="text-sm text-brand-muted-soft">Loading the survey…</p>
  if (!d) {
    const late = view.lateOpen
    if (!late) {
      return (
        <div className="rounded-xl border border-dashed border-brand-border bg-white px-4 py-6 text-sm text-brand-muted-soft">
          No survey is scheduled for this event ({view.reason}). Surveys are scheduled automatically for upcoming dated events once a survey definition is published.
        </div>
      )
    }
    const lateTz = late.timeZone
    const invitable = acceptOlder ? late.invitable : late.invitable - late.olderAgreements
    return (
      <section className="space-y-3 rounded-xl border border-brand-border bg-white p-4" aria-labelledby="survey-late-heading">
        <h2 id="survey-late-heading" className="text-sm font-semibold uppercase tracking-wide text-brand-muted">Post-event survey</h2>
        <p className="text-sm text-ink">
          This event ended on {formatDateInZone(zonedTimeToUtc(late.lastDay, lateTz, 12), lateTz)} without a survey. You can open one until <strong>{when(late.deadline, lateTz)}</strong>. It stays open for 30 days from when you open it.
        </p>
        {!view.isAdmin ? (
          <p className="text-sm text-brand-muted-soft">Ask an admin to open it.</p>
        ) : (
          <>
            <p className="text-sm text-brand-muted">
              {invitable === 1 ? '1 person' : `${invitable} people`} will be invited: {late.byRole.student - (acceptOlder ? 0 : late.olderAgreements)} students, {late.byRole.mentor} mentors, {late.byRole.adult} adults.
            </p>
            {late.olderAgreements > 0 && (
              <label className="flex items-start gap-2 text-sm text-ink">
                <input type="checkbox" className="mt-1" checked={acceptOlder} disabled={!!busy} onChange={(e) => setAcceptOlder(e.target.checked)} />
                <span>
                  Also invite the {late.olderAgreements} minors whose agreement was signed before V2.3
                  <span className="block text-xs text-brand-muted-soft">
                    For this event only. Their answers are never quotable, because quoting needs V2.3. The change is logged.
                  </span>
                </span>
              </label>
            )}
            {late.awaitingConsent > 0 && (
              <p className="text-xs text-brand-muted-soft">{late.awaitingConsent} minors have no valid signed agreement and won’t be invited.</p>
            )}
            {notice && <p role="status" className="text-sm text-enviro-green-text">{notice}</p>}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            {!confirmLate ? (
              <button type="button" className="rounded-lg bg-brand-blue px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60" disabled={!!busy} onClick={() => setConfirmLate(true)}>
                Open survey now
              </button>
            ) : (
              <div role="dialog" aria-modal="false" className="rounded-xl border border-brand-border bg-white p-4 shadow-card">
                <p className="text-sm text-ink">
                  Open the survey now and email {invitable === 1 ? '1 person' : `${invitable} people`}. It will close <strong>{when(late.closesIfOpenedNow, lateTz)}</strong>.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-brand-blue px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                    disabled={!!busy}
                    onClick={() => void act('open_after_event', { acceptOlderMinorAgreements: acceptOlder && late.olderAgreements > 0 })}
                  >
                    {busy ? 'Working…' : 'Confirm'}
                  </button>
                  <button type="button" className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-sm text-brand-muted" onClick={() => setConfirmLate(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    )
  }

  const status = view.status ?? d.status
  const pill = STATUS[status]
  const auto = view.autoOpensAt ? new Date(view.autoOpensAt) : null

  return (
    <div className="space-y-8">
      {/* Schedule */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-muted">Post-event survey</h2>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${pill.className}`}>{pill.label}</span>
          {view.definition && (
            <a className="text-xs text-brand-muted-soft underline hover:text-primary" href={`/admin/surveys/questions?id=${d.definition_id}`}>
              {view.definition.key} {versionName(view.definition.version, view.definition.versionLabel)}
              {view.definition.status === 'draft' && ' (draft — dev only)'}
            </a>
          )}
        </div>
        {d.schedule_flag === 'event_date_changed' && (
          <p className="rounded-lg bg-pathway-amber-bg px-3 py-2 text-sm text-brand-gold-ink">
            The event date changed after go-live was set by hand. The manual time was kept: check it, or reset to automatic.
          </p>
        )}
        {d.schedule_flag === 'event_cancelled' && (
          <p className="rounded-lg bg-pathway-amber-bg px-3 py-2 text-sm text-brand-gold-ink">The event is marked cancelled in Sanity, so the survey is paused.</p>
        )}
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-brand-border bg-white p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Goes live</dt>
            <dd className="mt-1 text-sm font-semibold text-ink">{when(d.opens_at, tz)}</dd>
            <dd className="mt-1 text-xs text-brand-muted-soft">
              {d.opens_at_source === 'manual' ? `Set by hand${d.opens_at_set_at ? ` on ${when(d.opens_at_set_at, tz)}` : ''}` : 'Automatic: 00:00 on the event’s last day'}
            </dd>
          </div>
          <div className="rounded-xl border border-brand-border bg-white p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Closes</dt>
            <dd className="mt-1 text-sm font-semibold text-ink">{d.closed_at && status === 'closed' ? when(d.closed_at, tz) : when(d.closes_at, tz)}</dd>
            <dd className="mt-1 text-xs text-brand-muted-soft">{d.closed_by && d.closed_by !== 'system:clock' ? 'Closed early' : '30 days after go-live'}</dd>
          </div>
          <div className="rounded-xl border border-brand-border bg-white p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Time zone</dt>
            <dd className="mt-1 text-sm font-semibold text-ink">{tz}</dd>
            <dd className="mt-1 text-xs text-brand-muted-soft">From the event’s state</dd>
          </div>
        </dl>

        {notice && <p role="status" className="text-sm text-enviro-green-text">{notice}</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}

        <div className="flex flex-wrap items-end gap-3">
          {status === 'scheduled' && (
            <>
              <button type="button" className="rounded-lg bg-brand-blue px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60" disabled={!!busy} onClick={() => setConfirm({ kind: 'send_now', opensAt: new Date() })}>
                Send live now
              </button>
              <label className="text-sm text-brand-muted">
                <span className="block text-xs">Earlier go-live (your local time)</span>
                <input
                  type="datetime-local"
                  className="mt-1 rounded-lg border border-brand-border px-2 py-1 text-sm"
                  value={goLive}
                  max={auto ? new Date(auto.getTime() - auto.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : undefined}
                  onChange={(e) => setGoLive(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-sm text-brand-muted disabled:opacity-60"
                disabled={!proposed || !!busy}
                onClick={() => proposed && setConfirm({ kind: 'set_go_live', opensAt: proposed })}
              >
                Set go-live
              </button>
              {d.opens_at_source === 'manual' && (
                <button type="button" className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-sm text-brand-muted" disabled={!!busy} onClick={() => void act('reset_go_live')}>
                  Reset to automatic
                </button>
              )}
              <button type="button" className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-sm text-brand-muted" disabled={!!busy} onClick={() => void act('pause')}>
                Pause
              </button>
            </>
          )}
          {status === 'paused' && (
            <button type="button" className="rounded-lg bg-brand-blue px-3 py-1.5 text-sm font-medium text-white" disabled={!!busy} onClick={() => void act('resume')}>
              Resume schedule
            </button>
          )}
          {status !== 'closed' && (
            <button type="button" className="rounded-lg border border-danger bg-white px-3 py-1.5 text-sm text-danger" disabled={!!busy} onClick={() => setConfirm({ kind: 'close' })}>
              Close survey
            </button>
          )}
        </div>

        {confirm && (
          <div role="dialog" aria-modal="false" className="rounded-xl border border-brand-border bg-white p-4 shadow-card">
            {confirm.kind === 'close' ? (
              <p className="text-sm text-ink">Close the survey now? Nobody will be able to answer, and no more reminders go out. This can’t be undone.</p>
            ) : (
              <p className="text-sm text-ink">
                {confirm.kind === 'send_now' ? 'Open the survey now and email everyone invitable.' : `Go live ${when(confirm.opensAt!.toISOString(), tz)}.`} It will close{' '}
                <strong>{when(new Date(confirm.opensAt!.getTime() + 30 * DAY).toISOString(), tz)}</strong>.
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded-lg bg-brand-blue px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                disabled={!!busy}
                onClick={() => void (confirm.kind === 'set_go_live' ? act('set_go_live', { at: confirm.opensAt!.toISOString() }) : act(confirm.kind))}
              >
                {busy ? 'Working…' : 'Confirm'}
              </button>
              <button type="button" className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-sm text-brand-muted" onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* D1 certificate gate — admins only, default off */}
      {view.isAdmin && (
        <section className="space-y-2" aria-labelledby="survey-gate-heading">
          <h2 id="survey-gate-heading" className="text-sm font-semibold uppercase tracking-wide text-brand-muted">Certificate gate</h2>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={d.gate_certificate}
              disabled={!!busy}
              onChange={(e) => (e.target.checked ? setConfirmGate(true) : void act('gate_certificate', { on: false }))}
            />
            Hold this event’s certificates until the person submits the survey
          </label>
          <p className="text-xs text-brand-muted-soft">
            {d.gate_certificate
              ? 'On. While the survey is open, anyone invited who hasn’t submitted is sent to the survey instead of the download. It lifts once they submit, and for everyone when the survey closes.'
              : 'Off (recommended). Certificates download as normal, and the survey is offered after.'}
          </p>
          {confirmGate && (
            <div role="dialog" aria-modal="false" className="rounded-xl border border-pathway-amber bg-pathway-amber-bg p-4">
              <p className="text-sm text-ink">
                Gating raises response rates, but it skews the answers (people rush to unlock the download) and puts pressure on minors, who shouldn’t have to answer a survey to get their certificate. Use it only when you have a reason to.
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" className="rounded-lg bg-brand-blue px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60" disabled={!!busy} onClick={() => void act('gate_certificate', { on: true })}>
                  {busy ? 'Working…' : 'Turn the gate on'}
                </button>
                <button type="button" className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-sm text-brand-muted" onClick={() => setConfirmGate(false)}>
                  Keep it off
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Pre-V2.3 minor agreements — admins only, per event (David, 6 Oct 2026) */}
      {view.isAdmin && (d.minor_agreement_override || (view.preview?.awaitingConsent.some((a) => a.reason === 'older_version') ?? false)) && (
        <section className="space-y-2" aria-labelledby="survey-override-heading">
          <h2 id="survey-override-heading" className="text-sm font-semibold uppercase tracking-wide text-brand-muted">Minors’ agreements</h2>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={d.minor_agreement_override}
              disabled={!!busy || status === 'closed'}
              onChange={(e) => (e.target.checked ? setConfirmOverride(true) : void act('minor_agreement_override', { on: false }))}
            />
            Also invite minors whose agreement was signed before V2.3
          </label>
          <p className="text-xs text-brand-muted-soft">
            {d.minor_agreement_override
              ? `On${d.minor_agreement_override_set_at ? ` since ${when(d.minor_agreement_override_set_at, tz)}` : ''}. Their answers are never quotable, because quoting needs V2.3. Turning it off invites nobody new but doesn’t withdraw invitations already sent.`
              : 'Off. Minors are invited only under Participation Agreement – Minors V2.3 or later.'}
          </p>
          {confirmOverride && (
            <div role="dialog" aria-modal="false" className="rounded-xl border border-pathway-amber bg-pathway-amber-bg p-4">
              <p className="text-sm text-ink">
                For this event only, minors with a valid agreement signed before V2.3 will be invited to the survey. Their answers won’t be quotable. The change is logged.
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" className="rounded-lg bg-brand-blue px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60" disabled={!!busy} onClick={() => void act('minor_agreement_override', { on: true })}>
                  {busy ? 'Working…' : 'Accept earlier agreements'}
                </button>
                <button type="button" className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-sm text-brand-muted" onClick={() => setConfirmOverride(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Audiences + preview */}
      {view.preview && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-muted">Who it reaches</h2>
          <div className="flex flex-wrap gap-4 text-sm">
            {(['student', 'mentor', 'adult'] as const).map((a) => (
              <label key={a} className="flex items-center gap-2 text-ink">
                <input
                  type="checkbox"
                  checked={d.audiences.includes(a)}
                  disabled={!!busy || (status !== 'scheduled' && status !== 'paused')}
                  onChange={(e) => {
                    const next = e.target.checked ? [...d.audiences, a] : d.audiences.filter((x) => x !== a)
                    if (next.length) void act('audiences', { audiences: next })
                  }}
                />
                {ROLE_LABEL[a]} <span className="text-brand-muted-soft">({view.preview!.byRole[a]})</span>
              </label>
            ))}
          </div>
          <p className="text-sm text-brand-muted">
            {view.preview.invitable} people will be invited
            {status === 'open' ? ' (anyone added to the event before the close date is invited automatically)' : ''}.
          </p>
          {view.preview.olderAgreementAccepted > 0 && (
            <p className="text-sm text-brand-muted-soft">{view.preview.olderAgreementAccepted} of them are minors invited under an agreement signed before V2.3. Their answers aren’t quotable.</p>
          )}
          {view.preview.headcountOnlyAdults > 0 && (
            <p className="text-sm text-brand-muted-soft">{view.preview.headcountOnlyAdults} adults are recorded only as a headcount on a registration and can’t be surveyed.</p>
          )}
          {view.preview.awaitingConsent.length > 0 && (
            <details className="rounded-xl border border-brand-border bg-white p-4">
              <summary className="cursor-pointer text-sm font-medium text-ink">Awaiting V2.3 consent: {view.preview.awaitingConsent.length} minors</summary>
              <p className="mt-2 text-xs text-brand-muted-soft">Minors are surveyed only under Participation Agreement – Minors V2.3 or later. They’re invited automatically if they sign before the close date.</p>
              <ul className="mt-2 space-y-1 text-sm text-brand-muted">
                {view.preview.awaitingConsent.map((a, i) => (
                  <li key={i}>
                    {a.name} — {a.reason === 'no_agreement' ? 'no signed agreement' : a.reason === 'restricted' ? 'consent withdrawn' : `signed ${a.agreementVersion ?? 'an earlier version'}`}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {view.preview.unreachable.length > 0 && (
            <details className="rounded-xl border border-brand-border bg-white p-4" open>
              <summary className="cursor-pointer text-sm font-medium text-ink">No deliverable email: {view.preview.unreachable.length} — follow up by hand</summary>
              <ul className="mt-2 space-y-1 text-sm text-brand-muted">
                {view.preview.unreachable.map((u, i) => (
                  <li key={i}>
                    {u.name} ({u.role}{u.reason === 'no_guardian_email' ? ', no guardian email' : ''})
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {/* Completion */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-muted">Responses</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(
            [
              ['Invited', view.totals.invited],
              ['Sent', view.totals.sent],
              ['Opened', view.totals.opened],
              ['Started', view.totals.started],
              ['Submitted', view.totals.submitted],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="rounded-xl border border-brand-border bg-white p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-brand-muted-soft">{label}</p>
              <p className="mt-1 text-xl font-bold text-ink">{n}</p>
            </div>
          ))}
        </div>
        {view.rows.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-brand-border bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-surface text-left text-xs uppercase tracking-wide text-brand-muted-soft">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Last activity</th>
                  <th className="px-3 py-2">Reminders</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-hairline">
                {view.rows.map((r) => (
                  <Row key={r.invitationId} r={r} tz={tz} canResend={status === 'open' && !r.submittedAt} busy={busy === 'resend'} onResend={() => void act('resend', { invitationId: r.invitationId })} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-brand-muted-soft">No invitations yet. They’re created when the survey goes live.</p>
        )}
      </section>

      {/* Exports + QR */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-muted">Exports</h2>
          {view.isAdmin ? (
            <div className="flex flex-wrap gap-2 text-sm">
              <a className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-brand-muted" href={`/api/admin/surveys/export?format=long&event=${eventSlug}`}>Answers CSV (long)</a>
              <a className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-brand-muted" href={`/api/admin/surveys/export?format=wide&event=${eventSlug}`}>Answers CSV (wide)</a>
              <a className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-brand-muted" href={`/api/admin/surveys/testimonials?event=${eventSlug}`}>Quotable answers</a>
            </div>
          ) : (
            <p className="text-sm text-brand-muted-soft">Response exports are for admins.</p>
          )}
          <p className="text-xs text-brand-muted-soft">Downloads are logged. Quotable answers apply each person’s current quoting permissions.</p>
        </div>
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-muted">Event-day QR code</h2>
          <p className="text-xs text-brand-muted-soft">Signed-in members go straight to their survey. Everyone else enters their email and gets their own link. Never a shared survey.</p>
          {qr && (
            <a href={qr} download={`survey-qr-${eventSlug}.png`} className="inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt={`QR code for ${qrUrl}`} width={180} height={180} className="rounded-lg border border-brand-border" />
            </a>
          )}
          <p className="break-all text-xs text-brand-muted-soft">{qrUrl}</p>
        </div>
      </section>
    </div>
  )
}

function Row({ r, tz, canResend, busy, onResend }: { r: CompletionRow; tz: string; canResend: boolean; busy: boolean; onResend: () => void }) {
  const status = r.submittedAt ? 'Submitted' : r.startedAt ? 'Started' : r.openedAt ? 'Opened' : r.sentAt ? 'Sent' : r.status === 'queued' ? 'Queued' : r.status
  return (
    <tr>
      <td className="px-3 py-2">
        <p className="font-medium text-ink">{r.name}</p>
        <p className="text-xs text-brand-muted-soft">
          {r.email}
          {r.sendVia === 'guardian' && ' (guardian)'}
        </p>
      </td>
      <td className="px-3 py-2 text-brand-muted">
        {r.role}
        {r.relationship ? ` · ${r.relationship}` : ''}
      </td>
      <td className="px-3 py-2 text-brand-muted">
        {status}
        {r.openedFrom === 'dashboard' && <span className="ml-1 text-xs text-brand-muted-soft">(dashboard)</span>}
        {r.lastError && <p className="text-xs text-danger">Send failed</p>}
      </td>
      <td className="px-3 py-2 text-xs text-brand-muted-soft">{r.lastActivityAt ? formatInZone(r.lastActivityAt, tz) : '—'}</td>
      <td className="px-3 py-2 text-xs text-brand-muted-soft">{r.remindersOff ? 'Stopped' : r.reminders}</td>
      <td className="px-3 py-2 text-right">
        {canResend && (
          <button type="button" className="text-xs text-brand-blue underline disabled:opacity-60" disabled={busy} onClick={onResend}>
            Resend
          </button>
        )}
      </td>
    </tr>
  )
}
