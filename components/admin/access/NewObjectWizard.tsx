'use client'

import { useEffect, useId, useState } from 'react'
import { Dialog, Field, Input } from '@stellr/web-ui'
import { toast } from '@/components/ui/Toast'
import MemberPicker, { type PickedMember } from '@/components/admin/MemberPicker'

// New Object wizard (design/admin-access): type → contents (rule-suggested
// auto-attachments, applied automatically on create) → review. Creates spaces,
// cohorts and workshops; events/campaigns come from Sanity, courses/resources
// from their dedicated tools. POST /api/admin/access/objects fires the
// object_created rules server-side.

interface SuggestedRule {
  id: string
  name: string
  grant_object_ref: string | null
  is_dynamic: boolean
}

const CREATABLE = ['space', 'cohort', 'workshop'] as const
type Creatable = (typeof CREATABLE)[number]

export function NewObjectWizard({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }) {
  const [step, setStep] = useState(1)
  const [objectType, setObjectType] = useState<Creatable>('space')
  const [name, setName] = useState('')
  const [mentor, setMentor] = useState<PickedMember | null>(null)
  const [rules, setRules] = useState<SuggestedRule[]>([])
  const [busy, setBusy] = useState(false)
  const typeLabelId = useId()

  useEffect(() => {
    let active = true
    fetch('/api/admin/membership/rules')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!active || !j?.rules) return
        setRules(
          (j.rules as Array<Record<string, unknown>>)
            .filter((r) => r.trigger_type === 'object_created' && r.is_active && r.grant_kind === 'attach_object' && r.object_type === objectType)
            .map((r) => ({
              id: r.id as string,
              name: r.name as string,
              grant_object_ref: (r.grant_object_ref as string | null) ?? null,
              is_dynamic: !!r.is_dynamic,
            })),
        )
      })
    return () => { active = false }
  }, [objectType])

  const create = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/access/objects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectType, name, mentorMemberId: mentor?.id ?? null }),
      })
      const j = await res.json()
      if (!res.ok) {
        toast(j.error ?? 'Could not create object', { tone: 'error' })
        return
      }
      const applied = j.rules?.applied?.length ?? 0
      toast(`Created ${name}${applied ? ` — ${applied} rule attachment${applied === 1 ? '' : 's'} applied` : ''}`)
      onCreated()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const needsHost = objectType === 'cohort' || objectType === 'workshop'
  const hostLabel = objectType === 'workshop' ? 'Coach' : 'Mentor'

  const outline =
    'min-h-11 rounded-control border border-line-strong px-4 text-sm text-content-secondary hover:bg-surface disabled:opacity-50'
  const primary =
    'min-h-11 rounded-control bg-primary-deep px-4 text-sm font-semibold text-white hover:bg-ink disabled:opacity-40'

  return (
    <Dialog
      open
      onClose={onClose}
      title={`New object · step ${step} of 3`}
      size="md"
      dismissible={!busy}
      bodyClassName="space-y-4"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={outline}>
            Cancel
          </button>
          {step > 1 && (
            <button type="button" onClick={() => setStep(step - 1)} disabled={busy} className={outline}>
              Back
            </button>
          )}
          {step < 3 ? (
            <button type="button" onClick={() => setStep(step + 1)} disabled={!name.trim()} className={primary}>
              Next
            </button>
          ) : (
            <button type="button" onClick={create} disabled={busy || !name.trim()} className={primary}>
              {busy ? 'Creating…' : 'Create'}
            </button>
          )}
        </>
      }
    >
      {step === 1 && (
        <>
          <div role="group" aria-labelledby={typeLabelId}>
            <p id={typeLabelId} className="mb-1 block text-xs text-brand-muted-soft">Type</p>
            <div className="flex flex-wrap gap-1.5">
              {CREATABLE.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={objectType === t}
                  onClick={() => setObjectType(t)}
                  className={
                    'min-h-11 rounded-control border px-4 text-sm capitalize ' +
                    (objectType === t ? 'border-primary-deep bg-primary-deep text-white' : 'border-line-strong text-brand-muted')
                  }
                >
                  {t}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-brand-muted-soft">
              Events &amp; campaigns are created in Sanity Studio; courses in the course builder; resources by upload.
            </p>
          </div>
          <Field label="Name" labelSize="small">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={objectType === 'space' ? 'e.g. Propulsion Lounge' : 'e.g. Mars Habitat Cohort'}
            />
          </Field>
          {needsHost && (
            <div>
              <label className="mb-1 block text-xs text-brand-muted-soft">{hostLabel} (single — enforced)</label>
              {mentor ? (
                <p className="text-sm text-brand-blue-dark">
                  {mentor.first_name} {mentor.last_name}{' '}
                  <button type="button" onClick={() => setMentor(null)} className="text-xs text-brand-muted hover:underline">change</button>
                </p>
              ) : (
                <MemberPicker onPick={setMentor} />
              )}
            </div>
          )}
        </>
      )}

      {step === 2 && (
        <div>
          <p className="mb-2 text-sm text-brand-muted">
            Auto-attachments from active rules for a new <b>{objectType}</b>:
          </p>
          {rules.length === 0 ? (
            <p className="text-xs text-brand-muted-soft">No object-created rules match — nothing will be auto-attached.</p>
          ) : (
            <ul className="space-y-1">
              {rules.map((r) => (
                <li key={r.id} className="rounded-lg border border-brand-hairline px-3 py-1.5 text-sm text-brand-blue-dark">
                  <span className="mr-1.5 rounded-full bg-brand-hairline px-2 py-0.5 text-xs text-brand-muted">Suggested by rule</span>
                  {r.name}
                  {r.is_dynamic && <span className="ml-1 text-xs text-brand-muted-soft">(target chosen after creation)</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-1 text-sm">
          <p><span className="text-brand-muted-soft">Type:</span> <span className="capitalize">{objectType}</span></p>
          <p><span className="text-brand-muted-soft">Name:</span> {name}</p>
          {needsHost && <p><span className="text-brand-muted-soft">{hostLabel}:</span> {mentor ? `${mentor.first_name} ${mentor.last_name}` : '— (assign later)'}</p>}
          <p><span className="text-brand-muted-soft">Rule attachments:</span> {rules.filter((r) => !r.is_dynamic).length} applied on create</p>
        </div>
      )}
    </Dialog>
  )
}
