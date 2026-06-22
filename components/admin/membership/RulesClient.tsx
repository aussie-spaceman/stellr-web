'use client'

import { useState } from 'react'
import { Plus, Trash2, Power, Pencil } from 'lucide-react'

export interface RuleRow {
  id: string
  name: string
  trigger_type: string
  conditions: { age_bracket?: string; event_role?: string; award_contains?: string; source_tier_ids?: string[] }
  grant_tier_id: string
  duration_kind: 'months' | 'until_grad_july1' | 'lifetime' | 'match_source'
  duration_months: number | null
  grant_target: 'self' | 'registered_students'
  replaces_free: boolean
  priority: number
  is_active: boolean
}

export interface TierOption {
  id: string
  name: string
  is_free: boolean
}

const TRIGGERS: Record<string, string> = {
  signup: 'signs up',
  event_attendance: 'attends an event',
  event_award: 'wins an award',
  mentor_at_event: 'mentors at an event',
  subscribe_website: 'subscribes on the website',
  graduation: 'graduates high school',
  manual: 'is granted manually',
  competition_registration: 'registers for a competition',
  tier_purchased: 'buys / is granted a tier',
}

const ROLES = ['', 'school_student', 'school_student_manager', 'teacher', 'mentor', 'parent', 'adult']
const BRACKETS = ['', 'high_school', 'college', 'adult']

function durationLabel(r: RuleRow): string {
  if (r.duration_kind === 'until_grad_july1') return 'until July 1 of grad year'
  if (r.duration_kind === 'lifetime') return 'lifetime'
  if (r.duration_kind === 'match_source') return 'matching the triggering membership'
  return r.duration_months ? `${r.duration_months} months` : 'until removed'
}

const emptyDraft = (tierId: string): RuleRow => ({
  id: '',
  name: '',
  trigger_type: 'event_attendance',
  conditions: {},
  grant_tier_id: tierId,
  duration_kind: 'months',
  duration_months: 12,
  grant_target: 'self',
  replaces_free: true,
  priority: 10,
  is_active: true,
})

export function RulesClient({ initialRules, tiers }: { initialRules: RuleRow[]; tiers: TierOption[] }) {
  const [rules, setRules] = useState<RuleRow[]>(initialRules)
  const [draft, setDraft] = useState<RuleRow | null>(null)
  const tierName = (id: string) => tiers.find((t) => t.id === id)?.name ?? '—'

  const refresh = async () => {
    const res = await fetch('/api/admin/membership/rules')
    const json = await res.json()
    setRules(json.rules ?? [])
  }

  const toggle = async (r: RuleRow) => {
    setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, is_active: !x.is_active } : x)))
    await fetch('/api/admin/membership/rules', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: r.id, is_active: !r.is_active }),
    })
  }

  const remove = async (r: RuleRow) => {
    if (!confirm(`Delete rule “${r.name}”?`)) return
    setRules((rs) => rs.filter((x) => x.id !== r.id))
    await fetch('/api/admin/membership/rules', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: r.id }),
    })
  }

  const submit = async () => {
    if (!draft) return
    const isNew = !draft.id
    await fetch('/api/admin/membership/rules', {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    })
    setDraft(null)
    await refresh()
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setDraft(emptyDraft(tiers[0]?.id ?? ''))}
          className="text-sm flex items-center gap-1 bg-brand-blue text-white rounded-md px-3 py-1.5 hover:bg-brand-blue-dark"
        >
          <Plus className="w-4 h-4" /> Add rule
        </button>
      </div>

      <div className="space-y-2">
        {rules.length === 0 && (
          <p className="text-sm text-brand-muted-soft text-center py-8">No grant rules yet. Add one to automate tier assignment.</p>
        )}
        {rules.map((r) => (
          <div key={r.id} className="bg-white border border-brand-border rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span className="font-medium text-brand-blue-dark">{r.name || '(untitled)'}</span>
              <span className="text-brand-muted-soft">·</span>
              <span className="text-brand-muted-soft">When</span>
              <Chip color="amber">{TRIGGERS[r.trigger_type] ?? r.trigger_type}</Chip>
              {r.conditions.source_tier_ids?.length ? (
                <Chip color="gray">tier: {r.conditions.source_tier_ids.map(tierName).join(', ')}</Chip>
              ) : null}
              {r.conditions.event_role && <Chip color="gray">role: {r.conditions.event_role}</Chip>}
              {r.conditions.age_bracket && <Chip color="gray">{r.conditions.age_bracket}</Chip>}
              {r.conditions.award_contains && <Chip color="gray">award ~ “{r.conditions.award_contains}”</Chip>}
              <span className="text-brand-muted-soft">grant</span>
              <Chip color="blue">{tierName(r.grant_tier_id)}</Chip>
              {r.grant_target === 'registered_students' && <Chip color="gray">to registered students</Chip>}
              <span className="text-brand-muted-soft">for</span>
              <Chip color="purple">{durationLabel(r)}</Chip>
              <span className="ml-auto flex items-center gap-3">
                <span className="text-[11px] text-brand-muted-soft">priority {r.priority}</span>
                <button onClick={() => toggle(r)} title={r.is_active ? 'Active' : 'Paused'}>
                  <Power className={'w-4 h-4 ' + (r.is_active ? 'text-green-600' : 'text-brand-muted-soft')} />
                </button>
                <button onClick={() => setDraft(r)} title="Edit">
                  <Pencil className="w-4 h-4 text-brand-muted-soft hover:text-brand-muted" />
                </button>
                <button onClick={() => remove(r)} title="Delete">
                  <Trash2 className="w-4 h-4 text-brand-muted-soft hover:text-red-600" />
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>

      {draft && (
        <RuleForm
          draft={draft}
          tiers={tiers}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSubmit={submit}
        />
      )}
    </div>
  )
}

function Chip({ color, children }: { color: string; children: React.ReactNode }) {
  const map: Record<string, string> = {
    amber: 'bg-amber-100 text-amber-800',
    blue: 'bg-brand-blue/10 text-brand-blue',
    purple: 'bg-purple-100 text-purple-800',
    gray: 'bg-brand-hairline text-brand-muted',
  }
  return <span className={'px-2 py-0.5 rounded-md text-xs ' + (map[color] ?? map.gray)}>{children}</span>
}

function RuleForm({
  draft,
  tiers,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: RuleRow
  tiers: TierOption[]
  onChange: (r: RuleRow) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const set = (patch: Partial<RuleRow>) => onChange({ ...draft, ...patch })
  const setCond = (patch: Partial<RuleRow['conditions']>) =>
    onChange({ ...draft, conditions: { ...draft.conditions, ...patch } })

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl p-5 w-full max-w-lg space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="font-semibold text-brand-blue-dark">{draft.id ? 'Edit rule' : 'New grant rule'}</h2>

        <Field label="Rule name">
          <input
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="e.g. Award winner → Scholar (1yr)"
            className="w-full text-sm border border-brand-border rounded-md px-2 py-1.5"
          />
        </Field>

        <Field label="When (trigger)">
          <select value={draft.trigger_type} onChange={(e) => set({ trigger_type: e.target.value })} className="w-full text-sm border border-brand-border rounded-md px-2 py-1.5">
            {Object.entries(TRIGGERS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>

        {draft.trigger_type === 'tier_purchased' && (
          <Field label="…and the tier they got is one of (leave empty = any paid tier)">
            <div className="flex flex-wrap gap-1.5">
              {tiers.filter((t) => !t.is_free).map((t) => {
                const sel = draft.conditions.source_tier_ids ?? []
                const on = sel.includes(t.id)
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setCond({ source_tier_ids: on ? sel.filter((x) => x !== t.id) : [...sel, t.id] })}
                    className={'px-2 py-1 rounded-md text-xs border ' + (on ? 'bg-brand-blue text-white border-brand-blue' : 'border-brand-border text-brand-muted')}
                  >
                    {t.name}
                  </button>
                )
              })}
            </div>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="…and role is (optional)">
            <select value={draft.conditions.event_role ?? ''} onChange={(e) => setCond({ event_role: e.target.value || undefined })} className="w-full text-sm border border-brand-border rounded-md px-2 py-1.5">
              {ROLES.map((r) => <option key={r} value={r}>{r || 'any role'}</option>)}
            </select>
          </Field>
          <Field label="…and bracket is (optional)">
            <select value={draft.conditions.age_bracket ?? ''} onChange={(e) => setCond({ age_bracket: e.target.value || undefined })} className="w-full text-sm border border-brand-border rounded-md px-2 py-1.5">
              {BRACKETS.map((b) => <option key={b} value={b}>{b || 'any bracket'}</option>)}
            </select>
          </Field>
        </div>

        {draft.trigger_type === 'event_award' && (
          <Field label="…and award text contains (optional)">
            <input value={draft.conditions.award_contains ?? ''} onChange={(e) => setCond({ award_contains: e.target.value || undefined })} placeholder="e.g. winner" className="w-full text-sm border border-brand-border rounded-md px-2 py-1.5" />
          </Field>
        )}

        <Field label="Grant tier">
          <select value={draft.grant_tier_id} onChange={(e) => set({ grant_tier_id: e.target.value })} className="w-full text-sm border border-brand-border rounded-md px-2 py-1.5">
            {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_free ? ' (free)' : ''}</option>)}
          </select>
        </Field>

        <Field label="Grant to">
          <select value={draft.grant_target} onChange={(e) => set({ grant_target: e.target.value as RuleRow['grant_target'] })} className="w-full text-sm border border-brand-border rounded-md px-2 py-1.5">
            <option value="self">The member who triggered it</option>
            <option value="registered_students">The students they registered (their cohort)</option>
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration">
            <select value={draft.duration_kind} onChange={(e) => set({ duration_kind: e.target.value as RuleRow['duration_kind'] })} className="w-full text-sm border border-brand-border rounded-md px-2 py-1.5">
              <option value="months">For N months</option>
              <option value="until_grad_july1">Until July 1 of grad year</option>
              <option value="lifetime">Lifetime</option>
              <option value="match_source">Match the triggering membership</option>
            </select>
          </Field>
          {draft.duration_kind === 'months' && (
            <Field label="Months">
              <input value={draft.duration_months ?? ''} onChange={(e) => set({ duration_months: e.target.value ? Number(e.target.value.replace(/[^0-9]/g, '')) : null })} className="w-full text-sm border border-brand-border rounded-md px-2 py-1.5" />
            </Field>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority (higher wins)">
            <input value={draft.priority} onChange={(e) => set({ priority: Number(e.target.value.replace(/[^0-9]/g, '') || 0) })} className="w-full text-sm border border-brand-border rounded-md px-2 py-1.5" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-brand-muted mt-6">
            <input type="checkbox" checked={draft.replaces_free} onChange={(e) => set({ replaces_free: e.target.checked })} />
            Replace active free tier
          </label>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={onSubmit} disabled={!draft.name || !draft.grant_tier_id} className="flex-1 text-sm bg-brand-blue text-white rounded-md py-2 hover:bg-brand-blue-dark disabled:opacity-40">
            {draft.id ? 'Save changes' : 'Create rule'}
          </button>
          <button onClick={onCancel} className="flex-1 text-sm border border-brand-border rounded-md py-2 text-brand-muted hover:bg-brand-canvas">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-brand-muted-soft mb-1">{label}</label>
      {children}
    </div>
  )
}
