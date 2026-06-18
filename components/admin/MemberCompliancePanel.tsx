'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ComplianceState, TeacherLicense } from '@/lib/compliance'

// State → pill. Two shades of green (BC vs license), orange in-process, red
// invalid — shared shape with the event roster and member portal.
export const COMPLIANCE_PILL: Record<ComplianceState, { label: string; cls: string }> = {
  not_required:  { label: 'Not required',  cls: 'bg-brand-hairline text-brand-muted-soft' },
  valid_bc:      { label: 'BC Passed',     cls: 'bg-emerald-100 text-emerald-700' },
  valid_license: { label: 'License',       cls: 'bg-green-100 text-green-700' },
  in_process:    { label: 'In Process',    cls: 'bg-orange-100 text-orange-700' },
  invalid:       { label: 'Invalid',       cls: 'bg-red-100 text-red-700' },
}

export interface MemberCompliance {
  state: ComplianceState
  detail: string | null
  license: TeacherLicense | null
  check: { status: string; ordered_at: string; expires_at: string | null; provider_report_ref: string | null } | null
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
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

  return (
    <div className="bg-white rounded-xl border border-brand-border p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-brand-muted-soft uppercase tracking-wide">Background Check</h2>
        <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${pill.cls}`}>{pill.label}</span>
      </div>

      {compliance.detail && <p className="text-xs text-brand-muted-soft mb-3">{compliance.detail}.</p>}

      {/* Teacher license review */}
      {license ? (
        <div className="text-sm space-y-1 border-b border-brand-hairline pb-3 mb-3">
          <p className="text-xs font-medium text-brand-muted-soft uppercase tracking-wide">License</p>
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
                onClick={() => post(`/api/admin/members/${memberId}/license`, { action: 'verify' })}
                disabled={busy}
                className="text-xs font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg px-3 py-1.5"
              >
                {busy ? 'Saving…' : 'Mark verified'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-brand-muted-soft border-b border-brand-hairline pb-3 mb-3">No teacher license on file.</p>
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
