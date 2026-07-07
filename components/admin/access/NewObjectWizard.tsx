'use client'

import { useEffect, useState } from 'react'
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-5">
        <h2 className="font-semibold text-brand-blue-dark">New object · step {step} of 3</h2>

        {step === 1 && (
          <>
            <div>
              <label className="mb-1 block text-xs text-brand-muted-soft">Type</label>
              <div className="flex gap-1.5">
                {CREATABLE.map((t) => (
                  <button
                    key={t}
                    onClick={() => setObjectType(t)}
                    className={
                      'rounded-md border px-3 py-1.5 text-sm capitalize ' +
                      (objectType === t ? 'border-brand-blue bg-brand-blue text-white' : 'border-brand-border text-brand-muted')
                    }
                  >
                    {t}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-brand-muted-soft">
                Events &amp; campaigns are created in Sanity Studio; courses in the course builder; resources by upload.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs text-brand-muted-soft">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={objectType === 'space' ? 'e.g. Propulsion Lounge' : 'e.g. Mars Habitat Cohort'}
                className="w-full rounded-md border border-brand-border px-2 py-1.5 text-sm"
              />
            </div>
            {needsHost && (
              <div>
                <label className="mb-1 block text-xs text-brand-muted-soft">{hostLabel} (single — enforced)</label>
                {mentor ? (
                  <p className="text-sm text-brand-blue-dark">
                    {mentor.first_name} {mentor.last_name}{' '}
                    <button onClick={() => setMentor(null)} className="text-xs text-brand-muted hover:underline">change</button>
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
                    <span className="mr-1.5 rounded-full bg-brand-hairline px-2 py-0.5 text-[10px] text-brand-muted">Suggested by rule</span>
                    {r.name}
                    {r.is_dynamic && <span className="ml-1 text-[10px] text-brand-muted-soft">(target chosen after creation)</span>}
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

        <div className="flex gap-2 pt-1">
          {step > 1 && (
            <button onClick={() => setStep(step - 1)} className="flex-1 rounded-md border border-brand-border py-2 text-sm text-brand-muted hover:bg-brand-canvas">
              Back
            </button>
          )}
          {step < 3 ? (
            <button onClick={() => setStep(step + 1)} disabled={!name.trim()} className="flex-1 rounded-md bg-brand-blue py-2 text-sm text-white hover:bg-brand-blue-dark disabled:opacity-40">
              Next
            </button>
          ) : (
            <button onClick={create} disabled={busy || !name.trim()} className="flex-1 rounded-md bg-brand-blue py-2 text-sm text-white hover:bg-brand-blue-dark disabled:opacity-40">
              {busy ? 'Creating…' : 'Create'}
            </button>
          )}
          <button onClick={onClose} className="flex-1 rounded-md border border-brand-border py-2 text-sm text-brand-muted hover:bg-brand-canvas">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
