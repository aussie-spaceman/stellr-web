'use client'

import { useEffect, useState } from 'react'
import type { ComplianceState, TeacherLicense } from '@/lib/compliance'
import { formatDateShort } from '@/lib/utils'

interface ComplianceData {
  required: boolean
  state: ComplianceState
  detail: string | null
  license: TeacherLicense | null
  documentUrl: string | null
  check: { status: string; ordered_at: string; expires_at: string | null } | null
}

const STATE_PILL: Record<ComplianceState, { label: string; cls: string }> = {
  not_required:  { label: 'Not required',  cls: 'bg-brand-hairline text-brand-muted-soft' },
  valid_bc:      { label: 'BC Passed',     cls: 'bg-emerald-100 text-emerald-700' },
  valid_license: { label: 'License',       cls: 'bg-green-100 text-green-700' },
  in_process:    { label: 'In Process',    cls: 'bg-orange-100 text-orange-700' },
  cancelled:     { label: 'Cancelled',     cls: 'bg-amber-100 text-amber-700' },
  expired:       { label: 'Expired',       cls: 'bg-amber-100 text-amber-700' },
  invalid:       { label: 'Invalid',       cls: 'bg-red-100 text-red-700' },
}

const fmt = formatDateShort

export function ComplianceSection({ dateOfBirth, eventRole }: { dateOfBirth?: string | null; eventRole?: string | null }) {
  const [data, setData] = useState<ComplianceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ license_number: '', licensing_state: '', expiry_date: '' })
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [docError, setDocError] = useState('')

  void dateOfBirth // requirement is computed server-side; props kept for parity with DocusignsSection
  void eventRole

  async function load() {
    const res = await fetch('/api/members/compliance')
    const d = (await res.json()) as ComplianceData
    setData(d)
    if (d.license) {
      setForm({
        license_number: d.license.license_number,
        licensing_state: d.license.licensing_state,
        expiry_date: d.license.expiry_date,
      })
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function save() {
    setSaving(true)
    setError('')
    const res = await fetch('/api/members/compliance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => null)
      setError(d?.error ?? 'Failed to save license.')
      return
    }
    setEditing(false)
    await load()
  }

  async function uploadDocument(file: File) {
    setUploading(true)
    setDocError('')
    const body = new FormData()
    body.append('file', file)
    const res = await fetch('/api/members/compliance/document', { method: 'POST', body })
    setUploading(false)
    if (!res.ok) {
      const d = await res.json().catch(() => null)
      setDocError(d?.error ?? 'Upload failed.')
      return
    }
    await load()
  }

  async function deleteDocument() {
    setUploading(true)
    setDocError('')
    const res = await fetch('/api/members/compliance/document', { method: 'DELETE' })
    setUploading(false)
    if (!res.ok) {
      const d = await res.json().catch(() => null)
      setDocError(d?.error ?? 'Failed to remove document.')
      return
    }
    await load()
  }

  // Only adults who actually need clearance see this section.
  if (loading || !data || !data.required) return null

  const pill = STATE_PILL[data.state]
  const license = data.license
  const verified = !!license?.verified_at

  return (
    <div className="bg-white rounded-xl border border-brand-border p-6">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h2 className="text-base font-semibold text-brand-blue-dark">Background Check & License</h2>
        <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${pill.cls}`}>{pill.label}</span>
      </div>
      <p className="text-xs text-brand-muted-soft mb-4">
        As an adult taking part with Stellr, you must be cleared by either a verified teaching license or a
        background check. {data.detail ? <span className="text-brand-muted">{data.detail}.</span> : null}
      </p>

      {/* Background check status (read-only; Stellr orders these) */}
      {data.check && (
        <div className="mb-4 rounded-lg border border-brand-hairline bg-brand-canvas px-4 py-3 text-xs text-brand-muted">
          <span className="font-medium text-brand-muted">Background check:</span>{' '}
          {data.check.status === 'passed'
            ? `Passed${data.check.expires_at ? ` · valid until ${fmt(data.check.expires_at)}` : ''}`
            : data.check.status === 'referred'
              ? 'Completed — flagged for review by Stellr'
              : data.check.status === 'invited'
                ? 'Invitation sent — please check your email to complete it'
                : data.check.status === 'expired'
                  ? 'Invitation expired — Stellr will re-send it'
                  : data.check.status === 'cancelled'
                    ? 'Canceled — Stellr will re-order it'
                    : 'In progress'}
        </div>
      )}

      {/* Teacher license — self-service. Providing a verified license avoids the
          background-check requirement. */}
      {!editing && license ? (
        <div className="rounded-lg border border-brand-hairline px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <dl className="text-sm space-y-1">
              <div className="flex gap-2">
                <dt className="text-brand-muted-soft w-24">License no.</dt>
                <dd className="text-brand-blue-dark font-medium">{license.license_number}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-brand-muted-soft w-24">State</dt>
                <dd className="text-brand-blue-dark">{license.licensing_state}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-brand-muted-soft w-24">Expires</dt>
                <dd className="text-brand-blue-dark">{fmt(license.expiry_date)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-brand-muted-soft w-24">Verification</dt>
                <dd className={verified ? 'text-green-600 font-medium' : 'text-brand-gold-ink font-medium'}>
                  {verified ? 'Verified by Stellr' : 'Awaiting verification'}
                </dd>
              </div>
            </dl>
            <button
              onClick={() => setEditing(true)}
              className="text-xs font-medium text-brand-blue hover:text-brand-blue shrink-0"
            >
              Edit
            </button>
          </div>
          {!verified && (
            <p className="text-xs text-brand-gold-ink mt-2">
              Stellr will review your license. Editing it resets verification.
            </p>
          )}

          {/* License image — sensitive; upload/replace/delete. Stored in a private
              bucket and served via short-lived signed URLs. */}
          <div className="mt-3 border-t border-brand-hairline pt-3">
            <p className="text-xs text-brand-muted-soft mb-2">License photo / scan</p>
            {data.documentUrl ? (
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={data.documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-brand-blue hover:text-brand-blue-dark underline"
                >
                  View uploaded license
                </a>
                <label className="text-xs font-medium text-brand-blue hover:text-brand-blue-dark cursor-pointer">
                  Replace
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => e.target.files?.[0] && uploadDocument(e.target.files[0])}
                  />
                </label>
                <button
                  onClick={deleteDocument}
                  disabled={uploading}
                  className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                >
                  {uploading ? 'Working…' : 'Delete'}
                </button>
              </div>
            ) : (
              <label className="inline-flex items-center gap-2 text-xs font-medium text-white bg-brand-blue hover:bg-brand-blue-dark rounded-lg px-3 py-1.5 cursor-pointer">
                {uploading ? 'Uploading…' : 'Upload license photo'}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => e.target.files?.[0] && uploadDocument(e.target.files[0])}
                />
              </label>
            )}
            {docError && <p className="text-xs text-red-600 mt-1">{docError}</p>}
          </div>
        </div>
      ) : !editing && !license ? (
        <button
          onClick={() => setEditing(true)}
          className="text-sm font-medium text-white bg-brand-blue hover:bg-brand-blue-dark rounded-lg px-4 py-2"
        >
          Add teaching license
        </button>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-brand-muted-soft mb-1">License number</label>
              <input
                type="text"
                value={form.license_number}
                onChange={(e) => setForm((f) => ({ ...f, license_number: e.target.value }))}
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
            </div>
            <div>
              <label className="block text-xs text-brand-muted-soft mb-1">Licensing state</label>
              <input
                type="text"
                value={form.licensing_state}
                onChange={(e) => setForm((f) => ({ ...f, licensing_state: e.target.value }))}
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
            </div>
            <div>
              <label className="block text-xs text-brand-muted-soft mb-1">Expiry date</label>
              <input
                type="date"
                value={form.expiry_date}
                onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="text-sm font-medium text-white bg-brand-blue hover:bg-brand-blue-dark disabled:opacity-50 rounded-lg px-4 py-2"
            >
              {saving ? 'Saving…' : 'Save license'}
            </button>
            {license && (
              <button
                onClick={() => {
                  setEditing(false)
                  setError('')
                }}
                className="text-sm font-medium text-brand-muted hover:text-brand-blue-dark rounded-lg px-4 py-2"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
