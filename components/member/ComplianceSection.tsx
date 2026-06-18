'use client'

import { useEffect, useState } from 'react'
import type { ComplianceState, TeacherLicense } from '@/lib/compliance'

interface ComplianceData {
  required: boolean
  state: ComplianceState
  detail: string | null
  license: TeacherLicense | null
  check: { status: string; ordered_at: string; expires_at: string | null } | null
}

const STATE_PILL: Record<ComplianceState, { label: string; cls: string }> = {
  not_required:  { label: 'Not required',  cls: 'bg-gray-100 text-gray-500' },
  valid_bc:      { label: 'BC Passed',     cls: 'bg-emerald-100 text-emerald-700' },
  valid_license: { label: 'License',       cls: 'bg-green-100 text-green-700' },
  in_process:    { label: 'In Process',    cls: 'bg-orange-100 text-orange-700' },
  invalid:       { label: 'Invalid',       cls: 'bg-red-100 text-red-700' },
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ComplianceSection({ dateOfBirth, eventRole }: { dateOfBirth?: string | null; eventRole?: string | null }) {
  const [data, setData] = useState<ComplianceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ license_number: '', licensing_state: '', expiry_date: '' })
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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

  // Only adults who actually need clearance see this section.
  if (loading || !data || !data.required) return null

  const pill = STATE_PILL[data.state]
  const license = data.license
  const verified = !!license?.verified_at

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h2 className="text-base font-semibold text-gray-900">Background Check & License</h2>
        <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${pill.cls}`}>{pill.label}</span>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        As an adult taking part with Stellr, you must be cleared by either a verified teaching license or a
        background check. {data.detail ? <span className="text-gray-600">{data.detail}.</span> : null}
      </p>

      {/* Background check status (read-only; Stellr orders these) */}
      {data.check && (
        <div className="mb-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-600">
          <span className="font-medium text-gray-700">Background check:</span>{' '}
          {data.check.status === 'passed'
            ? `Passed${data.check.expires_at ? ` · valid until ${fmt(data.check.expires_at)}` : ''}`
            : data.check.status === 'referred'
              ? 'Completed — flagged for review by Stellr'
              : data.check.status === 'invited'
                ? 'Invitation sent — please check your email to complete it'
                : 'In progress'}
        </div>
      )}

      {/* Teacher license — self-service. Providing a verified license avoids the
          background-check requirement. */}
      {!editing && license ? (
        <div className="rounded-lg border border-gray-100 px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <dl className="text-sm space-y-1">
              <div className="flex gap-2">
                <dt className="text-gray-500 w-24">License no.</dt>
                <dd className="text-gray-900 font-medium">{license.license_number}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-gray-500 w-24">State</dt>
                <dd className="text-gray-900">{license.licensing_state}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-gray-500 w-24">Expires</dt>
                <dd className="text-gray-900">{fmt(license.expiry_date)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-gray-500 w-24">Verification</dt>
                <dd className={verified ? 'text-green-600 font-medium' : 'text-amber-600 font-medium'}>
                  {verified ? 'Verified by Stellr' : 'Awaiting verification'}
                </dd>
              </div>
            </dl>
            <button
              onClick={() => setEditing(true)}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800 shrink-0"
            >
              Edit
            </button>
          </div>
          {!verified && (
            <p className="text-xs text-amber-600 mt-2">
              Stellr will review your license. Editing it resets verification.
            </p>
          )}
        </div>
      ) : !editing && !license ? (
        <button
          onClick={() => setEditing(true)}
          className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-4 py-2"
        >
          Add teaching license
        </button>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">License number</label>
              <input
                type="text"
                value={form.license_number}
                onChange={(e) => setForm((f) => ({ ...f, license_number: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Licensing state</label>
              <input
                type="text"
                value={form.licensing_state}
                onChange={(e) => setForm((f) => ({ ...f, licensing_state: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Expiry date</label>
              <input
                type="date"
                value={form.expiry_date}
                onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg px-4 py-2"
            >
              {saving ? 'Saving…' : 'Save license'}
            </button>
            {license && (
              <button
                onClick={() => {
                  setEditing(false)
                  setError('')
                }}
                className="text-sm font-medium text-gray-600 hover:text-gray-800 rounded-lg px-4 py-2"
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
