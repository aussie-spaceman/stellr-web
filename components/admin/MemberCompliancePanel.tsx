'use client'

import { useState } from 'react'
import { formatDateShort } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { Field, Input } from '@stellr/web-ui'
import { postUpload, uploadDirectToStorage } from '@/lib/upload-client'
import type { ComplianceState, TeacherLicense } from '@/lib/compliance'

// State → pill. Two shades of green (BC vs license), orange in-process, red
// invalid — shared shape with the event roster and member portal.
export const COMPLIANCE_PILL: Record<ComplianceState, { label: string; cls: string }> = {
  not_required:  { label: 'Not required',  cls: 'bg-brand-hairline text-brand-muted-soft' },
  valid_bc:      { label: 'BC Passed',     cls: 'bg-emerald-100 text-emerald-700' },
  valid_license: { label: 'License',       cls: 'bg-green-100 text-green-700' },
  in_process:    { label: 'In Process',    cls: 'bg-orange-100 text-orange-700' },
  flagged:       { label: 'Needs review',  cls: 'bg-red-100 text-red-700 ring-1 ring-red-300' },
  cancelled:     { label: 'Cancelled',     cls: 'bg-amber-100 text-amber-700' },
  expired:       { label: 'Expired',       cls: 'bg-amber-100 text-amber-700' },
  invalid:       { label: 'Invalid',       cls: 'bg-red-100 text-red-700' },
}

export interface MemberCompliance {
  state: ComplianceState
  detail: string | null
  license: TeacherLicense | null
  check: {
    id: string
    status: string
    ordered_at: string
    expires_at: string | null
    provider_report_ref: string | null
    includes_canceled?: boolean
    adjudicated_at?: string | null
    adjudication_outcome?: 'cleared' | 'not_cleared' | null
    adjudicated_label?: string | null
    adjudication_notes?: string | null
  } | null
}

// Deep link to the report in the Checkr dashboard (adjudicators only — this
// panel is already admin-gated). Staging vs prod is inferred from the env base.
function checkrReportUrl(reportRef: string): string {
  const base = (process.env.NEXT_PUBLIC_CHECKR_DASHBOARD_URL ?? 'https://dashboard.checkr.com').replace(/\/$/, '')
  return `${base}/reports/${reportRef}`
}

function fmt(iso: string) {
  return formatDateShort(iso)
}

export function MemberCompliancePanel({
  memberId,
  compliance,
}: {
  memberId: string
  /** Null when the member doesn't require clearance (panel hidden). */
  compliance: MemberCompliance | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [adjudicating, setAdjudicating] = useState(false)
  const [notes, setNotes] = useState('')
  // Entering a license on the member's behalf (e.g. the teacher emailed a copy).
  const [editingLicense, setEditingLicense] = useState(false)
  const [form, setForm] = useState({ license_number: '', licensing_state: '', expiry_date: '' })
  const [file, setFile] = useState<File | null>(null)

  if (!compliance || compliance.state === 'not_required') return null

  const pill = COMPLIANCE_PILL[compliance.state]
  const { license, check } = compliance
  const verified = !!license?.verified_at
  const checkInProgress = check?.status === 'invited' || check?.status === 'in_progress'

  async function post(url: string, body?: unknown) {
    setBusy(true)
    setError('')
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    setBusy(false)
    if (!res.ok) {
      const d = await res.json().catch(() => null)
      setError(d?.error ?? 'Action failed.')
      return
    }
    router.refresh()
  }

  // Browser → storage via a signed URL, then the admin route claims it. Returns
  // an error message, or null once the document is attached.
  async function attachDocument(doc: File): Promise<string | null> {
    const stored = await uploadDirectToStorage(doc, 'compliance-document-admin', { memberId })
    if ('error' in stored) return stored.error
    const result = await postUpload(
      `/api/admin/members/${memberId}/license/document`,
      JSON.stringify({ storagePath: stored.storagePath, fileType: stored.fileType }),
      { headers: { 'Content-Type': 'application/json' } },
    )
    return 'error' in result ? result.error : null
  }

  async function uploadDocument(doc: File) {
    setBusy(true)
    setError('')
    try {
      const failed = await attachDocument(doc)
      if (failed) setError(failed)
      else router.refresh()
    } finally {
      setBusy(false)
    }
  }

  function startEditing() {
    setForm(
      license
        ? { license_number: license.license_number, licensing_state: license.licensing_state, expiry_date: license.expiry_date }
        : { license_number: '', licensing_state: '', expiry_date: '' },
    )
    setFile(null)
    setError('')
    setEditingLicense(true)
  }

  // Details first (the document attaches to the license row), then the file if
  // one was chosen. Neither verifies: Mark verified stays a separate click.
  async function saveLicense() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/members/${memberId}/license`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', ...form }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setError(d?.error ?? 'Failed to save license.')
        return
      }
      setEditingLicense(false)
      if (file) {
        const failed = await attachDocument(file)
        if (failed) setError(`License saved, but the document didn’t upload: ${failed}`)
      }
      setFile(null)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-brand-border p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-brand-muted-soft">Background Check</h2>
        <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${pill.cls}`}>{pill.label}</span>
      </div>

      {compliance.detail && <p className="text-xs text-brand-muted-soft mb-3">{compliance.detail}.</p>}

      {/* Teacher license review */}
      {editingLicense ? (
        <div className="text-sm space-y-3 border-b border-brand-hairline pb-3 mb-3">
          <p className="text-xs font-medium text-brand-muted-soft uppercase tracking-wide">
            {license ? 'Edit license' : 'Add license'}
          </p>
          {/* A license's details, not the admin's own: no autofill. */}
          <Field label="License number" labelSize="small">
            <Input
              type="text"
              autoComplete="off"
              value={form.license_number}
              onChange={(e) => setForm((f) => ({ ...f, license_number: e.target.value }))}
            />
          </Field>
          <Field label="Licensing state" labelSize="small">
            <Input
              type="text"
              autoComplete="off"
              value={form.licensing_state}
              onChange={(e) => setForm((f) => ({ ...f, licensing_state: e.target.value }))}
            />
          </Field>
          <Field label="Expiry date" labelSize="small">
            <Input
              type="date"
              autoComplete="off"
              value={form.expiry_date}
              onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
            />
          </Field>
          <Field
            label={license?.document_path ? 'Replace photo / scan (optional)' : 'Photo / scan (optional)'}
            labelSize="small"
            hint="Image or PDF, up to 10MB."
          >
            <input
              type="file"
              accept="image/*,application/pdf"
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-brand-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand-hairline file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-brand-blue-dark"
            />
          </Field>
          <p className="text-xs text-brand-muted-soft">
            Saving does not verify the license. Check it, then use Mark verified.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={saveLicense}
              disabled={busy}
              className="text-xs font-medium text-white bg-brand-blue hover:bg-brand-blue-dark disabled:opacity-50 rounded-lg px-3 py-1.5"
            >
              {busy ? 'Saving…' : 'Save license'}
            </button>
            <button
              onClick={() => {
                setEditingLicense(false)
                setError('')
              }}
              disabled={busy}
              className="text-xs font-medium text-brand-muted-soft hover:text-brand-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : license ? (
        <div className="text-sm space-y-1 border-b border-brand-hairline pb-3 mb-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-brand-muted-soft uppercase tracking-wide">License</p>
            <button
              onClick={startEditing}
              disabled={busy}
              className="text-xs font-medium text-brand-blue hover:text-brand-blue-dark disabled:opacity-50"
            >
              Edit
            </button>
          </div>
          <div className="flex justify-between">
            <span className="text-brand-muted-soft">Number</span>
            <span className="text-brand-blue-dark font-medium">{license.license_number}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-brand-muted-soft">State</span>
            <span className="text-brand-blue-dark">{license.licensing_state}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-brand-muted-soft">Expires</span>
            <span className="text-brand-blue-dark">{fmt(license.expiry_date)}</span>
          </div>
          {/* The uploaded photo/scan, opened via a fresh signed URL per click
              (private bucket), so the admin can see what they are verifying. */}
          <div className="flex justify-between items-center gap-3">
            <span className="text-brand-muted-soft">Document</span>
            <span className="flex items-center gap-3 text-xs">
              {license.document_path ? (
                <a
                  href={`/api/admin/members/${memberId}/license/document`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-brand-blue hover:text-brand-blue-dark"
                >
                  View document ↗
                </a>
              ) : (
                <span className="text-brand-muted-soft">None uploaded</span>
              )}
              {/* sr-only, not hidden: a display:none file input can't take
                  keyboard focus. */}
              <label className="relative font-medium text-brand-blue hover:text-brand-blue-dark cursor-pointer focus-within:ring-2 focus-within:ring-primary-deep">
                {busy ? 'Working…' : license.document_path ? 'Replace' : 'Upload'}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => {
                    const doc = e.target.files?.[0]
                    e.target.value = ''
                    if (doc) uploadDocument(doc)
                  }}
                />
              </label>
            </span>
          </div>
          <div className="flex justify-between items-center pt-1">
            <span className="text-brand-muted-soft">Status</span>
            {verified ? (
              <span className="text-green-600 font-medium text-xs">
                Verified{license.verified_label ? ` · ${license.verified_label}` : ''}
              </span>
            ) : (
              <span className="text-amber-600 font-medium text-xs">Awaiting review</span>
            )}
          </div>
          <div className="pt-2">
            {verified ? (
              <button
                onClick={() => post(`/api/admin/members/${memberId}/license`, { action: 'unverify' })}
                disabled={busy}
                className="text-xs font-medium text-brand-muted-soft hover:text-brand-muted disabled:opacity-50"
              >
                Remove verification
              </button>
            ) : (
              <button
                // BG-9: bind the verify to the version shown here, so a member
                // edit between load and click can't be silently rubber-stamped.
                onClick={() => post(`/api/admin/members/${memberId}/license`, { action: 'verify', licenseUpdatedAt: license.updated_at })}
                disabled={busy}
                className="text-xs font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg px-3 py-1.5"
              >
                {busy ? 'Saving…' : 'Mark verified'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="border-b border-brand-hairline pb-3 mb-3">
          <p className="text-xs text-brand-muted-soft">No teacher license on file.</p>
          <button
            onClick={startEditing}
            disabled={busy}
            className="mt-2 text-xs font-medium text-white bg-brand-blue hover:bg-brand-blue-dark disabled:opacity-50 rounded-lg px-3 py-1.5"
          >
            Add license
          </button>
        </div>
      )}

      {/* Background check status + order */}
      <div className="text-sm space-y-1">
        <p className="text-xs font-medium text-brand-muted-soft uppercase tracking-wide">Check</p>
        {check ? (
          <>
            <div className="flex justify-between">
              <span className="text-brand-muted-soft">Status</span>
              <span className="text-brand-blue-dark capitalize">{check.status.replace(/_/g, ' ')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-brand-muted-soft">Ordered</span>
              <span className="text-brand-blue-dark">{fmt(check.ordered_at)}</span>
            </div>
            {check.expires_at && (
              <div className="flex justify-between">
                <span className="text-brand-muted-soft">Valid until</span>
                <span className="text-brand-blue-dark">{fmt(check.expires_at)}</span>
              </div>
            )}
            {check.includes_canceled && (
              <p className="text-xs text-amber-600 pt-1">Completed with one or more canceled screenings.</p>
            )}
            {check.provider_report_ref && (
              <div className="pt-1 flex flex-wrap gap-x-4 gap-y-1">
                <a
                  href={checkrReportUrl(check.provider_report_ref)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-brand-blue hover:text-brand-blue-dark"
                >
                  View report in Checkr ↗
                </a>
                {/* Cleared checks only: the PDF is fetched from Checkr on click
                    and never stored here. */}
                {compliance.state === 'valid_bc' && (
                  <a
                    href={`/api/admin/members/${memberId}/background-check/report`}
                    className="text-xs font-medium text-brand-blue hover:text-brand-blue-dark"
                  >
                    Download Checkr report (PDF)
                  </a>
                )}
              </div>
            )}
            {check.adjudicated_at ? (
              <div className="mt-2 rounded-lg bg-brand-hairline/40 px-3 py-2 text-xs">
                <p className="font-medium text-brand-blue-dark">
                  {check.adjudication_outcome === 'cleared' ? 'Cleared on review' : 'Not cleared on review'}
                </p>
                <p className="text-brand-muted-soft">
                  {check.adjudicated_label ? `${check.adjudicated_label} · ` : ''}
                  {fmt(check.adjudicated_at)}
                </p>
                {check.adjudication_notes && (
                  <p className="text-brand-muted-soft mt-1 whitespace-pre-wrap">{check.adjudication_notes}</p>
                )}
              </div>
            ) : (
              check.status === 'referred' && (
                <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <p className="text-xs font-medium text-red-700">Needs a decision</p>
                  <p className="text-xs text-red-600 mt-0.5">
                    Records were found. Review the report in Checkr, then record the decision here. The
                    member is not cleared until you do.
                  </p>
                  {adjudicating ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={3}
                        placeholder="What was found, and why it does or does not disqualify them."
                        className="w-full text-input mouse:text-xs rounded-lg border border-line-strong px-2 py-1.5"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() =>
                            post(`/api/admin/members/${memberId}/background-check/adjudicate`, {
                              outcome: 'cleared',
                              notes,
                              checkId: check.id,
                            })
                          }
                          disabled={busy}
                          className="text-xs font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg px-3 py-1.5"
                        >
                          Clear to participate
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Record that this member is NOT cleared to take part?'))
                              post(`/api/admin/members/${memberId}/background-check/adjudicate`, {
                                outcome: 'not_cleared',
                                notes,
                                checkId: check.id,
                              })
                          }}
                          disabled={busy}
                          className="text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg px-3 py-1.5"
                        >
                          Not cleared
                        </button>
                        <button
                          onClick={() => setAdjudicating(false)}
                          disabled={busy}
                          className="text-xs font-medium text-brand-muted-soft hover:text-brand-muted"
                        >
                          Cancel
                        </button>
                      </div>
                      <p className="text-xs text-brand-muted-soft">
                        Clearing someone requires a short rationale. Adverse action itself is run from the
                        Checkr dashboard.
                      </p>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAdjudicating(true)}
                      className="mt-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg px-3 py-1.5"
                    >
                      Record decision
                    </button>
                  )}
                </div>
              )
            )}
          </>
        ) : (
          <p className="text-xs text-brand-muted-soft">No background check ordered.</p>
        )}
        {!checkInProgress && (
          <div className="pt-2">
            <button
              onClick={() => {
                if (
                  confirm(
                    'Order a background check for this member?\n\nThe member will be emailed to complete it. Stellr is billed per check.',
                  )
                )
                  post(`/api/admin/members/${memberId}/background-check`)
              }}
              disabled={busy}
              className="text-xs font-medium text-white bg-brand-blue hover:bg-brand-blue-dark disabled:opacity-50 rounded-lg px-3 py-1.5"
            >
              {busy ? 'Ordering…' : check ? 'Re-order background check' : 'Order background check'}
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
    </div>
  )
}
