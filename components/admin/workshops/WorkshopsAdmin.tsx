'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Pencil, Archive, Trash2 } from 'lucide-react'
import { formatUsd, TIMEZONES, type CohortTheme } from '@/lib/mentoring-format'
import { MemberSearchField, type PickedPerson } from '@/components/community/mentoring/MemberSearchField'

export interface AdminWorkshop {
  id: string
  name: string
  theme: CohortTheme
  mentorName: string | null
  memberCount: number
  isOpen: boolean
  oneOffPriceCents: number | null
  creditCost: number
  freeForTierIds: string[]
  lifecycle: 'active' | 'archived'
}
export interface TierOpt { id: string; name: string }
export interface Pricing {
  cohortPriceCents: number
  workshopPriceCents: number
  cohortCreditPriceCents: number
  workshopCreditPriceCents: number
}

async function adminPost(payload: Record<string, unknown>) {
  const res = await fetch('/api/admin/community/workshops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return res.ok
}

interface Draft {
  id: string
  name: string
  blurb: string
  theme: CohortTheme
  timezone: string
  plannedSessions: number
  isOpen: boolean
  priceDollars: string
  creditCost: number
  freeForTierIds: string[]
  coach: PickedPerson | null
}

export function WorkshopsAdmin({ initialWorkshops, tiers, pricing }: { initialWorkshops: AdminWorkshop[]; tiers: TierOpt[]; pricing: Pricing }) {
  const router = useRouter()
  const [workshops] = useState(initialWorkshops)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pr, setPr] = useState(pricing)

  const newDraft = (): Draft => ({
    id: '',
    name: '',
    blurb: '',
    theme: 'space',
    timezone: 'America/Chicago',
    plannedSessions: 1,
    isOpen: true,
    priceDollars: pricing.workshopPriceCents ? String(pricing.workshopPriceCents / 100) : '',
    creditCost: 1,
    freeForTierIds: [],
    coach: null,
  })

  const editDraft = (w: AdminWorkshop): Draft => ({
    id: w.id,
    name: w.name,
    blurb: '',
    theme: w.theme,
    timezone: 'America/Chicago',
    plannedSessions: 1,
    isOpen: w.isOpen,
    priceDollars: w.oneOffPriceCents != null ? String(w.oneOffPriceCents / 100) : '',
    creditCost: w.creditCost,
    freeForTierIds: w.freeForTierIds,
    coach: null,
  })

  const archive = async (w: AdminWorkshop) => {
    if (!confirm(`Archive “${w.name}”?`)) return
    await adminPost({ action: 'archive', workshopId: w.id })
    router.refresh()
  }
  const remove = async (w: AdminWorkshop) => {
    if (!confirm(`Delete “${w.name}”? Spent credits are refunded to members.`)) return
    await adminPost({ action: 'delete', workshopId: w.id })
    router.refresh()
  }

  const savePricing = async (patch: Partial<Pricing>) => {
    const next = { ...pr, ...patch }
    setPr(next)
    await adminPost({ action: 'updatePricing', ...patch })
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">Coaching workshops</h1>
        <button onClick={() => setDraft(newDraft())} className="inline-flex items-center gap-2 rounded-[9px] bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-deep">
          <Plus className="h-4 w-4" /> New workshop
        </button>
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-card border border-line bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line-light text-left text-[12px] font-semibold uppercase tracking-[0.05em] text-content-faint">
              <th className="px-5 py-3">Workshop</th>
              <th className="px-5 py-3">Coach</th>
              <th className="px-5 py-3">Members</th>
              <th className="px-5 py-3">Price</th>
              <th className="px-5 py-3">Credits</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {workshops.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-content-muted">No workshops yet.</td></tr>
            ) : (
              workshops.map((w) => (
                <tr key={w.id} className="border-b border-line-light last:border-0">
                  <td className="px-5 py-3 font-medium text-ink">{w.name}</td>
                  <td className="px-5 py-3 text-content-secondary">{w.mentorName ?? '—'}</td>
                  <td className="px-5 py-3 text-content-secondary">{w.memberCount}</td>
                  <td className="px-5 py-3 text-content-secondary">{w.oneOffPriceCents != null ? formatUsd(w.oneOffPriceCents) : '—'}</td>
                  <td className="px-5 py-3 text-content-secondary">{w.creditCost}</td>
                  <td className="px-5 py-3">
                    {w.lifecycle === 'archived' ? (
                      <span className="rounded-pill bg-surface px-2.5 py-0.5 text-[12px] font-semibold text-content-muted">Archived</span>
                    ) : w.isOpen ? (
                      <span className="rounded-pill bg-enviro-green-bg px-2.5 py-0.5 text-[12px] font-semibold text-enviro-green-text">Open</span>
                    ) : (
                      <span className="rounded-pill bg-surface px-2.5 py-0.5 text-[12px] font-semibold text-content-muted">Closed</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => setDraft(editDraft(w))} title="Edit"><Pencil className="h-4 w-4 text-content-faint hover:text-primary" /></button>
                      <button onClick={() => archive(w)} title="Archive"><Archive className="h-4 w-4 text-content-faint hover:text-amber-600" /></button>
                      <button onClick={() => remove(w)} title="Delete"><Trash2 className="h-4 w-4 text-content-faint hover:text-red-600" /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Flat pricing defaults */}
      <section className="rounded-card border border-line bg-white p-5">
        <h2 className="font-display text-[17px] font-bold text-ink">Flat pricing defaults</h2>
        <p className="mt-1 text-[12.5px] text-content-faint">
          Default one-off prices and per-credit top-up prices (USD). New workshops/cohorts prefill from these; you can override per workshop.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-4">
          <PriceField label="Workshop price" cents={pr.workshopPriceCents} onSave={(c) => savePricing({ workshopPriceCents: c })} />
          <PriceField label="Cohort price" cents={pr.cohortPriceCents} onSave={(c) => savePricing({ cohortPriceCents: c })} />
          <PriceField label="Workshop credit" cents={pr.workshopCreditPriceCents} onSave={(c) => savePricing({ workshopCreditPriceCents: c })} />
          <PriceField label="Cohort credit" cents={pr.cohortCreditPriceCents} onSave={(c) => savePricing({ cohortCreditPriceCents: c })} />
        </div>
      </section>

      {draft && <WorkshopForm draft={draft} tiers={tiers} onChange={setDraft} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); router.refresh() }} />}
    </div>
  )
}

function PriceField({ label, cents, onSave }: { label: string; cents: number; onSave: (cents: number) => void }) {
  const [val, setVal] = useState(cents ? String(cents / 100) : '')
  return (
    <div>
      <label className="mb-1 block text-[12px] font-semibold text-content-secondary">{label}</label>
      <div className="inline-flex items-center gap-1.5 rounded-[9px] border border-line px-3 py-2">
        <span className="text-sm text-content-muted">$</span>
        <input
          value={val}
          onChange={(e) => setVal(e.target.value.replace(/[^0-9.]/g, ''))}
          onBlur={() => onSave(val ? Math.round(Number(val) * 100) : 0)}
          placeholder="0"
          inputMode="decimal"
          className="w-20 text-sm outline-none"
        />
      </div>
    </div>
  )
}

function WorkshopForm({
  draft,
  tiers,
  onChange,
  onClose,
  onSaved,
}: {
  draft: Draft
  tiers: TierOpt[]
  onChange: (d: Draft) => void
  onClose: () => void
  onSaved: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })

  const save = async () => {
    setBusy(true)
    setError(null)
    const oneOffPriceCents = draft.priceDollars ? Math.round(Number(draft.priceDollars) * 100) : null
    const payload = {
      action: draft.id ? 'update' : 'create',
      ...(draft.id ? { workshopId: draft.id } : {}),
      name: draft.name,
      blurb: draft.blurb || null,
      theme: draft.theme,
      timezone: draft.timezone,
      plannedSessions: draft.plannedSessions,
      isOpen: draft.isOpen,
      oneOffPriceCents,
      creditCost: draft.creditCost,
      freeForTierIds: draft.freeForTierIds,
      coachMemberId: draft.coach?.id ?? (draft.id ? undefined : null),
    }
    const ok = await adminPost(payload)
    if (ok) onSaved()
    else {
      setError('Could not save workshop.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(14,19,48,.55)' }} onClick={onClose}>
      <div className="w-full max-w-[520px] max-h-[90vh] overflow-y-auto rounded-[18px] bg-white p-6 shadow-[0_30px_70px_-20px_rgba(0,0,0,.5)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="font-display text-[20px] font-bold text-ink">{draft.id ? 'Edit workshop' : 'New workshop'}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-content-faint hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-4 space-y-3">
          <Field label="Name">
            <input value={draft.name} onChange={(e) => set({ name: e.target.value })} className="w-full rounded-[9px] border border-line px-3 py-2 text-sm" />
          </Field>
          <Field label="Short description">
            <textarea value={draft.blurb} onChange={(e) => set({ blurb: e.target.value })} rows={2} className="w-full rounded-[9px] border border-line px-3 py-2 text-sm" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Theme">
              <select value={draft.theme} onChange={(e) => set({ theme: e.target.value as CohortTheme })} className="w-full rounded-[9px] border border-line px-3 py-2 text-sm">
                <option value="space">Space (violet)</option>
                <option value="enviro">Enviro (green)</option>
              </select>
            </Field>
            <Field label="Sessions">
              <input value={draft.plannedSessions} onChange={(e) => set({ plannedSessions: Math.max(1, Number(e.target.value.replace(/[^0-9]/g, '')) || 1) })} className="w-full rounded-[9px] border border-line px-3 py-2 text-sm" />
            </Field>
          </div>

          <Field label="Timezone">
            <select value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })} className="w-full rounded-[9px] border border-line px-3 py-2 text-sm">
              {TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>

          <Field label="Coach (optional)">
            <MemberSearchField selected={draft.coach ? [draft.coach] : []} onChange={(next) => set({ coach: next[next.length - 1] ?? null })} placeholder="Search a coach by name or email…" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="One-off price (USD)">
              <div className="inline-flex w-full items-center gap-1.5 rounded-[9px] border border-line px-3 py-2">
                <span className="text-sm text-content-muted">$</span>
                <input value={draft.priceDollars} onChange={(e) => set({ priceDollars: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="0" inputMode="decimal" className="w-full text-sm outline-none" />
              </div>
            </Field>
            <Field label="Credit cost">
              <input value={draft.creditCost} onChange={(e) => set({ creditCost: Math.max(1, Number(e.target.value.replace(/[^0-9]/g, '')) || 1) })} className="w-full rounded-[9px] border border-line px-3 py-2 text-sm" />
            </Field>
          </div>

          <Field label="Free for membership tiers">
            <div className="flex flex-wrap gap-1.5">
              {tiers.map((t) => {
                const on = draft.freeForTierIds.includes(t.id)
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => set({ freeForTierIds: on ? draft.freeForTierIds.filter((x) => x !== t.id) : [...draft.freeForTierIds, t.id] })}
                    className={`rounded-pill px-2.5 py-1 text-[12.5px] font-medium ${on ? 'bg-space-violet text-white' : 'bg-surface text-content-secondary'}`}
                  >
                    {t.name}
                  </button>
                )
              })}
            </div>
          </Field>

          <label className="flex items-center gap-2 text-sm text-content-secondary">
            <input type="checkbox" checked={draft.isOpen} onChange={(e) => set({ isOpen: e.target.checked })} />
            Open for self-registration (discoverable)
          </label>

          {error && <p className="text-sm font-medium text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="rounded-[9px] px-4 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface">Cancel</button>
            <button onClick={save} disabled={busy || !draft.name} className="rounded-[9px] bg-space-violet px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5B3FE0] disabled:opacity-50">
              {busy ? 'Saving…' : draft.id ? 'Save changes' : 'Create workshop'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[12.5px] font-semibold text-content-secondary">{label}</label>
      {children}
    </div>
  )
}
