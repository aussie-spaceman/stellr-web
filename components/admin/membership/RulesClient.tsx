'use client'

import { useEffect, useId, useState } from 'react'
import { Plus, Trash2, Power, Pencil } from 'lucide-react'
import { Choice, Dialog, Field, Input, Select } from '@stellr/web-ui'

export interface RuleRow {
  id: string
  name: string
  trigger_type: string
  conditions: { age_bracket?: string; event_role?: string; award_contains?: string; source_tier_ids?: string[] }
  grant_tier_id: string
  duration_kind: 'months' | 'until_grad_july1' | 'lifetime' | 'match_source' | 'until_date'
  duration_months: number | null
  duration_until?: string | null
  grant_target: 'self' | 'registered_students'
  replaces_free: boolean
  priority: number
  is_active: boolean
  /** 'tier' (default) grants a tier; 'credits' wallet credits; 'attach_object' /
   * 'roster_add' are the object-anchored kinds (admin/access convergence). */
  grant_kind?: 'tier' | 'credits' | 'attach_object' | 'roster_add'
  grant_credit_type?: 'mentoring' | 'workshop' | null
  grant_quantity?: number | null
  /** object_created anchor: the type (and optionally one specific object) the rule fires for. */
  object_type?: string | null
  object_anchor_ref?: string | null
  /** Minimum tier filter, by canonical tier name. */
  tier_min?: string | null
  grant_object_type?: string | null
  grant_object_ref?: string | null
  grant_role?: string | null
  /** Target chosen at creation time by the New Object wizard instead of here. */
  is_dynamic?: boolean
}

export interface ObjectOption {
  objectType: string
  ref: string
  label: string
}

const OBJECT_TYPES = ['space', 'course', 'workshop', 'cohort', 'event', 'campaign', 'resource']
const TIER_MIN_NAMES = ['Explorer', 'Pathfinder', 'Scholar', 'Alumni', 'Contributor', 'Counselor', 'Educator', 'Catalyst', 'Innovator', 'Trailblazer']

export interface TierOption {
  id: string
  name: string
  is_free: boolean
}

// Label map for every trigger value (used to render existing rule chips, incl.
// legacy values no longer offered for new rules).
const TRIGGERS: Record<string, string> = {
  signup: 'account created',
  competition_registration: 'registers for a competition',
  volunteer_registration: 'registered as a volunteer',
  graduation: 'graduates high school',
  tier_purchased: 'buys / is granted a tier',
  object_created: 'a new object is created',
  manual: 'is granted manually',
  subscribe_website: 'subscribes on the website',
  // Legacy triggers — kept so existing rules render, not offered for new rules.
  event_attendance: 'attends an event',
  event_award: 'wins an award',
  mentor_at_event: 'mentors at an event',
}

// Triggers offered when creating/editing a rule, in display order. The first four
// are the member-facing events; the rest are operational.
const TRIGGER_OPTIONS = [
  'signup', 'competition_registration', 'volunteer_registration', 'graduation',
  'tier_purchased', 'object_created', 'subscribe_website', 'manual',
]

// "Role is" filters on members.event_role (matched in lib/membership-grants.ts),
// so options must be valid event_role values — the full web-app role set.
const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'any role' },
  { value: 'participant', label: 'Participant' },
  { value: 'school_student_manager', label: 'Student Manager' },
  { value: 'teacher', label: 'Teacher' },
  { value: 'mentor', label: 'Mentor' },
  { value: 'volunteer', label: 'Volunteer' },
  { value: 'parent', label: 'Parent' },
  { value: 'adult', label: 'Adult' },
  { value: 'subscriber', label: 'Subscriber' },
]
const ROLE_LABEL: Record<string, string> = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]))
const BRACKETS = ['', 'high_school', 'college', 'adult']

function durationLabel(r: RuleRow): string {
  if (r.duration_kind === 'until_date') return r.duration_until ? `until ${r.duration_until}` : 'until a date'
  if (r.duration_kind === 'until_grad_july1') return 'until July 1 of grad year'
  if (r.duration_kind === 'lifetime') return 'lifetime'
  if (r.duration_kind === 'match_source') return 'matching the triggering membership'
  return r.duration_months ? `${r.duration_months} months` : 'until removed'
}

const emptyDraft = (tierId: string): RuleRow => ({
  id: '',
  name: '',
  trigger_type: 'competition_registration',
  conditions: {},
  grant_tier_id: tierId,
  duration_kind: 'months',
  duration_months: 12,
  grant_target: 'self',
  replaces_free: true,
  priority: 10,
  is_active: true,
  grant_kind: 'tier',
  grant_credit_type: null,
  grant_quantity: null,
  duration_until: null,
  object_type: null,
  object_anchor_ref: null,
  tier_min: null,
  grant_object_type: null,
  grant_object_ref: null,
  grant_role: null,
  is_dynamic: false,
})

/** Label for a credit-granting rule, e.g. "2 workshop credits". */
function creditLabel(r: RuleRow): string {
  const n = r.grant_quantity ?? 0
  const kind = r.grant_credit_type === 'workshop' ? 'workshop' : 'cohort'
  return `${n} ${kind} credit${n === 1 ? '' : 's'}`
}

export function RulesClient({ initialRules, tiers }: { initialRules: RuleRow[]; tiers: TierOption[] }) {
  const [rules, setRules] = useState<RuleRow[]>(initialRules)
  const [draft, setDraft] = useState<RuleRow | null>(null)
  const [objects, setObjects] = useState<ObjectOption[]>([])
  const tierName = (id: string) => tiers.find((t) => t.id === id)?.name ?? '—'
  const objectLabel = (ref: string | null | undefined) =>
    (ref && objects.find((o) => o.ref === ref)?.label) || ref || '—'

  useEffect(() => {
    let active = true
    fetch('/api/admin/access/objects')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => active && j?.objects && setObjects(j.objects))
      .catch(() => {})
    return () => { active = false }
  }, [])

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
              <span className="text-brand-muted-soft">{r.trigger_type === 'object_created' && r.object_anchor_ref ? 'For' : 'When'}</span>
              {r.trigger_type === 'object_created' && r.object_anchor_ref ? (
                <Chip color="amber">{objectLabel(r.object_anchor_ref)}</Chip>
              ) : (
                <Chip color="amber">{TRIGGERS[r.trigger_type] ?? r.trigger_type}</Chip>
              )}
              {r.trigger_type === 'object_created' && r.object_type && (
                <Chip color="gray">new {r.object_type}</Chip>
              )}
              {r.tier_min && <Chip color="gray">{r.tier_min}+</Chip>}
              {r.conditions.source_tier_ids?.length ? (
                <Chip color="gray">tier: {r.conditions.source_tier_ids.map(tierName).join(', ')}</Chip>
              ) : null}
              {r.conditions.event_role && <Chip color="gray">role: {ROLE_LABEL[r.conditions.event_role] ?? r.conditions.event_role}</Chip>}
              {r.conditions.age_bracket && <Chip color="gray">{r.conditions.age_bracket}</Chip>}
              {r.conditions.award_contains && <Chip color="gray">award ~ “{r.conditions.award_contains}”</Chip>}
              <span className="text-brand-muted-soft">grant</span>
              {(r.grant_kind ?? 'tier') === 'credits' ? (
                <Chip color="blue">{creditLabel(r)}</Chip>
              ) : r.grant_kind === 'attach_object' ? (
                <Chip color="blue">attach: {r.is_dynamic ? 'chosen at creation' : objectLabel(r.grant_object_ref)}</Chip>
              ) : r.grant_kind === 'roster_add' ? (
                <Chip color="blue">add to: {objectLabel(r.grant_object_ref)}{r.grant_role ? ` as ${r.grant_role}` : ''}</Chip>
              ) : (
                <Chip color="blue">{tierName(r.grant_tier_id)}</Chip>
              )}
              {r.grant_target === 'registered_students' && <Chip color="gray">to registered students</Chip>}
              {(r.grant_kind ?? 'tier') === 'tier' && (
                <>
                  <span className="text-brand-muted-soft">for</span>
                  <Chip color="purple">{durationLabel(r)}</Chip>
                </>
              )}
              <span className="ml-auto flex items-center gap-3">
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
          objects={objects}
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
  objects,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: RuleRow
  tiers: TierOption[]
  objects: ObjectOption[]
  onChange: (r: RuleRow) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const set = (patch: Partial<RuleRow>) => onChange({ ...draft, ...patch })
  const setCond = (patch: Partial<RuleRow['conditions']>) =>
    onChange({ ...draft, conditions: { ...draft.conditions, ...patch } })
  const sourceTiersLabelId = useId()

  const grantKind = draft.grant_kind ?? 'tier'
  const canSubmit =
    !!draft.name &&
    (grantKind === 'credits'
      ? (draft.grant_quantity ?? 0) > 0
      : grantKind === 'attach_object' || grantKind === 'roster_add'
        ? !!draft.grant_object_type && (!!draft.grant_object_ref || !!draft.is_dynamic)
        : !!draft.grant_tier_id)

  return (
    <Dialog
      open
      onClose={onCancel}
      title={draft.id ? 'Edit rule' : 'New grant rule'}
      size="lg"
      bodyClassName="space-y-3"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-control border border-line-strong px-4 text-sm text-content-secondary hover:bg-surface"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="min-h-11 rounded-control bg-primary-deep px-4 text-sm font-semibold text-white hover:bg-ink disabled:opacity-40"
          >
            {draft.id ? 'Save changes' : 'Create rule'}
          </button>
        </>
      }
    >
      <Field labelSize="small" label="Rule name">
        <Input
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="e.g. Award winner → Scholar (1yr)"
        />
      </Field>

      <Field labelSize="small" label="When (trigger)">
        <Select value={draft.trigger_type} onChange={(e) => set({ trigger_type: e.target.value })}>
          {/* Include the current value even if it's a legacy trigger no longer offered. */}
          {(TRIGGER_OPTIONS.includes(draft.trigger_type) ? TRIGGER_OPTIONS : [draft.trigger_type, ...TRIGGER_OPTIONS]).map((v) => (
            <option key={v} value={v}>{TRIGGERS[v] ?? v}</option>
          ))}
        </Select>
      </Field>

      {draft.trigger_type === 'object_created' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field labelSize="small" label="…of type">
              <Select value={draft.object_type ?? ''} onChange={(e) => set({ object_type: e.target.value || null })}>
                <option value="">choose a type…</option>
                {OBJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <Field labelSize="small" label="…minimum tier (optional)">
              <Select value={draft.tier_min ?? ''} onChange={(e) => set({ tier_min: e.target.value || null })}>
                <option value="">any tier</option>
                {TIER_MIN_NAMES.map((t) => <option key={t} value={t}>{t}+</option>)}
              </Select>
            </Field>
          </div>
          <Field labelSize="small" label="For one specific object (optional — leave empty for every new object of the type)">
            <Select value={draft.object_anchor_ref ?? ''} onChange={(e) => set({ object_anchor_ref: e.target.value || null })}>
              <option value="">any {draft.object_type || 'object'}</option>
              {objects.filter((o) => !draft.object_type || o.objectType === draft.object_type).map((o) => (
                <option key={o.ref} value={o.ref}>{o.label}</option>
              ))}
            </Select>
          </Field>
        </>
      )}

      {draft.trigger_type === 'tier_purchased' && (
        <div role="group" aria-labelledby={sourceTiersLabelId} className="space-y-1.5">
          <p id={sourceTiersLabelId} className="font-subheading text-xs font-medium text-content-muted">
            …and the tier they got is one of (leave empty = any paid tier)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {tiers.filter((t) => !t.is_free).map((t) => {
              const sel = draft.conditions.source_tier_ids ?? []
              const on = sel.includes(t.id)
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setCond({ source_tier_ids: on ? sel.filter((x) => x !== t.id) : [...sel, t.id] })}
                  className={'px-2 py-1 rounded-md text-xs border ' + (on ? 'bg-brand-blue text-white border-brand-blue' : 'border-line-strong text-brand-muted')}
                >
                  {t.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field labelSize="small" label="…and role is (optional)">
          <Select value={draft.conditions.event_role ?? ''} onChange={(e) => setCond({ event_role: e.target.value || undefined })}>
            {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        </Field>
        <Field labelSize="small" label="…and bracket is (optional)">
          <Select value={draft.conditions.age_bracket ?? ''} onChange={(e) => setCond({ age_bracket: e.target.value || undefined })}>
            {BRACKETS.map((b) => <option key={b} value={b}>{b || 'any bracket'}</option>)}
          </Select>
        </Field>
      </div>

      {draft.trigger_type === 'event_award' && (
        <Field labelSize="small" label="…and award text contains (optional)">
          <Input value={draft.conditions.award_contains ?? ''} onChange={(e) => setCond({ award_contains: e.target.value || undefined })} placeholder="e.g. winner" />
        </Field>
      )}

      <Field labelSize="small" label="Grant">
        <Select value={draft.grant_kind ?? 'tier'} onChange={(e) => set({ grant_kind: e.target.value as RuleRow['grant_kind'] })}>
          <option value="tier">A membership tier</option>
          <option value="credits">Wallet credits (cohort / workshop)</option>
          <option value="attach_object">Attach an object</option>
          <option value="roster_add">Add to a roster</option>
        </Select>
      </Field>

      {(draft.grant_kind ?? 'tier') === 'credits' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field labelSize="small" label="Credit type">
            <Select value={draft.grant_credit_type ?? 'workshop'} onChange={(e) => set({ grant_credit_type: e.target.value as RuleRow['grant_credit_type'] })}>
              <option value="workshop">Workshop credits</option>
              <option value="mentoring">Cohort credits</option>
            </Select>
          </Field>
          <Field labelSize="small" label="Quantity">
            <Input value={draft.grant_quantity ?? ''} onChange={(e) => set({ grant_quantity: e.target.value ? Number(e.target.value.replace(/[^0-9]/g, '')) : null })} placeholder="e.g. 2" />
          </Field>
        </div>
      ) : draft.grant_kind === 'attach_object' || draft.grant_kind === 'roster_add' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field labelSize="small" label={draft.grant_kind === 'attach_object' ? 'Object type to attach' : 'Roster object type'}>
              <Select value={draft.grant_object_type ?? ''} onChange={(e) => set({ grant_object_type: e.target.value || null })}>
                <option value="">choose a type…</option>
                {OBJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <Field labelSize="small" label={draft.grant_kind === 'attach_object' ? 'Object to attach' : 'Roster to add to'}>
              <Select value={draft.grant_object_ref ?? ''} onChange={(e) => set({ grant_object_ref: e.target.value || null })} disabled={!!draft.is_dynamic}>
                <option value="">choose an object…</option>
                {objects.filter((o) => !draft.grant_object_type || o.objectType === draft.grant_object_type).map((o) => (
                  <option key={o.ref} value={o.ref}>{o.label}</option>
                ))}
              </Select>
            </Field>
          </div>
          {draft.grant_kind === 'roster_add' && (
            <Field labelSize="small" label="…as role (optional)">
              <Input value={draft.grant_role ?? ''} onChange={(e) => set({ grant_role: e.target.value || null })} placeholder="e.g. volunteer" />
            </Field>
          )}
          {draft.grant_kind === 'attach_object' && (
            <Choice
              checked={!!draft.is_dynamic}
              onChange={(e) => set({ is_dynamic: e.target.checked, grant_object_ref: e.target.checked ? null : draft.grant_object_ref })}
              label="Choose the object at creation time (New Object wizard)"
            />
          )}
        </>
      ) : (
        <Field labelSize="small" label="Grant tier">
          <Select value={draft.grant_tier_id} onChange={(e) => set({ grant_tier_id: e.target.value })}>
            {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_free ? ' (free)' : ''}</option>)}
          </Select>
        </Field>
      )}

      <Field labelSize="small" label="Grant to">
        <Select value={draft.grant_target} onChange={(e) => set({ grant_target: e.target.value as RuleRow['grant_target'] })}>
          <option value="self">The member who triggered it</option>
          <option value="registered_students">The students they registered (their cohort)</option>
        </Select>
      </Field>

      {(draft.grant_kind ?? 'tier') === 'tier' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field labelSize="small" label="Duration">
            <Select value={draft.duration_kind} onChange={(e) => set({ duration_kind: e.target.value as RuleRow['duration_kind'] })}>
              <option value="months">For N months</option>
              <option value="until_grad_july1">Until July 1 of grad year</option>
              <option value="lifetime">Lifetime</option>
              <option value="match_source">Match the triggering membership</option>
              <option value="until_date">Until a date</option>
            </Select>
          </Field>
          {draft.duration_kind === 'months' && (
            <Field labelSize="small" label="Months">
              <Input value={draft.duration_months ?? ''} onChange={(e) => set({ duration_months: e.target.value ? Number(e.target.value.replace(/[^0-9]/g, '')) : null })} />
            </Field>
          )}
          {draft.duration_kind === 'until_date' && (
            <Field labelSize="small" label="Until">
              <Input type="date" value={draft.duration_until ?? ''} onChange={(e) => set({ duration_until: e.target.value || null })} />
            </Field>
          )}
        </div>
      )}

      <Choice
        checked={draft.replaces_free}
        onChange={(e) => set({ replaces_free: e.target.checked })}
        label="Replace active free tier"
      />
    </Dialog>
  )
}
