'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Minus, Plus, BookOpen } from 'lucide-react'
import { MemberSearchField, type PickedPerson } from '@/components/community/mentoring/MemberSearchField'
import { TIMEZONES, DEFAULT_TZ } from '@/lib/mentoring-format'
import { autoWorkshopName } from '@/lib/coaching-format'

type ModuleOpt = { id: string; title: string }
type TierOpt = { id: string; name: string }
type ResState = 'off' | 'optional' | 'mandatory'

const ADMIN_SEARCH = '/api/admin/members/search'

export function CreateWorkshopForm({ modules, tiers }: { modules: ModuleOpt[]; tiers: TierOpt[] }) {
  const router = useRouter()
  const [coach, setCoach] = useState<PickedPerson[]>([])
  const [memberSel, setMemberSel] = useState<PickedPerson[]>([])
  const [name, setName] = useState('')
  const [sessions, setSessions] = useState(6)
  const [timezone, setTimezone] = useState(DEFAULT_TZ)
  const [res, setRes] = useState<Record<string, ResState>>({})
  const [accessMode, setAccessMode] = useState<'free' | 'paid'>('free')
  const [priceUsd, setPriceUsd] = useState('')
  const [freeTierIds, setFreeTierIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const personName = (p?: PickedPerson) => (p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || null : null)
  const autoName = autoWorkshopName(personName(coach[0]), personName(memberSel[0]))

  const submit = async () => {
    if (!coach[0]) { setError('Choose a coach.'); return }
    if (!memberSel[0]) { setError('Choose a member to invite.'); return }
    setBusy(true)
    setError(null)
    const resources = Object.entries(res).filter(([, s]) => s !== 'off').map(([moduleId, s]) => ({ moduleId, mandatory: s === 'mandatory' }))
    try {
      const r = await fetch('/api/admin/community/coaching', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          coachMemberId: coach[0].id,
          memberId: memberSel[0].id,
          name: name.trim() || null,
          plannedSessions: sessions,
          timezone,
          resources,
          oneOffPriceCents: accessMode === 'paid' && priceUsd ? Math.round(Number(priceUsd) * 100) : null,
          freeForTierIds: accessMode === 'free' ? freeTierIds : [],
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) { setError(data.error ?? 'Could not create the workshop.'); setBusy(false); return }
      router.push(`/admin/academy/coaching/${data.workshopId}`)
    } catch {
      setError('Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6 rounded-panel border border-line bg-white p-6">
      <Field label="Coach" hint="The coach gains full management access to this workshop.">
        <MemberSearchField endpoint={ADMIN_SEARCH} selected={coach} onChange={(n) => setCoach(n.slice(-1))} placeholder="Search for a coach…" />
      </Field>

      <Field label="Member" hint="One-on-one — the member is invited (in-app + email) and joins only after accepting.">
        <MemberSearchField endpoint={ADMIN_SEARCH} selected={memberSel} onChange={(n) => setMemberSel(n.slice(-1))} placeholder="Search for a member…" />
      </Field>

      <Field label="Workshop name" hint={`Auto-named "${autoName}" — edit if you like.`}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={autoName} className="w-full rounded-[9px] border border-line px-3.5 py-2.5 text-sm outline-none focus:border-space-violet" />
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Number of sessions">
          <div className="inline-flex items-center gap-3 rounded-[9px] border border-line px-2 py-1.5">
            <button onClick={() => setSessions((n) => Math.max(1, n - 1))} className="rounded-md p-1.5 text-content-secondary hover:bg-surface" aria-label="Fewer"><Minus className="h-4 w-4" /></button>
            <span className="w-6 text-center font-display text-lg font-bold text-ink">{sessions}</span>
            <button onClick={() => setSessions((n) => Math.min(52, n + 1))} className="rounded-md p-1.5 text-content-secondary hover:bg-surface" aria-label="More"><Plus className="h-4 w-4" /></button>
          </div>
        </Field>
        <Field label="Time zone">
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full rounded-[9px] border border-line bg-white px-3.5 py-2.5 text-sm outline-none focus:border-space-violet">
            {TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Training & resources" hint="Choose which courses to include and whether each is mandatory.">
        {modules.length === 0 ? (
          <p className="text-sm text-content-muted">No published courses available yet.</p>
        ) : (
          <ul className="space-y-2">
            {modules.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 rounded-[12px] border border-line p-3">
                <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
                  <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-space-violet-bg text-space-violet"><BookOpen className="h-4 w-4" /></span>
                  {m.title}
                </span>
                <Segmented
                  small
                  options={[{ v: 'off', label: 'Off' }, { v: 'optional', label: 'Optional' }, { v: 'mandatory', label: 'Mandatory' }]}
                  value={res[m.id] ?? 'off'}
                  onChange={(v) => setRes((p) => ({ ...p, [m.id]: v as ResState }))}
                />
              </li>
            ))}
          </ul>
        )}
      </Field>

      <Field label="Access">
        <label className="flex items-start gap-2.5 text-sm text-content-body">
          <input type="radio" name="acc" checked={accessMode === 'free'} onChange={() => setAccessMode('free')} className="mt-0.5 accent-space-violet" />
          <span>Free via membership tier — members on an eligible tier get this at no charge.</span>
        </label>
        {accessMode === 'free' && tiers.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
            {tiers.map((t) => {
              const on = freeTierIds.includes(t.id)
              return (
                <button key={t.id} type="button" onClick={() => setFreeTierIds((p) => (on ? p.filter((x) => x !== t.id) : [...p, t.id]))} className={`rounded-pill px-2.5 py-1 text-[12.5px] font-medium ${on ? 'bg-space-violet text-white' : 'bg-surface text-content-secondary'}`}>
                  {t.name}
                </button>
              )
            })}
          </div>
        )}
        <label className="mt-2 flex items-start gap-2.5 text-sm text-content-body">
          <input type="radio" name="acc" checked={accessMode === 'paid'} onChange={() => setAccessMode('paid')} className="mt-0.5 accent-space-violet" />
          <span>Paid — one-off price (USD, via Stripe).</span>
        </label>
        {accessMode === 'paid' && (
          <div className="mt-2 pl-6">
            <div className="inline-flex items-center gap-1.5 rounded-[9px] border border-line px-3 py-2">
              <span className="text-sm text-content-muted">$</span>
              <input value={priceUsd} onChange={(e) => setPriceUsd(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="40" inputMode="decimal" className="w-20 text-sm outline-none" />
            </div>
          </div>
        )}
      </Field>

      {error && <p className="text-sm font-medium text-danger">{error}</p>}

      <div className="flex items-center justify-end gap-2 border-t border-line-light pt-4">
        <button onClick={() => router.back()} className="rounded-[9px] px-4 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface">Cancel</button>
        <button onClick={submit} disabled={busy} className="rounded-[9px] bg-space-violet px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5B3FE0] disabled:opacity-50">
          {busy ? 'Creating…' : 'Create workshop & send invite'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12.5px] font-semibold text-content-secondary">{label}</label>
      {hint ? <p className="mb-2 mt-0.5 text-[12px] text-content-muted">{hint}</p> : <div className="mb-2" />}
      {children}
    </div>
  )
}

function Segmented({ options, value, onChange, small }: { options: { v: string; label: string }[]; value: string; onChange: (v: string) => void; small?: boolean }) {
  return (
    <div className="inline-flex rounded-[9px] border border-line p-0.5">
      {options.map((o) => {
        const on = o.v === value
        return (
          <button key={o.v} type="button" onClick={() => onChange(o.v)} className={`rounded-[7px] font-medium transition-colors ${small ? 'px-2.5 py-1 text-[12px]' : 'px-4 py-1.5 text-sm'} ${on ? 'bg-space-violet text-white' : 'text-content-secondary hover:text-ink'}`}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
