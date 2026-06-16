'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import MemberPicker, { type PickedMember } from '@/components/admin/MemberPicker'

export interface AdminTier {
  id: string
  name: string
}
export interface AdminHost {
  member_id: string
  name: string
  can_coach: boolean
  can_mentor: boolean
}
export interface AdminCohort {
  id: string
  name: string
  mentor_name: string | null
  member_count: number
  lifecycle?: 'active' | 'archived'
}
export interface AdminEntitlement {
  tier_id: string
  session_type: 'coaching' | 'mentoring'
  included_sessions: number
  validity_days: number | null
  extra_stripe_price_id: string | null
}

export function SessionsManager({
  tiers,
  hosts,
  cohorts,
  entitlements,
}: {
  tiers: AdminTier[]
  hosts: AdminHost[]
  cohorts: AdminCohort[]
  entitlements: AdminEntitlement[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const post = async (url: string, body: unknown, method = 'POST') => {
    setBusy(true)
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) router.refresh()
      else alert((await res.json()).error ?? 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-10">
      <HostsSection hosts={hosts} busy={busy} post={post} />
      <CohortsSection cohorts={cohorts} busy={busy} post={post} />
      <EntitlementsSection tiers={tiers} entitlements={entitlements} busy={busy} post={post} />
    </div>
  )
}

type Poster = (url: string, body: unknown, method?: string) => Promise<void>

function HostsSection({ hosts, busy, post }: { hosts: AdminHost[]; busy: boolean; post: Poster }) {
  const [host, setHost] = useState<PickedMember | null>(null)
  const [canCoach, setCanCoach] = useState(true)
  const [canMentor, setCanMentor] = useState(false)

  const hostName = host
    ? [host.first_name, host.last_name].filter(Boolean).join(' ') || host.email || 'Member'
    : ''

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-gray-900">Coaches &amp; Mentors</h2>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <div className="min-w-[220px] flex-1">
          {host ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 py-1 pl-3 pr-1 text-sm font-medium text-indigo-700">
              {hostName}
              <button onClick={() => setHost(null)} aria-label="Clear member" className="hover:text-indigo-900">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : (
            <MemberPicker disabled={busy} placeholder="member — search by name or email…" onPick={setHost} />
          )}
        </div>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={canCoach} onChange={(e) => setCanCoach(e.target.checked)} /> Coach
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={canMentor} onChange={(e) => setCanMentor(e.target.checked)} /> Mentor
        </label>
        <button
          onClick={() => {
            if (!host) return
            post('/api/admin/community/hosts', { memberId: host.id, canCoach, canMentor })
            setHost(null)
          }}
          disabled={busy || !host}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Grant
        </button>
      </div>
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
        {hosts.map((h) => (
          <li key={h.member_id} className="flex items-center justify-between px-3 py-2 text-sm">
            <span>{h.name}</span>
            <span className="flex items-center gap-2">
              {h.can_coach && <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">Coach</span>}
              {h.can_mentor && <span className="rounded bg-purple-50 px-2 py-0.5 text-xs text-purple-700">Mentor</span>}
              <button
                onClick={() => post('/api/admin/community/hosts', { memberId: h.member_id }, 'DELETE')}
                disabled={busy}
                className="text-xs text-gray-400 hover:text-red-600"
              >
                Revoke
              </button>
            </span>
          </li>
        ))}
        {hosts.length === 0 && <li className="px-3 py-3 text-sm text-gray-400">No hosts yet.</li>}
      </ul>
    </section>
  )
}

function CohortsSection({ cohorts, busy, post }: { cohorts: AdminCohort[]; busy: boolean; post: Poster }) {
  const [name, setName] = useState('')
  const [mentor, setMentor] = useState<PickedMember | null>(null)

  const mentorName = mentor
    ? [mentor.first_name, mentor.last_name].filter(Boolean).join(' ') || mentor.email || 'Member'
    : ''

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-gray-900">Mentoring Cohorts</h2>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Cohort name"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <div className="min-w-[220px] flex-1">
          {mentor ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 py-1 pl-3 pr-1 text-sm font-medium text-indigo-700">
              {mentorName}
              <button onClick={() => setMentor(null)} aria-label="Clear mentor" className="hover:text-indigo-900">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : (
            <MemberPicker disabled={busy} placeholder="mentor — search by name or email (optional)" onPick={setMentor} />
          )}
        </div>
        <button
          onClick={() => {
            if (!name) return
            post('/api/admin/community/cohorts', { name, mentorId: mentor?.id })
            setName('')
            setMentor(null)
          }}
          disabled={busy}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Create
        </button>
      </div>
      <ul className="space-y-2">
        {cohorts.map((c) => (
          <li key={c.id} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="flex items-center gap-2 font-medium text-gray-900">
                  {c.name}
                  {c.lifecycle === 'archived' && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                      Archived
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-500">
                  Mentor: {c.mentor_name ?? '—'} · {c.member_count} members
                </p>
              </div>
              {c.lifecycle === 'archived' ? (
                <button
                  onClick={() => post('/api/admin/community/cohorts', { cohortId: c.id, archive: false }, 'PATCH')}
                  disabled={busy}
                  className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  Reactivate
                </button>
              ) : (
                <button
                  onClick={() => {
                    if (!window.confirm(`Archive "${c.name}"? Its sessions stop and members move to read-only.`)) return
                    const keepOpen = window.confirm(
                      'Keep its content (chat, recordings) open for past members?\n\nOK = keep open.\nCancel = re-gate (lock unless their tier allows).',
                    )
                    post('/api/admin/community/cohorts', { cohortId: c.id, archive: true, keepOpen }, 'PATCH')
                  }}
                  disabled={busy}
                  className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  Archive
                </button>
              )}
            </div>
            <div className="mt-2 max-w-md">
              <MemberPicker
                disabled={busy}
                placeholder="Add member — search by name or email…"
                onPick={(m) =>
                  post('/api/admin/community/cohorts', { cohortId: c.id, addMemberId: m.id }, 'PATCH')
                }
              />
            </div>
          </li>
        ))}
        {cohorts.length === 0 && <li className="text-sm text-gray-400">No cohorts yet.</li>}
      </ul>
    </section>
  )
}

function EntitlementsSection({
  tiers,
  entitlements,
  busy,
  post,
}: {
  tiers: AdminTier[]
  entitlements: AdminEntitlement[]
  busy: boolean
  post: Poster
}) {
  const key = (tierId: string, type: string) => `${tierId}:${type}`

  // Seed editable state from existing rows: included count + extra-session price ID.
  const [cells, setCells] = useState<Record<string, { included: number; priceId: string }>>(() => {
    const init: Record<string, { included: number; priceId: string }> = {}
    for (const t of tiers) {
      for (const ty of ['coaching', 'mentoring'] as const) {
        const e = entitlements.find((x) => x.tier_id === t.id && x.session_type === ty)
        init[key(t.id, ty)] = {
          included: e?.included_sessions ?? 0,
          priceId: e?.extra_stripe_price_id ?? '',
        }
      }
    }
    return init
  })

  const update = (tierId: string, ty: string, patch: Partial<{ included: number; priceId: string }>) =>
    setCells((prev) => ({ ...prev, [key(tierId, ty)]: { ...prev[key(tierId, ty)], ...patch } }))

  // Save both fields together so neither overwrites the other on the server.
  const save = (tierId: string, ty: 'coaching' | 'mentoring') => {
    const c = cells[key(tierId, ty)]
    post('/api/admin/community/session-entitlements', {
      tierId,
      sessionType: ty,
      includedSessions: c.included,
      extraStripePriceId: c.priceId || null,
    })
  }

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold text-gray-900">Sessions per tier</h2>
      <p className="mb-3 text-sm text-gray-500">
        Included coaching / mentoring sessions per tier, and the Stripe Price ID charged for each
        additional session beyond the included allowance. Editable any time.
      </p>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2 text-xs font-medium uppercase text-gray-500">Tier</th>
              <th className="px-3 py-2 text-xs font-medium uppercase text-gray-500">Coaching</th>
              <th className="px-3 py-2 text-xs font-medium uppercase text-gray-500">Mentoring</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tiers.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-2 align-top font-medium text-gray-900">{t.name}</td>
                {(['coaching', 'mentoring'] as const).map((ty) => {
                  const c = cells[key(t.id, ty)]
                  return (
                    <td key={ty} className="px-3 py-2 align-top">
                      <div className="flex flex-col gap-1.5">
                        <label className="flex items-center gap-2 text-xs text-gray-500">
                          <span className="w-14">Included</span>
                          <input
                            type="number"
                            min={0}
                            value={c.included}
                            onChange={(e) => update(t.id, ty, { included: Number(e.target.value) })}
                            onBlur={() => save(t.id, ty)}
                            disabled={busy}
                            className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900"
                          />
                        </label>
                        <label className="flex items-center gap-2 text-xs text-gray-500">
                          <span className="w-14">Extra price</span>
                          <input
                            type="text"
                            value={c.priceId}
                            onChange={(e) => update(t.id, ty, { priceId: e.target.value })}
                            onBlur={() => save(t.id, ty)}
                            placeholder="price_…"
                            disabled={busy}
                            className="w-44 rounded-md border border-gray-300 px-2 py-1 font-mono text-xs text-gray-900"
                          />
                        </label>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
