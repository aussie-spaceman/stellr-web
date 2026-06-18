'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, X, Check } from 'lucide-react'

export interface Membership {
  id: string
  renewal_status: string
  started_at: string
  expires_at: string | null
  is_complimentary: boolean
  source: string | null
  membership_tiers: { name: string } | null
}

interface Tier { id: string; name: string }

interface Props {
  memberId: string
  membershipId: string | null
  tiers: Tier[]
  memberships: Membership[]
}

const SOURCE_LABEL: Record<string, string> = {
  stripe: 'Paid', rule: 'Auto rule', manual: 'Manual', system: 'System',
}
const STATUS_CLS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  expired: 'bg-brand-hairline text-brand-muted-soft',
  canceled: 'bg-red-100 text-red-600',
  revoked: 'bg-red-100 text-red-600',
}
const STATUSES = ['active', 'expired', 'canceled', 'revoked']

function fmt(d: string | null): string {
  return d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
}
function tierName(m: Membership): string {
  return m.membership_tiers?.name ?? 'Membership'
}

export function MemberMembershipManager({ memberId, membershipId, tiers, memberships }: Props) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Assign-form state
  const [showAssign, setShowAssign] = useState(false)
  const [tierId, setTierId] = useState(tiers[0]?.id ?? '')
  const [duration, setDuration] = useState('12') // '12' | '24' | 'lifetime' | 'custom'
  const [customDate, setCustomDate] = useState('')
  const [complimentary, setComplimentary] = useState(true)
  const [replacesFree, setReplacesFree] = useState(true)

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editExpiry, setEditExpiry] = useState('')
  const [editStatus, setEditStatus] = useState('active')
  const [editComp, setEditComp] = useState(false)

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true)
    setError('')
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || 'Action failed.')
      return false
    }
    router.refresh()
    return true
  }

  async function handleAssign() {
    if (!tierId) return
    const body: Record<string, unknown> = { tierId, complimentary, replacesFree }
    if (duration === 'lifetime') body.months = null
    else if (duration === 'custom') {
      if (!customDate) { setError('Pick an expiry date.'); return }
      body.expiresAt = customDate
    } else body.months = Number(duration)

    if (await call(`/api/admin/members/${memberId}/memberships`, 'POST', body)) {
      setShowAssign(false)
    }
  }

  function startEdit(m: Membership) {
    setEditingId(m.id)
    setEditExpiry(m.expires_at ?? '')
    setEditStatus(m.renewal_status)
    setEditComp(m.is_complimentary)
    setError('')
  }

  async function saveEdit(id: string) {
    await call(`/api/admin/members/${memberId}/memberships/${id}`, 'PATCH', {
      expires_at: editExpiry || null,
      renewal_status: editStatus,
      is_complimentary: editComp,
    })
    setEditingId(null)
  }

  async function remove(id: string) {
    await call(`/api/admin/members/${memberId}/memberships/${id}`, 'DELETE')
  }

  // Sort: active first, then by start date desc.
  const sorted = [...memberships].sort((a, b) => {
    if ((a.renewal_status === 'active') !== (b.renewal_status === 'active'))
      return a.renewal_status === 'active' ? -1 : 1
    return new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  })

  return (
    <div className="bg-white rounded-xl border border-brand-border p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-brand-muted-soft uppercase tracking-wide">Membership</h2>
        <button
          onClick={() => setShowAssign((s) => !s)}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-blue hover:text-brand-blue"
        >
          <Plus className="h-3.5 w-3.5" /> Assign tier
        </button>
      </div>

      <div className="flex items-center justify-between text-sm mb-3 pb-3 border-b border-brand-hairline">
        <span className="text-brand-muted-soft">Member ID</span>
        {membershipId ? (
          <span className="font-mono font-medium text-brand-blue-dark">{membershipId}</span>
        ) : (
          <span className="text-brand-muted-soft">Not yet assigned</span>
        )}
      </div>

      {error && <p className="mb-3 text-xs text-red-600 bg-red-50 rounded-md px-2.5 py-1.5">{error}</p>}

      {/* Assign form */}
      {showAssign && (
        <div className="mb-4 rounded-lg border border-brand-blue bg-brand-blue/5/40 p-3 space-y-2.5">
          <div>
            <label className="block text-xs text-brand-muted-soft mb-1">Tier</label>
            <select
              value={tierId}
              onChange={(e) => setTierId(e.target.value)}
              className="w-full border border-brand-border rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-blue"
            >
              {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-brand-muted-soft mb-1">Duration</label>
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full border border-brand-border rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-blue"
            >
              <option value="12">1 year</option>
              <option value="24">2 years</option>
              <option value="lifetime">No expiry (lifetime)</option>
              <option value="custom">Custom date…</option>
            </select>
          </div>
          {duration === 'custom' && (
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="w-full border border-brand-border rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-blue"
            />
          )}
          <label className="flex items-center gap-2 text-sm text-brand-muted">
            <input type="checkbox" checked={complimentary} onChange={(e) => setComplimentary(e.target.checked)} className="rounded border-brand-border" />
            Complimentary (no charge)
          </label>
          <label className="flex items-center gap-2 text-sm text-brand-muted">
            <input type="checkbox" checked={replacesFree} onChange={(e) => setReplacesFree(e.target.checked)} className="rounded border-brand-border" />
            Replace existing free membership
          </label>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleAssign}
              disabled={busy}
              className="flex-1 bg-brand-blue text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-brand-blue-dark disabled:opacity-50"
            >
              {busy ? 'Assigning…' : 'Assign'}
            </button>
            <button onClick={() => setShowAssign(false)} className="px-3 py-1.5 rounded-lg text-sm text-brand-muted hover:bg-brand-hairline">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Memberships list */}
      {sorted.length === 0 ? (
        <p className="text-sm text-brand-muted-soft">No memberships on record.</p>
      ) : (
        <ul className="space-y-2.5">
          {sorted.map((m) => (
            <li key={m.id} className="rounded-lg border border-brand-hairline p-3">
              {editingId === m.id ? (
                <div className="space-y-2">
                  <div className="font-semibold text-sm text-brand-blue-dark">{tierName(m)}</div>
                  <div>
                    <label className="block text-xs text-brand-muted-soft mb-1">Expiry</label>
                    <input type="date" value={editExpiry} onChange={(e) => setEditExpiry(e.target.value)}
                      className="w-full border border-brand-border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue" />
                  </div>
                  <div>
                    <label className="block text-xs text-brand-muted-soft mb-1">Status</label>
                    <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}
                      className="w-full border border-brand-border rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-blue">
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-brand-muted">
                    <input type="checkbox" checked={editComp} onChange={(e) => setEditComp(e.target.checked)} className="rounded border-brand-border" />
                    Complimentary
                  </label>
                  <div className="flex gap-2 pt-0.5">
                    <button onClick={() => saveEdit(m.id)} disabled={busy}
                      className="inline-flex items-center gap-1 bg-brand-blue text-white px-2.5 py-1 rounded-md text-xs font-medium hover:bg-brand-blue-dark disabled:opacity-50">
                      <Check className="h-3.5 w-3.5" /> Save
                    </button>
                    <button onClick={() => setEditingId(null)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-brand-muted hover:bg-brand-hairline">
                      <X className="h-3.5 w-3.5" /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-brand-blue-dark">{tierName(m)}</span>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_CLS[m.renewal_status] ?? 'bg-brand-hairline text-brand-muted-soft'}`}>
                        {m.renewal_status}
                      </span>
                    </div>
                    <p className="text-xs text-brand-muted-soft mt-0.5">
                      {fmt(m.started_at)} → {fmt(m.expires_at)}
                    </p>
                    <p className="text-[11px] text-brand-muted-soft mt-0.5">
                      {SOURCE_LABEL[m.source ?? ''] ?? m.source ?? '—'}
                      {m.is_complimentary ? ' · Complimentary' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => startEdit(m)} title="Edit" className="p-1 text-brand-muted-soft hover:text-brand-blue">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {m.renewal_status !== 'revoked' && (
                      <button onClick={() => remove(m.id)} title="Revoke" className="p-1 text-brand-muted-soft hover:text-red-600">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
