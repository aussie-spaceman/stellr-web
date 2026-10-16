'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Choice, Field, Fieldset, Input, Select } from '@stellr/web-ui'
import type { EmailTemplate, Tier, AudienceFilter } from './types'

// Common lifecycle hooks app code can fire via fireCampaignEvent(eventKey, …).
const EVENT_KEYS = [
  { key: 'member.created', label: 'New member joins' },
  { key: 'membership.renewal_7d', label: 'Membership renews in 7 days' },
  { key: 'membership.expired', label: 'Membership expired' },
]

export function CampaignForm({ templates, tiers }: { templates: EmailTemplate[]; tiers: Tier[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [triggerType, setTriggerType] = useState<'scheduled' | 'event'>('scheduled')
  const [scheduledAt, setScheduledAt] = useState('')
  const [eventKey, setEventKey] = useState(EVENT_KEYS[0].key)
  const [delayDays, setDelayDays] = useState(0)
  const [sequenceKey, setSequenceKey] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  const [excludeMinors, setExcludeMinors] = useState(true)
  const [tierIds, setTierIds] = useState<string[]>([])

  const [count, setCount] = useState<number | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const audience = (): AudienceFilter => ({ activeOnly, excludeMinors, tierIds: tierIds.length ? tierIds : null })

  const toggleTier = (id: string) =>
    setTierIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))

  const previewCount = async () => {
    setPreviewing(true); setCount(null)
    try {
      const res = await fetch('/api/admin/email/audience/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(audience()),
      })
      const json = await res.json()
      if (res.ok) setCount(json.count)
    } finally {
      setPreviewing(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !templateId) { setError('Name and template are required.'); return }
    if (triggerType === 'scheduled' && !scheduledAt) { setError('Pick a send time.'); return }
    setSubmitting(true); setError(null); setSuccess(false)
    try {
      const res = await fetch('/api/admin/email/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          templateId,
          triggerType,
          scheduledAt: triggerType === 'scheduled' ? new Date(scheduledAt).toISOString() : undefined,
          eventKey: triggerType === 'event' ? eventKey : undefined,
          delayDays: triggerType === 'event' ? delayDays : undefined,
          sequenceKey: triggerType === 'event' && sequenceKey.trim() ? sequenceKey.trim() : undefined,
          audience: audience(),
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to create campaign.'); return }
      setSuccess(true); setName(''); setScheduledAt(''); setCount(null)
      router.refresh()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-brand-border bg-white p-6 space-y-4">
      <h2 className="text-base font-semibold text-brand-blue-dark">New campaign</h2>

      {templates.length === 0 && (
        <p className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
          Create a template first — campaigns send a template.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="June alumni welcome" />
        </Field>
        <Field label="Template" required>
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
      </div>

      <Fieldset legend="Trigger">
        <div className="flex flex-wrap gap-x-6">
          <Choice
            type="radio"
            name="campaign-trigger"
            label="Scheduled (one-time)"
            checked={triggerType === 'scheduled'}
            onChange={() => setTriggerType('scheduled')}
          />
          <Choice
            type="radio"
            name="campaign-trigger"
            label="Event-triggered"
            checked={triggerType === 'event'}
            onChange={() => setTriggerType('event')}
          />
        </div>
      </Fieldset>

      {triggerType === 'scheduled' ? (
        <Field label="Send at" hint="Dispatched on the next hourly cron tick after this time.">
          <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </Field>
      ) : (
        <div className="space-y-4">
          <Field label="Event" hint="Sends to a member when app code fires this event (still filtered by the audience below).">
            <Select value={eventKey} onChange={(e) => setEventKey(e.target.value)}>
              {EVENT_KEYS.map((k) => <option key={k.key} value={k.key}>{k.label} — {k.key}</option>)}
            </Select>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label={<>Send after <span className="font-normal text-content-muted">(days)</span></>}
              hint={
                delayDays === 0
                  ? 'Sends immediately when the event fires.'
                  : `Queued and sent ${delayDays} day${delayDays === 1 ? '' : 's'} later. Consent is re-checked at send time.`
              }
            >
              <Input
                type="number" inputMode="numeric" min={0} max={365} value={delayDays}
                onChange={(e) => setDelayDays(Math.max(0, Math.min(365, Number(e.target.value) || 0)))}
              />
            </Field>
            <Field
              label={<>Sequence <span className="font-normal text-content-muted">(optional)</span></>}
              hint="Groups the emails of one drip together in the list."
            >
              <Input
                value={sequenceKey} onChange={(e) => setSequenceKey(e.target.value)}
                maxLength={100} placeholder="teacher-welcome"
              />
            </Field>
          </div>
        </div>
      )}

      {/* The box is a div, not the fieldset itself: a bordered fieldset draws its legend through the border. */}
      <div className="rounded-lg border border-brand-hairline bg-brand-canvas p-4">
        <Fieldset legend="Audience">
          <Choice label="Active members only" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          <Choice label="Exclude minors (school students)" checked={excludeMinors} onChange={(e) => setExcludeMinors(e.target.checked)} />
          <Fieldset legend="Tiers" hint="None selected = all tiers." className="pt-2">
            <div className="flex flex-wrap gap-2">
              {tiers.map((t) => (
                <label
                  key={t.id}
                  className={`flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1 text-xs cursor-pointer focus-within:ring-2 focus-within:ring-primary-deep/30 ${tierIds.includes(t.id) ? 'border-brand-border bg-brand-blue-dark text-white' : 'border-brand-border text-brand-muted'}`}
                >
                  {/* Visually hidden, not display:none, so the chip stays reachable by keyboard. */}
                  <input type="checkbox" className="sr-only" checked={tierIds.includes(t.id)} onChange={() => toggleTier(t.id)} />
                  {t.name}
                </label>
              ))}
            </div>
          </Fieldset>
          <div className="flex items-center gap-3 pt-2">
            <button type="button" onClick={previewCount} disabled={previewing} className="rounded-md border border-brand-border px-3 py-1.5 text-xs font-medium text-brand-muted hover:bg-white disabled:opacity-50">
              {previewing ? 'Counting…' : 'Preview recipients'}
            </button>
            {count !== null && <span className="text-sm text-brand-muted"><strong>{count}</strong> member{count === 1 ? '' : 's'} (after consent suppression)</span>}
          </div>
        </Fieldset>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-600">Campaign created as draft — activate it from the list below.</p>}

      <button type="submit" disabled={submitting || templates.length === 0} className="rounded-md bg-brand-blue-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50">
        {submitting ? 'Creating…' : 'Create campaign'}
      </button>
    </form>
  )
}
